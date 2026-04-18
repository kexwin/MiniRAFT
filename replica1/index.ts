import express from 'express';
import cors from 'cors';
import { RaftNode } from './raftNode';
import { Logger } from './logger';
import { RequestVoteArgs, AppendEntriesArgs, LogEntry, StrokeData } from './types';

const app = express();
const logger = new Logger('replica-server');

// Configuration
const PORT = process.env.PORT || 4001;
const NODE_ID = process.env.NODE_ID || 'replica1';
const NODE_ADDR = process.env.NODE_ADDR || 'http://localhost:4001';
const PEERS_STR = process.env.PEERS || 'http://localhost:4002,http://localhost:4003';
const peers = PEERS_STR.split(',').filter(p => p.trim() && p !== NODE_ADDR);

// Middleware
app.use(cors());
app.use(express.json());

// RAFT Node
const raftNode = new RaftNode(NODE_ID, NODE_ADDR, peers);

// Create node ID to address mapping
const nodeAddrs = new Map<string, string>();
nodeAddrs.set(NODE_ID, NODE_ADDR);
peers.forEach(peerUrl => {
  const nodeId = peerUrl.split('/').pop()?.split(':')[0] || 'unknown';
  nodeAddrs.set(nodeId, peerUrl);
});

// In-memory stroke storage (committed entries)
let committedStrokes: StrokeData[] = [];

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', node: NODE_ID });
});

// Get status
app.get('/status', (req, res) => {
  res.json(raftNode.getStatus());
});

// Get leader
app.get('/leader', (req, res) => {
  const leaderId = raftNode.getLeader();
  const leaderUrl = leaderId ? nodeAddrs.get(leaderId) : null;
  res.json({ leader: leaderUrl });
});

// Get committed strokes
app.get('/strokes', (req, res) => {
  res.json({ strokes: committedStrokes });
});

// RPC: RequestVote
app.post('/request-vote', (req, res) => {
  const args = req.body as RequestVoteArgs;
  const reply = raftNode.handleRequestVote(args);
  res.json(reply);
});

// RPC: AppendEntries
app.post('/append-entries', (req, res) => {
  const args = req.body as AppendEntriesArgs;
  const reply = raftNode.handleAppendEntries(args);

  // Extract and store committed strokes
  if (reply.success && args.leaderCommit >= 0) {
    const committedEntries = raftNode.getCommittedEntries();
    committedStrokes = committedEntries
      .map(entry => {
        if ('id' in entry.data) {
          return entry.data as StrokeData;
        } else if (entry.data.type === 'clear') {
          return null;
        }
        return null;
      })
      .filter((s): s is StrokeData => s !== null);

    logger.info('Committed strokes updated', { count: committedStrokes.length });
  }

  res.json(reply);
});

// Submit stroke (only if leader)
app.post('/stroke', (req, res) => {
  const stroke = req.body as StrokeData;
  const success = raftNode.appendEntryIfLeader(stroke);

  if (success) {
    logger.info('Stroke accepted by leader', { strokeId: stroke.id });
    res.json({ success: true, message: 'Stroke submitted to leader' });
  } else {
    const leader = raftNode.getLeader();
    res.status(307).json({ success: false, message: 'Not leader', leader });
  }
});

// Clear canvas (only if leader)
app.post('/clear', (req, res) => {
  const success = raftNode.appendEntryIfLeader({ type: 'clear' });

  if (success) {
    committedStrokes = [];
    logger.info('Canvas cleared by leader');
    res.json({ success: true, message: 'Canvas cleared' });
  } else {
    const leader = raftNode.getLeader();
    res.status(307).json({ success: false, message: 'Not leader', leader });
  }
});

// Sync log for rejoining nodes
app.get('/sync-log/:fromIndex', (req, res) => {
  const fromIndex = parseInt(req.params.fromIndex, 10);
  const entries = raftNode.syncLog(fromIndex);
  res.json({ entries });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Replica server started on port ${PORT}`, {
    nodeId: NODE_ID,
    nodeAddr: NODE_ADDR,
    peers: peers.length,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  raftNode.shutdown();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  raftNode.shutdown();
  process.exit(0);
});
