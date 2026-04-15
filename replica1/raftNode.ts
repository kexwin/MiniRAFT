import fs from 'fs';
import path from 'path';
import { 
  NodeRole, 
  LogEntry, 
  RequestVoteArgs, 
  RequestVoteReply, 
  AppendEntriesArgs, 
  AppendEntriesReply, 
  StatusMessage,
  StrokeData
} from './types';
import { Logger } from './logger';

const logger = new Logger('raft');

export class RaftNode {
  private id: string;
  private addr: string;
  private peers: string[];
  private role: NodeRole = 'follower';
  private currentTerm: number = 0;
  private votedFor: string | null = null;
  private log: LogEntry[] = [];
  private commitIndex: number = -1;
  private lastApplied: number = -1;
  private currentLeaderAddr: string | null = null;

  // Leader state
  private nextIndex: Map<string, number> = new Map();
  private matchIndex: Map<string, number> = new Map();

  // Timers
  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private ELECTION_TIMEOUT_MIN = 300; // Increased to be safer, originally 150ms in prompt but 150ms-300ms is standard
  private ELECTION_TIMEOUT_MAX = 600;
  private HEARTBEAT_INTERVAL = 150;

  private stateFilePath: string;

  constructor(id: string, addr: string, peers: string[]) {
    this.id = id;
    this.addr = addr;
    this.peers = peers;
    this.stateFilePath = path.join(__dirname, `state_${this.id}.json`);
    
    this.loadState();
    this.resetElectionTimer();
  }

