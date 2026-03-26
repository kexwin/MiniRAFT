/**
 * Core RAFT consensus node implementation
 */

import { Logger } from './logger';
import {
  RaftNode,
  RaftState,
  LogEntry,
  RequestVoteArgs,
  RequestVoteReply,
  AppendEntriesArgs,
  AppendEntriesReply,
  SyncLogArgs,
  SyncLogReply,
  Stroke
} from './types';
import axios from 'axios';

export class RaftConsensusNode {
  private node: RaftNode;
  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private logger: Logger;

  private peers: Map<string, string>; // peerId -> peerUrl
  private currentLeader: string | null = null;
  private appliedCallbacks: ((stroke: Stroke) => void)[] = [];

  constructor(
    private nodeId: string,
    private port: number,
    peersStr: string | undefined,
    private electionTimeoutMin: number = 500,
    private electionTimeoutMax: number = 800,
    private heartbeatInterval: number = 150
  ) {
    this.logger = new Logger(nodeId);

    // Initialize RAFT node state
    this.node = {
      id: nodeId,
      state: RaftState.Follower,
      currentTerm: 0,
      votedFor: null,
      log: [],
      commitIndex: 0,
      lastApplied: 0,
      nextIndex: new Map(),
      matchIndex: new Map()
    };

    // Initialize peers
    this.peers = new Map();
    if (peersStr) {
      const peerList = peersStr.split(',');
      for (const peer of peerList) {
        const [id, port] = peer.trim().split(':');
        this.peers.set(id, `http://${id}:${port}`);
      }
    }

    this.logger.info(`RAFT node initialized`, {
      nodeId,
      peers: Array.from(this.peers.keys())
    });

    // Start as follower
    this.startElectionTimer();
  }

  /**
   * === STATE ACCESSORS ===
   */

  getState(): RaftState {
    return this.node.state;
  }

  getCurrentTerm(): number {
    return this.node.currentTerm;
  }

  getLeader(): string | null {
    return this.currentLeader;
  }

  getLog(): LogEntry[] {
    return this.node.log;
  }

  getCommitIndex(): number {
    return this.node.commitIndex;
  }

  /**
   * === LOG MANAGEMENT ===
   */

  appendEntry(stroke: Stroke): void {
    if (this.node.state !== RaftState.Leader) {
      this.logger.warn('Not leader, cannot append entry', {
        currentState: this.node.state,
        currentLeader: this.currentLeader
      });
      return;
    }

    const entry: LogEntry = {
      term: this.node.currentTerm,
      index: this.node.log.length,
      stroke
    };

    this.node.log.push(entry);
    this.logger.info('Entry appended to log', {
      index: entry.index,
      term: entry.term
    });

    // Immediately replicate to all followers
    this.replicateLog();
  }

  /**
   * === ELECTION ===
   */

  private startElectionTimer(): void {
    this.clearElectionTimer();

    const timeout = Math.random() * (this.electionTimeoutMax - this.electionTimeoutMin) + this.electionTimeoutMin;
    this.electionTimer = setTimeout(() => {
      if (this.node.state !== RaftState.Leader) {
        this.startElection();
      }
    }, timeout);
  }

