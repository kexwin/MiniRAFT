/**
 * WebSocket Gateway for Drawing Board
 * Routes strokes to leader and broadcasts committed strokes to clients
 */

import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import WebSocket from 'ws';
import axios from 'axios';
import http from 'http';
import { Logger } from './logger';
import { Stroke } from './types';

const app = express();
const logger = new Logger('gateway');

app.use(bodyParser.json());
app.use(express.static('public'));

// Replica endpoints from environment
const replicas = [
  process.env.REPLICA_1 || 'http://replica1:4001',
  process.env.REPLICA_2 || 'http://replica2:4002',
  process.env.REPLICA_3 || 'http://replica3:4003'
];

let currentLeader: string | null = null;
let currentLeaderTerm: number = 0;
let lastLeaderDiscovery: number = 0;
const LEADER_CACHE_TTL = 5000; // Cache leader for 5 seconds

// WebSocket clients
const clients = new Set<WebSocket>();

/**
 * Find the current leader by querying replicas
 * Uses caching to avoid hammering replicas
 */
async function discoverLeader(): Promise<string | null> {
  const now = Date.now();
  
  // Use cached leader if still valid
  if (currentLeader && now - lastLeaderDiscovery < LEADER_CACHE_TTL) {
    return currentLeader;
  }

  for (const replicaUrl of replicas) {
    try {
      const response = await axios.get<any>(`${replicaUrl}/health`, { timeout: 2000 });
      const data = response.data;

      if (data.isLeader) {
        if (data.term >= currentLeaderTerm) {
          currentLeaderTerm = data.term;
          currentLeader = replicaUrl;
          lastLeaderDiscovery = now;
          logger.info('Discovered leader', { leader: replicaUrl, term: data.term });
          return replicaUrl;
        }
      }
    } catch (error) {
      logger.debug(`Failed to query ${replicaUrl}`, { error: String(error) });
    }
  }

  // If no current leader found, return last known one
  if (currentLeader) {
    logger.debug('Using cached leader', { leader: currentLeader });
    return currentLeader;
  }
  
  logger.warn('No leader found in cluster');
  return null;
}

/**
 * Broadcast strokes to all connected clients
 */
