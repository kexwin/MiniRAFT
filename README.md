# Distributed Real-Time Drawing Board with Mini-RAFT Consensus

A production-grade distributed system implementing RAFT consensus protocol for real-time collaborative drawing with zero-downtime deployments.

## 📋 Project Structure

```
CC-MiniProj/
├── src/
│   ├── types.ts           # Shared RAFT & protocol types
│   └── logger.ts          # Logging utility
├── replica1/              # RAFT Replica Node 1
│   ├── index.ts
│   ├── raftNode.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── replica2/              # RAFT Replica Node 2 (identical structure)
├── replica3/              # RAFT Replica Node 3 (identical structure)
├── gateway/               # WebSocket Gateway
│   ├── index.ts
│   ├── public/index.html  # Frontend UI
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── docker-compose.yml     # Container orchestration
├── package.json           # Root package
├── .gitignore
└── README.md
```

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local development)
- npm/yarn

### Run with Docker Compose (Recommended)

```bash
cd CC-MiniProj
docker-compose up --build
```

Access the drawing board at: **http://localhost:3000**

### Run Locally (Development)

```bash
# Terminal 1: Replica 1
cd replica1
npm install
npm run build
REPLICA_ID=replica1 PORT=4001 PEERS=replica2:4002,replica3:4003 npm start

# Terminal 2: Replica 2
cd replica2
npm install
npm run build
REPLICA_ID=replica2 PORT=4002 PEERS=replica1:4001,replica3:4003 npm start

# Terminal 3: Replica 3
cd replica3
npm install
npm run build
REPLICA_ID=replica3 PORT=4003 PEERS=replica1:4001,replica2:4002 npm start

# Terminal 4: Gateway
cd gateway
npm install
npm run build
npm start
```

