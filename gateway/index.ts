import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { Logger } from './logger';
import { StrokeData, ClientMessage, ServerMessage } from './types';

const logger = new Logger('gateway');

const PORT = process.env.PORT || 3000;
const REPLICAS = (process.env.REPLICAS || 'http://localhost:4001,http://localhost:4002,http://localhost:4003').split(',');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// Serve public directory
app.use(express.static(path.join(__dirname, 'public')));

// Main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', gateway: true });
});

// Connected clients
const clients = new Set<any>();

// Local stroke cache (what has been displayed to clients)
let displayedStrokes: StrokeData[] = [];

// Current leader cache
let currentLeader: string | null = null;
let currentTerm: number = 0;
let lastLeaderCheck = 0;
const LEADER_CACHE_TTL = 5000; // 5 seconds

// Discover leader
async function discoverLeader(): Promise<string | null> {
  const now = Date.now();
  if (currentLeader && now - lastLeaderCheck < LEADER_CACHE_TTL) {
    return currentLeader;
  }

  lastLeaderCheck = now;

  for (const replica of REPLICAS) {
    try {
      const response = await fetch(`${replica.trim()}/leader`);
      const data = (await response.json()) as { leader: string | null, term: number };
      if (data.leader) {
        currentLeader = data.leader;
        currentTerm = data.term;
        logger.info('Discovered leader', { leader: data.leader, term: data.term });
        return data.leader;
      }
    } catch (error) {
      // Try next replica
    }
  }

  currentLeader = null;
  logger.warn('No leader available');
  return null;
}

// Submit stroke to leader
async function submitStroke(stroke: StrokeData): Promise<boolean> {
  const leader = await discoverLeader();
  if (!leader) {
    logger.warn('No leader available for stroke');
    return false;
  }

  try {
    const response = await fetch(`${leader}/stroke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stroke),
    });

    if (response.ok) {
      logger.info('Stroke accepted by leader', { strokeId: stroke.id });
      return true;
    } else if (response.status === 307) {
      currentLeader = null; // Invalidate cache
      logger.warn('Leader changed, retrying');
      return submitStroke(stroke);
    }
  } catch (error) {
    logger.error('Failed to submit stroke', { error: String(error) });
    currentLeader = null;
  }

  return false;
}

// Get state from local cache and server
async function getState(): Promise<StrokeData[]> {
  // Return the local cache which represents what's been displayed to clients
  // This ensures sync shows the current drawing, not just committed entries
  return displayedStrokes;
}

// Clear canvas on leader
async function clearCanvas(): Promise<boolean> {
  const leader = await discoverLeader();
  if (!leader) {
    logger.warn('No leader available for clear');
    return false;
  }

  try {
    const response = await fetch(`${leader}/clear`, { method: 'POST' });
    if (response.ok) {
      logger.info('Canvas cleared');
      return true;
    } else if (response.status === 307) {
      currentLeader = null;
      return clearCanvas();
    }
  } catch (error) {
    logger.error('Failed to clear canvas', { error: String(error) });
    currentLeader = null;
  }

  return false;
}

// Broadcast to all clients
function broadcastToClients(message: ServerMessage): void {
  const payload = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  });
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = Math.random().toString(36).substring(7);
  logger.info('Client connected', { clientId, totalClients: clients.size + 1 });

  clients.add(ws);

  // Send initial status
  ws.send(JSON.stringify({
    type: 'status',
    data: { message: 'Connected to gateway' },
  } as ServerMessage));

  // Send current leader info
  if (currentLeader) {
    ws.send(JSON.stringify({
      type: 'leader-info',
      data: { leader: currentLeader, term: currentTerm },
    } as ServerMessage));
  }

  // Auto-sync the current state to new client
  ws.send(JSON.stringify({
    type: 'state-sync',
    data: { strokes: displayedStrokes },
  } as ServerMessage));

  ws.on('message', async (message: string) => {
    try {
      const msg = JSON.parse(message) as ClientMessage;

      if (msg.type === 'stroke' && msg.data) {
        const success = await submitStroke(msg.data);
        if (success) {
          // Track stroke locally
          displayedStrokes.push(msg.data);
          // Broadcast to all clients
          broadcastToClients({
            type: 'stroke-committed',
            data: msg.data,
          });
        }
      } else if (msg.type === 'clear-all') {
        logger.info('Clear canvas requested', { clientId });
        const success = await clearCanvas();
        if (success) {
          // Clear local cache
          displayedStrokes = [];
          // Broadcast clear to all clients
          broadcastToClients({ type: 'clear' });
        }
      } else if (msg.type === 'sync-request') {
        const strokes = await getState();
        ws.send(JSON.stringify({
          type: 'state-sync',
          data: { strokes },
        } as ServerMessage));
      }
    } catch (error) {
      logger.error('Error processing message', { error: String(error) });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    logger.info('Client disconnected', { clientId, totalClients: clients.size });
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error', { clientId, error: String(error) });
  });
});

// Periodic leader discovery and broadcast
setInterval(async () => {
  const prevLeader = currentLeader;
  await discoverLeader().catch(() => {
    // Silently fail, will retry on next interval
  });
  
  // Broadcast leader info to all clients if changed or periodically
  if (currentLeader) {
    broadcastToClients({
      type: 'leader-info',
      data: { leader: currentLeader, term: currentTerm },
    } as ServerMessage);
  }
}, 3000); // Every 3 seconds

// Start server
server.listen(PORT, () => {
  logger.info(`Gateway server started on port ${PORT}`, { replicas: REPLICAS.length });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});
