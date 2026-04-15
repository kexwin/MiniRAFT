export interface StrokeData {
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
  data: StrokeData | { type: 'clear' };
}

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
  leaderCommit: number;
}

export interface AppendEntriesReply {
  term: number;
  success: boolean;
  conflictIndex?: number;
}

export interface StatusMessage {
  role: 'leader' | 'follower' | 'candidate';
  term: number;
  leader?: string;
  commitIndex: number;
  logLength: number;
}

export type NodeRole = 'follower' | 'candidate' | 'leader';