  private clearElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
  }

  private async startElection(): Promise<void> {
    this.logger.info('Starting election', { currentTerm: this.node.currentTerm });

    // Increment term
    this.node.currentTerm += 1;
    this.node.state = RaftState.Candidate;
    this.node.votedFor = this.nodeId;
    this.currentLeader = null;

    const lastLogIndex = this.node.log.length - 1;
    const lastLogTerm = lastLogIndex >= 0 ? this.node.log[lastLogIndex].term : 0;

    const args: RequestVoteArgs = {
      term: this.node.currentTerm,
      candidateId: this.nodeId,
      lastLogIndex,
      lastLogTerm
    };

    let votesReceived = 1; // Vote for self
    const totalPeers = this.peers.size;
    const majorityNeeded = Math.floor(totalPeers / 2) + 1;

    // Request votes from all peers
    const votePromises = Array.from(this.peers.entries()).map(async ([peerId, peerUrl]) => {
      try {
        const response = await axios.post<RequestVoteReply>(`${peerUrl}/request-vote`, args, { timeout: 5000 });
        const reply = response.data;

        if (reply.term > this.node.currentTerm) {
          this.node.currentTerm = reply.term;
          this.node.state = RaftState.Follower;
          this.node.votedFor = null;
          return false;
        }

        return reply.voteGranted;
      } catch (error) {
        this.logger.debug(`Failed to request vote from ${peerId}`, { error: String(error) });
        return false;
      }
    });

    const votes = await Promise.all(votePromises);
    votesReceived += votes.filter((v: boolean) => v).length;

    if (votesReceived >= majorityNeeded) {
      this.becomeLeader();
    } else {
      this.logger.info('Election lost', { votesReceived, majorityNeeded, term: this.node.currentTerm });
      this.node.state = RaftState.Follower;
      this.node.votedFor = null;
      this.startElectionTimer();
    }
  }

  private becomeLeader(): void {
    this.logger.info('Became leader', { term: this.node.currentTerm });

    this.node.state = RaftState.Leader;
    this.currentLeader = this.nodeId;

    // Initialize nextIndex and matchIndex for all followers
    this.peers.forEach((_, peerId) => {
      this.node.nextIndex.set(peerId, this.node.log.length);
      this.node.matchIndex.set(peerId, 0);
    });

    this.setHeartbeatTimer();
  }

  /**
   * === LOG REPLICATION ===
   */

  private setHeartbeatTimer(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      if (this.node.state === RaftState.Leader) {
        this.replicateLog();
      }
    }, this.heartbeatInterval);
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async replicateLog(): Promise<void> {
    if (this.node.state !== RaftState.Leader) {
      return;
    }

    const replicationPromises = Array.from(this.peers.entries()).map(async ([peerId, peerUrl]) => {
      const nextIndex = this.node.nextIndex.get(peerId) || 0;
      const prevLogIndex = nextIndex - 1;
      const prevLogTerm = prevLogIndex >= 0 ? this.node.log[prevLogIndex]?.term || 0 : 0;

      const entries = this.node.log.slice(nextIndex);

      const args: AppendEntriesArgs = {
        term: this.node.currentTerm,
        leaderId: this.nodeId,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommitIndex: this.node.commitIndex
      };

      try {
        const response = await axios.post<AppendEntriesReply>(`${peerUrl}/append-entries`, args, { timeout: 5000 });
        const reply = response.data;

        if (reply.term > this.node.currentTerm) {
          this.node.currentTerm = reply.term;
          this.node.state = RaftState.Follower;
          this.node.votedFor = null;
          this.currentLeader = null;
          this.clearHeartbeatTimer();
          this.startElectionTimer();
          return;
        }

        if (reply.success) {
          this.node.matchIndex.set(peerId, reply.matchIndex);
          this.node.nextIndex.set(peerId, reply.matchIndex + 1);
        } else {
          // Decrement nextIndex and retry
          const current = this.node.nextIndex.get(peerId) || 0;
          if (current > 0) {
            this.node.nextIndex.set(peerId, current - 1);
          }
        }
      } catch (error) {
        this.logger.debug(`Failed to replicate to ${peerId}`, { error: String(error) });
      }
    });

    await Promise.all(replicationPromises);

    // Update commitIndex
    this.updateCommitIndex();
  }

  private updateCommitIndex(): void {
    if (this.node.state !== RaftState.Leader) {
      return;
    }

    for (let index = this.node.log.length - 1; index > this.node.commitIndex; index--) {
      if (this.node.log[index].term !== this.node.currentTerm) {
        continue;
      }

      // Count how many replicas have this entry
      let replicated = 1; // self
      this.peers.forEach((_, peerId) => {
        if ((this.node.matchIndex.get(peerId) || 0) >= index) {
          replicated++;
        }
      });

      const majorityNeeded = Math.floor((this.peers.size + 1) / 2) + 1;
      if (replicated >= majorityNeeded) {
        this.logger.info('Entry committed', { index, replicated, majorityNeeded });
        this.node.commitIndex = index;
        this.applyCommittedEntries();
        break;
      }
    }
  }

  private applyCommittedEntries(): void {
    while (this.node.lastApplied < this.node.commitIndex) {
      this.node.lastApplied++;
      const entry = this.node.log[this.node.lastApplied];
      if (entry) {
        this.logger.debug('Applying entry', { index: this.node.lastApplied });
        this.appliedCallbacks.forEach(callback => callback(entry.stroke));
      }
    }
  }

  /**
   * === RPC HANDLERS ===
   */

  handleRequestVote(args: RequestVoteArgs): RequestVoteReply {
    if (args.term > this.node.currentTerm) {
      this.node.currentTerm = args.term;
      this.node.state = RaftState.Follower;
      this.node.votedFor = null;
      this.currentLeader = null;
      this.clearHeartbeatTimer();
      this.startElectionTimer();
    }

    let voteGranted = false;

    if (args.term === this.node.currentTerm) {
      const lastLogIndex = this.node.log.length - 1;
      const lastLogTerm = lastLogIndex >= 0 ? this.node.log[lastLogIndex].term : 0;

      if (
        (this.node.votedFor === null || this.node.votedFor === args.candidateId) &&
        args.lastLogTerm >= lastLogTerm &&
        args.lastLogIndex >= lastLogIndex
      ) {
        this.node.votedFor = args.candidateId;
        voteGranted = true;
        this.logger.info('Vote granted', {
          candidateId: args.candidateId,
          term: args.term
        });
      }
    }

    return { term: this.node.currentTerm, voteGranted };
  }

  handleAppendEntries(args: AppendEntriesArgs): AppendEntriesReply {
    if (args.term > this.node.currentTerm) {
      this.node.currentTerm = args.term;
      this.node.state = RaftState.Follower;
      this.node.votedFor = null;
      this.startElectionTimer();
    }

    if (args.term === this.node.currentTerm) {
      this.node.state = RaftState.Follower;
      this.currentLeader = args.leaderId;
      this.startElectionTimer();
    }

    let success = false;
    let matchIndex = 0;

    if (args.term >= this.node.currentTerm) {
      // Check if we have prevLogIndex
      if (args.prevLogIndex >= 0 && args.prevLogIndex >= this.node.log.length) {
        // Log doesn't match
        success = false;
        matchIndex = this.node.log.length - 1;
      } else if (
        args.prevLogIndex >= 0 &&
        this.node.log[args.prevLogIndex] &&
        this.node.log[args.prevLogIndex].term !== args.prevLogTerm
      ) {
        // Log mismatch
        success = false;
        matchIndex = args.prevLogIndex - 1;
      } else {
        // Logs match, append entries
        const appendStartIndex = args.prevLogIndex + 1;
        for (let i = 0; i < args.entries.length; i++) {
          const entryIndex = appendStartIndex + i;
          if (entryIndex >= this.node.log.length) {
            this.node.log.push(args.entries[i]);
          } else if (this.node.log[entryIndex].term !== args.entries[i].term) {
            // Conflict, replace
            this.node.log[entryIndex] = args.entries[i];
          }
        }
        matchIndex = appendStartIndex + args.entries.length - 1;
        success = true;

        // Update commitIndex
        if (args.leaderCommitIndex > this.node.commitIndex) {
          this.node.commitIndex = Math.min(args.leaderCommitIndex, this.node.log.length - 1);
          this.applyCommittedEntries();
        }
      }
    }

    return { term: this.node.currentTerm, success, matchIndex };
  }

  handleSyncLog(args: SyncLogArgs): SyncLogReply {
    const entries = this.node.log.slice(args.fromIndex);
    return { entries, lastIndex: this.node.log.length - 1 };
  }

  /**
   * === UTILITIES ===
   */

  onEntryApplied(callback: (stroke: Stroke) => void): void {
    this.appliedCallbacks.push(callback);
  }

  shutdown(): void {
    this.clearElectionTimer();
    this.clearHeartbeatTimer();
    this.logger.info('RAFT node shutdown');
  }
}
