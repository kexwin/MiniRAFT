/**
 * Shared types for RAFT consensus protocol
 */

export interface Stroke {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  size: number;
  timestamp: number;
}

export interface LogEntry {
  term: number;
  index: number;
  stroke: Stroke;
}

/**
 * RAFT RPC Requests & Responses
 */

export interface RequestVoteArgs {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface RequestVoteReply {
  term: number;
  voteGranted: boolean;
}

export interface AppendEntriesArgs {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommitIndex: number;
}

export interface AppendEntriesReply {
  term: number;
  success: boolean;
  matchIndex: number; // For leader to track replication progress
}

export interface SyncLogArgs {
  fromIndex: number;
}

export interface SyncLogReply {
  entries: LogEntry[];
  lastIndex: number;
}

/**
 * Node state
 */
export enum RaftState {
  Follower = 'follower',
  Candidate = 'candidate',
  Leader = 'leader'
}

export interface RaftNode {
  id: string;
  state: RaftState;
  currentTerm: number;
  votedFor: string | null;
  log: LogEntry[];
  commitIndex: number;
  lastApplied: number;
  nextIndex: Map<string, number>; // for leader
  matchIndex: Map<string, number>; // for leader
}

/**
 * Gateway types
 */
export interface ClientMessage {
  type: 'stroke' | 'sync-request';
  stroke?: Stroke;
}

export interface ServerBroadcast {
  type: 'stroke' | 'state-sync' | 'error';
  stroke?: Stroke;
  strokes?: Stroke[];
  error?: string;
}