function broadcastToClients(message: any): void {
  const msg = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

/**
 * Sync state from cluster to connected clients
 */
async function syncStateToClients(): Promise<void> {
  if (!currentLeader) {
    const leader = await discoverLeader();
    if (!leader) {
      logger.warn('No leader available for state sync');
      broadcastToClients({ type: 'error', error: 'No leader available' });
      return;
    }
  }

  try {
    const response = await axios.get<any>(`${currentLeader}/strokes`, { timeout: 2000 });
    const strokes = response.data.strokes || [];

    broadcastToClients({
      type: 'state-sync',
      strokes,
      commitIndex: response.data.commitIndex,
      leader: response.data.leader,
      term: response.data.term
    });
  } catch (error: any) {
    logger.error('Failed to sync state from leader', { error: String(error), leader: currentLeader });
    // Clear leader cache on failure
    lastLeaderDiscovery = 0;
    currentLeader = null;
    broadcastToClients({ type: 'error', error: 'Failed to sync state' });
  }
}

/**
 * === REST API ===
 */

/**
 * Health check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    service: 'gateway',
    currentLeader,
    currentLeaderTerm,
    connectedClients: clients.size,
    status: 'ok'
  });
});

/**
 * Get cluster status
 */
app.get('/cluster-status', async (req: Request, res: Response) => {
  const status: any = {
    leader: currentLeader,
    leaderTerm: currentLeaderTerm,
    replicas: []
  };

  for (const replicaUrl of replicas) {
    try {
      const response = await axios.get<any>(`${replicaUrl}/health`, { timeout: 3000 });
      status.replicas.push({
        url: replicaUrl,
        ...response.data
      });
    } catch (error) {
      status.replicas.push({
        url: replicaUrl,
        error: 'unreachable'
      });
    }
  }

  res.json(status);
});

/**
 * === WEBSOCKET SERVER ===
 */

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws: WebSocket) => {
  const clientId = Math.random().toString(36).substring(7);
  logger.info('Client connected', { clientId, totalClients: clients.size + 1 });

  clients.add(ws);

  // Only sync state if we have a known leader
  if (currentLeader) {
    syncStateToClients();
  }

  /**
   * Client message handler
   */
  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message);
      logger.debug('Message from client', { clientId, type: data.type });

      if (data.type === 'stroke') {
        // Ensure stroke has required fields
        const stroke: Stroke = {
          id: data.stroke?.id || Math.random().toString(36),
          x0: data.stroke?.x0 || 0,
          y0: data.stroke?.y0 || 0,
          x1: data.stroke?.x1 || 0,
          y1: data.stroke?.y1 || 0,
          color: data.stroke?.color || '#000000',
          size: data.stroke?.size || 1,
          timestamp: Date.now()
        };

        // Find leader
        if (!currentLeader) {
          await discoverLeader();
        }

        if (!currentLeader) {
          ws.send(JSON.stringify({ type: 'error', error: 'No leader available' }));
          return;
        }

        // Send stroke to leader
        try {
          const response = await axios.post<any>(`${currentLeader}/stroke`, stroke, { timeout: 3000 });
          logger.info('Stroke accepted by leader', { strokeId: stroke.id });

          // Broadcast to other clients after small delay (for leader replication)
          setTimeout(() => {
            syncStateToClients();
          }, 100);
        } catch (error: any) {
          if (error.response?.status === 307) {
            // Leader changed - clear cache and retry
            lastLeaderDiscovery = 0;
            currentLeader = error.response.data.leader || null;
            logger.warn('Leader changed', { newLeader: currentLeader });

            // Retry with new leader
            if (currentLeader) {
              try {
                await axios.post<any>(`${currentLeader}/stroke`, stroke, { timeout: 3000 });
                setTimeout(() => {
                  syncStateToClients();
                }, 100);
              } catch (retryError) {
                logger.error('Stroke submission failed after retry', { error: String(retryError) });
                lastLeaderDiscovery = 0;
                currentLeader = null;
                ws.send(JSON.stringify({ type: 'error', error: 'Failed to submit stroke' }));
              }
            }
          } else {
            logger.error('Failed to submit stroke to leader', { error: String(error), leader: currentLeader });
            // Clear leader cache on failure
            lastLeaderDiscovery = 0;
            currentLeader = null;
            ws.send(JSON.stringify({ type: 'error', error: 'Failed to submit stroke' }));
          }
        }
      } else if (data.type === 'sync-request') {
        // Client requested state sync
        logger.debug('State sync requested', { clientId });
        syncStateToClients();
      } else if (data.type === 'clear-all') {
        // Client requested clear canvas
        logger.info('Clear canvas requested', { clientId });
        
        // Find leader to clear its strokes
        if (!currentLeader) {
          await discoverLeader();
        }
        
        if (currentLeader) {
          try {
            // Send clear command to leader
            await axios.post<any>(`${currentLeader}/clear`, {}, { timeout: 3000 });
            logger.info('Clear command sent to leader');
          } catch (error) {
            logger.error('Failed to send clear command to leader', { error: String(error) });
            // Clear leader cache on failure
            lastLeaderDiscovery = 0;
            currentLeader = null;
          }
        }
        
        // Broadcast clear to all connected clients
        broadcastToClients({ type: 'clear-all' });
      }
    } catch (error) {
      logger.error('Error processing message', { error: String(error) });
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
    }
  });

  /**
   * Client disconnect handler
   */
  ws.on('close', () => {
    clients.delete(ws);
    logger.info('Client disconnected', { clientId, totalClients: clients.size });
  });

  ws.on('error', (error: Error) => {
    logger.error('WebSocket error', { clientId, error: error.message });
  });
});

/**
 * Background tasks
 */

// Discover leader every 10 seconds (only if cache expired)
setInterval(async () => {
  const now = Date.now();
  if (now - lastLeaderDiscovery > LEADER_CACHE_TTL) {
    await discoverLeader();
  }
}, 10000);

// Periodically broadcast state to clients every 5 seconds
// Only if we have a leader and clients connected
setInterval(async () => {
  if (clients.size > 0 && currentLeader) {
    await syncStateToClients();
  }
}, 5000);

/**
 * Start server
 */

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Gateway listening`, { port: PORT });
});

/**
 * Graceful shutdown
 */
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