## 🏗 Architecture

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Clients                      │
│              (WebSocket: ws://localhost:3000)           │
└───────────────────────┬─────────────────────────────────┘
                        │
                        │ WebSocket
                        ▼
┌─────────────────────────────────────────────────────────┐
│                   Gateway (Port 3000)                   │
│  • WebSocket Server (client management)                │
│  • Leader Discovery & Health Checks                    │
│  • Route strokes to current leader                     │
│  • Broadcast committed strokes to clients              │
└───────────┬─────────────────────────────────────────────┘
            │
      HTTP │ RPC Calls
            │
    ┌───────┴────────────────────────────┐
    │                                    │
    ▼                                    ▼
┌──────────────────┐           ┌──────────────────┐
│ Replica 1        │           │ Replica 2        │
│ (4001)           │───────────│ (4002)           │
│                  │   RAFT    │                  │
│ ┌──────────────┐ │  Cluster  │ ┌──────────────┐ │
│ │ RAFT Node    │ │           │ │ RAFT Node    │ │
│ │ - Leader Elec │◄──────────►│ │ - Log Repl   │ │
│ │ - Log Repl   │ │           │ │ - Sync       │ │
│ └──────────────┘ │           │ └──────────────┘ │
└──────────────────┘           └──────────────────┘
         ▲                              ▲
         │                              │
         └──────────┬───────────────────┘
                    │
                    ▼
            ┌──────────────────┐
            │ Replica 3        │
            │ (4003)           │
            │                  │
            │ ┌──────────────┐ │
            │ │ RAFT Node    │ │
            │ │ - Candidate  │ │
            │ │ - Follower   │ │
            │ └──────────────┘ │
            └──────────────────┘
```

## 📡 RAFT Protocol Specification

### Node States
- **Follower**: Waits for heartbeats from leader
- **Candidate**: Attempts to become leader during elections
- **Leader**: Handles client requests and log replication

### Timings
- **Election Timeout**: 500-800ms (random)
- **Heartbeat Interval**: 150ms (leader only)

### RPCs Implemented

#### 1. RequestVote RPC
Candidates initiate elections.
```typescript
Request:
{
  term: number,
  candidateId: string,
  lastLogIndex: number,
  lastLogTerm: number
}

Response:
{
  term: number,
  voteGranted: boolean
}
```

#### 2. AppendEntries RPC
Leader replicates logs and sends heartbeats.
```typescript
Request:
{
  term: number,
  leaderId: string,
  prevLogIndex: number,
  prevLogTerm: number,
  entries: LogEntry[],
  leaderCommitIndex: number
}

Response:
{
  term: number,
  success: boolean,
  matchIndex: number
}
```

#### 3. SyncLog RPC
Followers request missing log entries for catch-up.
```typescript
Request:
{
  fromIndex: number
}

Response:
{
  entries: LogEntry[],
  lastIndex: number
}
```

### Stroke Replication Flow

```
Client → Gateway → Leader:
1. Client draws stroke
2. Gateway finds current leader
3. POST /stroke → leader with stroke data
4. Leader appends to local log
5. Replicates to followers via AppendEntries
6. Followers respond with success/matchIndex
7. Leader waits for majority acknowledgment
8. Leader marks entry as committed
9. Broadcasts committed stroke to Gateway
10. Gateway broadcasts to all clients via WebSocket
```

## 🎯 API Reference

### Replica Node Endpoints

#### POST /request-vote
Candidate requests votes during election.

#### POST /append-entries
Leader sends log entries to follower.

#### POST /sync-log
Follower requests missing entries.

#### POST /stroke
Client submits a stroke (leader only).
```json
{
  "id": "stroke-123",
  "x0": 100,
  "y0": 50,
  "x1": 150,
  "y1": 100,
  "color": "#000000",
  "size": 2,
  "timestamp": 1234567890
}
```

#### GET /strokes
Retrieve all committed strokes.

#### GET /health
Health check - returns node state.

#### GET /state
Debug endpoint - full node state.

### Gateway Endpoints

#### GET /health
Gateway health check.

#### GET /cluster-status
Status of all replicas.

#### WebSocket: ws://gateway:3000
Two-way real-time communication.

**Client → Server Messages:**
```json
// Submit a stroke
{
  "type": "stroke",
  "stroke": { /* Stroke object */ }
}

// Request state sync
{
  "type": "sync-request"
}
```

**Server → Client Messages:**
```json
// New stroke from leader
{
  "type": "stroke",
  "stroke": { /* Stroke object */ }
}

// Full state sync
{
  "type": "state-sync",
  "strokes": [ /* All strokes */ ],
  "commitIndex": 5,
  "leader": "replica1",
  "term": 3
}

// Error
{
  "type": "error",
  "error": "No leader available"
}
```

## 👥 Team Task Distribution

### Team Member Roles (4 people)

#### **Member 1: RAFT Core Implementation**
- Implement `RaftConsensusNode` class (raftNode.ts)
- Election logic (RequestVote, timeouts)
- Heartbeat mechanism
- Safety rules & term management
- **Sprint**: Week 1-2 (primary), Week 3 (refinement)

#### **Member 2: Log Replication & Commit Logic**
- AppendEntries RPC handling
- Log matching & replication
- Commit index calculation
- Recovery log truncation
- **Sprint**: Week 2 (primary), Week 3 (testing)

#### **Member 3: Gateway & WebSocket**
- WebSocket server implementation
- Leader discovery & health checks
- Client connection management
- Failover handling
- **Sprint**: Week 1-2 (core), Week 3 (reliability)

#### **Member 4: Frontend & Testing**
- HTML Canvas drawing UI
- WebSocket client logic
- System testing & chaos testing
- Documentation & demo
- **Sprint**: Week 2-3

---

## 📅 3-Week Milestone Plan

### **WEEK 1: Design & Core Implementation**

**Deliverables:**
- [x] System architecture diagram
- [x] RAFT protocol specification document
- [x] API specs (RequestVote, AppendEntries, Heartbeat)
- [x] Docker-compose configuration
- [ ] Failure scenario list
- [x] Initial code scaffolding (types, logger, basic structs)

**Tasks:**
1. **Set up project structure** (all)
2. **Implement RAFT state machine** (Member 1)
   - RaftNode interface
   - State transitions (Follower/Candidate/Leader)
   - Term management
3. **Election logic** (Member 1)
   - Election timeout mechanism
   - RequestVote RPC
   - Vote granting logic
4. **Gateway skeleton** (Member 3)
   - WebSocket server setup
   - Replica communication
   - Health checks

**Acceptance Criteria:**
- [ ] One node can be elected as leader
- [ ] All three nodes participate in voting
- [ ] Leader election completes within 1 second
- [ ] No split brain scenarios

---

### **WEEK 2: Core Implementation & Integration**

**Deliverables:**
- [ ] Working leader election
- [ ] Log replication consensus
- [ ] Canvas drawing UI
- [ ] End-to-end stroke pipeline
- [ ] Basic chaos tests (kill one replica, observe recovery)

**Tasks:**
1. **Log replication** (Member 2)
   - AppendEntries RPC with log matching
   - nextIndex/matchIndex tracking
   - Heartbeat mechanism (150ms)
2. **Commit logic** (Member 2)
   - Majority quorum calculation
   - Commit index advancement
   - Entry application callbacks
3. **Replica server integration** (Member 1 + 2)
   - HTTP server endpoints
   - RAFT RPC listeners
   - Stroke API (/stroke, /strokes)
4. **Frontend UI** (Member 4)
   - Canvas drawing
   - WebSocket client
   - Real-time stroke rendering
5. **Gateway integration** (Member 3)
   - Route strokes to leader
   - Broadcast committed strokes
   - Reconnection logic

**Acceptance Criteria:**
- [ ] Draw a stroke on canvas
- [ ] Stroke appears on all clients in < 200ms
- [ ] Stop leader, new leader elected within 1 second
- [ ] Strokes continue flowing through new leader
- [ ] No data loss when replica restarts

---

### **WEEK 3: Reliability & Zero-Downtime**

**Deliverables:**
- [ ] Graceful container reload
- [ ] Blue-green replica replacement
- [ ] Production-ready error handling
- [ ] Chaos testing report
- [ ] Demo video showing failover
- [ ] Final documentation

**Tasks:**
1. **Catch-up synchronization** (Member 1 + 2)
   - Implement /sync-log RPC
   - Handle restarted nodes with empty logs
   - Full log synchronization on rejoin
2. **Zero-downtime deployment** (Member 3)
   - Graceful shutdown (SIGTERM handling)
   - Client reconnection logic
   - Leader detection after restart
3. **Fault tolerance testing** (Member 4)
   - Kill replica while drawing
   - Restart replica and verify sync
   - Simultaneous multiple kills (chaos)
   - Network partition scenarios
4. **Code quality**
   - Add logging at all critical points
   - Error handling in all RPCs
   - Timeout management

**Acceptance Criteria:**
- [ ] Restart any replica, system continues without data loss
- [ ] Hot-reload via docker volume changes
- [ ] All clients stay connected during failover
- [ ] No duplicate strokes
- [ ] All replicas converge to same state

---

## 🔧 Development Commands

### Start Everything
```bash
docker-compose up --build
```

### View Logs
```bash
docker-compose logs -f            # All services
docker-compose logs -f replica1   # Specific service
```

### Stop All Services
```bash
docker-compose down
```

### Rebuild & Restart a Single Replica
```bash
docker-compose down replica1
docker-compose up -d replica1
```

### Access Replica Health Endpoint
```bash
curl http://localhost:4001/health
curl http://localhost:4002/state
curl http://localhost:4003/strokes
```

### Access Gateway Cluster Status
```bash
curl http://localhost:3000/cluster-status
```

### Simulate Network Partition (Linux/Mac)
```bash
# Disconnect replica1 from network
docker network disconnect raft_network drawing-replica1

# Reconnect
docker network connect raft_network drawing-replica1
```

---

## 📊 Key Metrics to Track

### Performance
- **Time to elect new leader**: Target < 1 second
- **Stroke propagation latency**: Target < 200ms
- **Sync time for restarted node**: Target < 500ms

### Reliability
- **Failed RPCs handled gracefully**: Yes
- **No split-brain scenarios**: Verified
- **All strokes committed before client ack**: Yes

### Testing Coverage
- [ ] Single replica failure
- [ ] Double replica failure
- [ ] Network partition
- [ ] Delayed message delivery
- [ ] Concurrent client submissions
- [ ] Hot reload without interruption

---

## 🐛 Debugging Tips

### Enable Debug Logging
Edit `src/logger.ts` to set `LogLevel.DEBUG` for verbose output.

### Check Current Leader
```bash
curl http://localhost:3000/cluster-status | jq
```

### Verify Log Replication
```bash
curl http://localhost:4001/state | jq '.logLength'
curl http://localhost:4002/state | jq '.logLength'
curl http://localhost:4003/state | jq '.logLength'
```

### Monitor Elections
Watch container logs during crashes:
```bash
docker-compose logs -f | grep "election\|leader\|term"
```

---

## 🎓 Learning Outcomes

After completing this project, you will understand:

1. **RAFT Consensus** - How distributed systems agree on state
2. **Leader Election** - Term-based voting & timeout mechanisms
3. **Log Replication** - Consistency across replicas
4. **Fault Tolerance** - Recovery from node failures
5. **Network RPC** - Distributed communication patterns
6. **WebSocket Architecture** - Real-time bidirectional communication
7. **Microservice Patterns** - Service discovery, health checks
8. **Docker Orchestration** - Multi-container deployments
9. **Testing Distributed Systems** - Chaos engineering basics
10. **Production Reliability** - Graceful shutdown, monitoring, observability

---

## 📚 References

- **RAFT Consensus Paper**: https://raft.github.io/raft.pdf
- **RAFT Visualization**: https://raft.github.io/raftscope/
- **Express.js Docs**: https://expressjs.com/
- **WebSocket MDN**: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- **Docker Compose**: https://docs.docker.com/compose/

---

## 📝 Notes

- **Persistent Storage**: This implementation stores log entries in memory. For production, add RocksDB or LevelDB.
- **Cluster Scalability**: Current design supports 3 replicas. Easily extendable to 5, 7+ for larger quorums.
- **Security**: Add TLS/mTLS for inter-node communication in production.
- **Monitoring**: Integrate Prometheus metrics for observability.

---

**Maintained by**: CC-Team  
**Last Updated**: March 2026  
**Status**: In Development
