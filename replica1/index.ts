/**
 * Replica Node Server
 * Implements HTTP endpoints for RAFT consensus and client requests
 */

import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import { RaftConsensusNode } from './raftNode';
import { Logger } from './logger';
import {
  RequestVoteArgs,
  RequestVoteReply,
  AppendEntriesArgs,
  AppendEntriesReply,
  SyncLogArgs,
  SyncLogReply,
  Stroke,
  RaftState
} from './types';

const app = express();
const logger = new Logger('replica-server');

// Configuration from environment
const nodeId = process.env.REPLICA_ID || 'replica1';
const port = parseInt(process.env.PORT || '4001', 10);
const peersStr = process.env.PEERS;
const electionTimeoutMin = parseInt(process.env.ELECTION_TIMEOUT_MIN || '500', 10);
const electionTimeoutMax = parseInt(process.env.ELECTION_TIMEOUT_MAX || '800', 10);
const heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL || '150', 10);

// Middleware
app.use(bodyParser.json());

// Initialize RAFT node
const raftNode = new RaftConsensusNode(
  nodeId,
  port,
  peersStr,
  electionTimeoutMin,
  electionTimeoutMax,
  heartbeatInterval
);

// Store committed strokes for clients
let committedStrokes: Map<string, Stroke> = new Map();

// Callback when strokes are committed
raftNode.onEntryApplied((stroke: Stroke) => {
  committedStrokes.set(stroke.id, stroke);
  logger.info('Stroke committed', { strokeId: stroke.id });
});

/**
 * === RAFT RPC ENDPOINTS ===
 */

/**
 * RequestVote RPC
 */
app.post('/request-vote', (req: Request, res: Response) => {
  const args = req.body as RequestVoteArgs;
  logger.debug('RequestVote received', { candidateId: args.candidateId, term: args.term });

  const reply = raftNode.handleRequestVote(args);
  res.json(reply);
});

/**
 * AppendEntries RPC (for log replication & heartbeats)
 */
app.post('/append-entries', (req: Request, res: Response) => {
  const args = req.body as AppendEntriesArgs;
  logger.debug('AppendEntries received', {
    leaderId: args.leaderId,
    term: args.term,
    entriesCount: args.entries.length
  });

  const reply = raftNode.handleAppendEntries(args);
  res.json(reply);
});

/**
 * SyncLog RPC (for catch-up after restart)
 */
app.post('/sync-log', (req: Request, res: Response) => {
  const args = req.body as SyncLogArgs;
  logger.info('SyncLog requested', { fromIndex: args.fromIndex });

  const reply = raftNode.handleSyncLog(args);
  res.json(reply);
});

/**
 * === CLIENT API ===
 */

/**
 * Append a stroke (client -> leader)
 */
app.post('/stroke', (req: Request, res: Response) => {
  const stroke = req.body as Stroke;
  logger.debug('Stroke request received', { strokeId: stroke.id });

  if (raftNode.getState() !== RaftState.Leader) {
    return res.status(307).json({
      error: 'Not leader',
      leader: raftNode.getLeader()
    });
  }

  raftNode.appendEntry(stroke);
  res.json({ success: true, term: raftNode.getCurrentTerm() });
});

/**
 * Clear canvas (client -> leader)
 */
app.post('/clear', (req: Request, res: Response) => {
  logger.info('Clear canvas request received');

  if (raftNode.getState() !== RaftState.Leader) {
    return res.status(307).json({
      error: 'Not leader',
      leader: raftNode.getLeader()
    });
  }

  // Clear committed strokes
  committedStrokes.clear();
  logger.info('Canvas cleared');
  res.json({ success: true, term: raftNode.getCurrentTerm() });
});

/**
 * Get all committed strokes
 */
app.get('/strokes', (req: Request, res: Response) => {
  const strokes = Array.from(committedStrokes.values());
  res.json({
    strokes,
    commitIndex: raftNode.getCommitIndex(),
    leader: raftNode.getLeader(),
    term: raftNode.getCurrentTerm()
  });
});

/**
 * Health check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    nodeId,
    state: raftNode.getState(),
    isLeader: raftNode.getState() === RaftState.Leader,
    term: raftNode.getCurrentTerm(),
    leader: raftNode.getLeader(),
    logLength: raftNode.getLog().length,
    commitIndex: raftNode.getCommitIndex()
  });
});

/**
 * Debug: Get node state
 */
app.get('/state', (req: Request, res: Response) => {
  const log = raftNode.getLog();
  res.json({
    nodeId,
    state: raftNode.getState(),
    currentTerm: raftNode.getCurrentTerm(),
    leader: raftNode.getLeader(),
    commitIndex: raftNode.getCommitIndex(),
    logLength: log.length,
    lastLogTerm: log.length > 0 ? log[log.length - 1].term : 0,
    committedStrokes: committedStrokes.size
  });
});

/**
 * === SERVER MANAGEMENT ===
 */

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  raftNode.shutdown();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  raftNode.shutdown();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

const server = app.listen(port, '0.0.0.0', () => {
  logger.info(`Replica node listening`, { nodeId, port });
});