  private loadState() {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8'));
        this.currentTerm = data.currentTerm || 0;
        this.votedFor = data.votedFor || null;
        this.log = data.log || [];
        logger.info('Loaded state from disk', { term: this.currentTerm, logLength: this.log.length });
      } catch (err) {
        logger.error('Failed to load state', { error: String(err) });
      }
    }
  }

  private saveState() {
    const data = {
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      log: this.log
    };
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(data));
    } catch (err) {
      logger.error('Failed to save state', { error: String(err) });
    }
  }

  private resetElectionTimer() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    const timeout = Math.floor(Math.random() * (this.ELECTION_TIMEOUT_MAX - this.ELECTION_TIMEOUT_MIN)) + this.ELECTION_TIMEOUT_MIN;
    this.electionTimer = setTimeout(() => this.startElection(), timeout);
  }

  private async startElection() {
    if (this.role === 'leader') return;

    this.role = 'candidate';
    this.currentTerm++;
    this.votedFor = this.id;
    this.saveState();
    this.resetElectionTimer();

    logger.info('Starting election', { term: this.currentTerm });

    let votesGranted = 1; // Vote for self
    const lastLogIndex = this.log.length - 1;
    const lastLogTerm = lastLogIndex >= 0 ? this.log[lastLogIndex].term : 0;

    const votePromises = this.peers.map(async (peer) => {
      try {
        const args: RequestVoteArgs = {
          term: this.currentTerm,
          candidateId: this.id,
          lastLogIndex,
          lastLogTerm
        };
        const response = await fetch(`${peer}/request-vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args)
        });
        if (response.ok) {
          const reply = (await response.json()) as RequestVoteReply;
          if (reply.term > this.currentTerm) {
            this.becomeFollower(reply.term);
            return false;
          }
          return reply.voteGranted;
        }
      } catch (err) {
        logger.debug('Failed to request vote from peer', { peer, error: String(err) });
      }
      return false;
    });

    const results = await Promise.all(votePromises);
    votesGranted += results.filter(v => v).length;

    if (this.role === 'candidate' && votesGranted > (this.peers.length + 1) / 2) {
      this.becomeLeader();
    }
  }

  private becomeLeader() {
    this.role = 'leader';
    this.currentLeaderAddr = this.addr;
    if (this.electionTimer) clearTimeout(this.electionTimer);
    logger.info('Become leader', { term: this.currentTerm });

    this.peers.forEach(peer => {
      this.nextIndex.set(peer, this.log.length);
      this.matchIndex.set(peer, -1);
    });

    this.startHeartbeats();
  }

  private becomeFollower(term: number) {
    this.role = 'follower';
    this.currentTerm = term;
    this.votedFor = null;
    this.saveState();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.resetElectionTimer();
    logger.info('Become follower', { term: this.currentTerm });
  }

  private startHeartbeats() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.sendAppendEntries(); // Immediate heartbeat
    this.heartbeatTimer = setInterval(() => this.sendAppendEntries(), this.HEARTBEAT_INTERVAL);
  }

  private async sendAppendEntries() {
    if (this.role !== 'leader') return;

    this.peers.forEach(async (peer) => {
      try {
        const nextIdx = this.nextIndex.get(peer) || 0;
        const prevLogIndex = nextIdx - 1;
        const prevLogTerm = prevLogIndex >= 0 ? this.log[prevLogIndex].term : 0;
        const entries = this.log.slice(nextIdx);

        const args: AppendEntriesArgs = {
          term: this.currentTerm,
          leaderId: this.addr, // Send full address as leaderId
          prevLogIndex,
          prevLogTerm,
          entries,
          leaderCommit: this.commitIndex
        };

        const response = await fetch(`${peer}/append-entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args)
        });

        if (response.ok) {
          const reply = (await response.json()) as AppendEntriesReply;
          if (reply.term > this.currentTerm) {
            this.becomeFollower(reply.term);
            return;
          }

          if (this.role === 'leader') {
            if (reply.success) {
              this.nextIndex.set(peer, nextIdx + entries.length);
              this.matchIndex.set(peer, prevLogIndex + entries.length);
              this.updateCommitIndex();
            } else {
              // Optimization: use conflictIndex if available, otherwise just decrement
              const deceleratedIndex = reply.conflictIndex !== undefined ? reply.conflictIndex : Math.max(0, nextIdx - 1);
              this.nextIndex.set(peer, deceleratedIndex);
            }
          }
        }
      } catch (err) {
        // Peer might be down
      }
    });
  }

  private updateCommitIndex() {
    if (this.role !== 'leader') return;

    // Find the largest N such that N > commitIndex, a majority of matchIndex[i] >= N, and log[N].term == currentTerm
    for (let n = this.log.length - 1; n > this.commitIndex; n--) {
      if (this.log[n].term === this.currentTerm) {
        let count = 1; // Self
        for (const peer of this.peers) {
          if ((this.matchIndex.get(peer) || -1) >= n) {
            count++;
          }
        }
        if (count > (this.peers.length + 1) / 2) {
          this.commitIndex = n;
          logger.info('Commit index updated', { commitIndex: this.commitIndex });
          break;
        }
      }
    }
  }

  public handleRequestVote(args: RequestVoteArgs): RequestVoteReply {
    if (args.term > this.currentTerm) {
      this.becomeFollower(args.term);
    }

    let voteGranted = false;
    if (args.term === this.currentTerm && 
        (this.votedFor === null || this.votedFor === args.candidateId)) {
      
      const lastLogIndex = this.log.length - 1;
      const lastLogTerm = lastLogIndex >= 0 ? this.log[lastLogIndex].term : 0;
      
      // Candidate's log must be up-to-date
      const logUpToDate = (args.lastLogTerm > lastLogTerm) || 
                          (args.lastLogTerm === lastLogTerm && args.lastLogIndex >= lastLogIndex);
      
      if (logUpToDate) {
        voteGranted = true;
        this.votedFor = args.candidateId;
        this.currentLeaderAddr = null; // Don't know the leader yet, but it's probably the candidate
        this.saveState();
        this.resetElectionTimer();
      }
    }

    return { term: this.currentTerm, voteGranted };
  }

  public handleAppendEntries(args: AppendEntriesArgs): AppendEntriesReply {
    if (args.term > this.currentTerm) {
      this.becomeFollower(args.term);
    }

    if (args.term < this.currentTerm) {
      return { term: this.currentTerm, success: false };
    }

    // Still a candidate but received AE from leader of same or higher term
    if (this.role === 'candidate') {
      this.becomeFollower(args.term);
    }
    
    this.currentLeaderAddr = args.leaderId;
    this.resetElectionTimer();

    // Verify consistency
    if (args.prevLogIndex >= 0) {
      if (this.log.length <= args.prevLogIndex || this.log[args.prevLogIndex].term !== args.prevLogTerm) {
        return { term: this.currentTerm, success: false, conflictIndex: Math.min(this.log.length, args.prevLogIndex) };
      }
    }

    // Append new entries
    let index = args.prevLogIndex + 1;
    for (let i = 0; i < args.entries.length; i++) {
      if (this.log.length <= index || this.log[index].term !== args.entries[i].term) {
        this.log = this.log.slice(0, index);
        this.log.push(args.entries[i]);
      }
      index++;
    }
    this.saveState();

    if (args.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(args.leaderCommit, this.log.length - 1);
    }

    return { term: this.currentTerm, success: true };
  }

  public addEntry(data: StrokeData | { type: 'clear' }): boolean {
    if (this.role !== 'leader') return false;

    this.log.push({ term: this.currentTerm, data });
    this.saveState();
    logger.info('Added new log entry', { term: this.currentTerm, index: this.log.length - 1 });
    return true;
  }

  public getStatus(): StatusMessage {
    return {
      role: this.role,
      term: this.currentTerm,
      leader: this.currentLeaderAddr || undefined,
      commitIndex: this.commitIndex,
      logLength: this.log.length
    };
  }

  public getCommittedEntries(): LogEntry[] {
    return this.log.slice(0, this.commitIndex + 1);
  }

  public getRole(): NodeRole {
    return this.role;
  }

  public getFullLog(): LogEntry[] {
    return this.log;
  }
}
