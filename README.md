# Distributed Real-Time Drawing Board with Mini-RAFT Consensus

A production-grade distributed system implementing the RAFT consensus algorithm for a collaborative drawing board with zero-downtime hot-reload capabilities.

## 📋 Project Structure

```
CC-MiniProj-V2/
├── docker-compose.yml          # Docker orchestration
├── package.json                # Project metadata
├── .gitignore                  # Git ignore rules
│
├── gateway/                    # WebSocket Gateway Service
│   ├── index.ts               # Express + WebSocket server
│   ├── logger.ts              # Logging utility
│   ├── types.ts               # TypeScript interfaces
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── .dockerignore
│   └── public/
│       └── index.html         # Browser UI
│
├── replica1/                  # RAFT Node 1
│   ├── index.ts              # HTTP server + RAFT endpoints
│   ├── raftNode.ts           # RAFT consensus implementation
│   ├── logger.ts
│   ├── types.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   └── .dockerignore
│
├── replica2/                 # RAFT Node 2 (identical to replica1)
└── replica3/                 # RAFT Node 3 (identical to replica1)
```

## 🚀 Quick Start

### Prerequisites
- Docker Desktop running
- Terminal/PowerShell access

### Run the System

```bash
# Navigate to project
cd c:\Users\shree\Notes\CC\CC-MiniProj-V2

# Start all services (builds + runs)
docker-compose up --build

# In another terminal, view logs
docker-compose logs -f
```

Wait 10-15 seconds for services to start, then open browser:
**http://localhost:3000**

### Stop the System

```bash
docker-compose down
```

## 📊 Services & Ports

| Service | Port | Role |
|---------|------|------|
| **Gateway** | 3000 | WebSocket server + frontend UI |
| **Replica1** | 4001 | RAFT consensus node |
| **Replica2** | 4002 | RAFT consensus node |
| **Replica3** | 4003 | RAFT consensus node |

## 🎯 Key Features

### ✅ Mini-RAFT Consensus
- **Leader Election**: Random 500-800ms timeouts, first node wins majority
- **Log Replication**: Heartbeats every 150ms keep followers in sync
- **Commit Tracking**: Entries committed when replicated to majority (≥2/3 nodes)
- **Safety**: Higher term always wins, split votes retry election
- **Catch-up**: Restarted nodes sync via `/sync-log` endpoint

### ✅ Real-Time Collaboration
- Browser canvas with live stroke synchronization
- Multi-client concurrent drawing
- Instant consensus propagation
- Color and brush size controls

### ✅ Fault Tolerance
- Leader failover: Auto-election of new leader if current fails
- Byzantine tolerance: System continues with 2/3 nodes healthy
- Hot-reload: Stop/restart any replica, cluster recovers automatically
- Graceful shutdown: SIGTERM/SIGINT handlers for clean exit

### ✅ Zero-Downtime Deployments
- Health checks ensure only healthy nodes join consensus
- Bind mounts allow source code updates without rebuild
- Automatic container restart on failure
- No client disconnection during replica replacement

## 📡 API Endpoints

### Gateway (Port 3000)
- **GET** `/` - Serve index.html with drawing UI
- **GET** `/health` - Health check
- **WS** `/ws` - WebSocket for client connections

### Replicas (Ports 4001-4003)
- **GET** `/health` - Health check
- **GET** `/status` - RAFT node status (role, term, leader, etc.)
- **GET** `/leader` - Current leader URL
- **GET** `/strokes` - All committed strokes
- **POST** `/request-vote` - RAFT RPC for leader election
- **POST** `/append-entries` - RAFT RPC for log replication
- **POST** `/stroke` - Submit drawing stroke (as JSON body)
- **POST** `/clear` - Clear all strokes
- **GET** `/sync-log/:fromIndex` - Get log entries from index N

## 🔬 Testing & Verification

### Test 1: Basic Drawing
1. Open http://localhost:3000
2. Draw strokes on canvas
3. Verify strokes appear in real-time
4. **Expected**: Strokes sync across all replicas via RAFT consensus

### Test 2: Leader Failover
1. Open http://localhost:3000 and draw strokes
2. Stop current leader: `docker-compose stop replica1` (or replica2/3)
3. Continue drawing
4. **Expected**: New leader elected, strokes continue syncing seamlessly

### Test 3: Multi-Client Sync
1. Open http://localhost:3000 in 2+ browser tabs
2. Draw in tab A
3. **Expected**: Strokes appear instantly in tab B, C, etc.

### Test 4: Clear Canvas
1. Draw strokes
2. Click "Clear Canvas" button
3. **Expected**: All clients' canvases clear immediately via RAFT commit

### Test 5: Hot Reload
1. Edit `gateway/public/index.html` (e.g., change title)
2. Restart gateway: `docker-compose restart gateway`
3. **Expected**: UI updates without losing connected clients

## 📖 RAFT Specification

### Election Timeout: 500-800ms
- Follower waits this long without heartbeat before becoming candidate
- Candidate increments term, votes for itself, requests votes from peers
- Peer voting logic:
  - Only votes for candidate with same or newer term
  - Candidate must have log at least as complete as voter
  - Candidate with majority votes becomes leader

### Heartbeat Interval: 150ms
- Leader sends AppendEntries RPC to all followers
- Carries current term and leader ID to reset election timeouts
- Followers append new log entries and acknowledge

### Log Replication
1. Client sends stroke to gateway
2. Gateway forwards to leader's `/stroke` endpoint
3. Leader appends to its log
4. Leader sends AppendEntries to all followers
5. Followers append to their logs, acknowledge
6. Leader marks entry committed when majority acknowledges
7. Leader broadcast stroke to gateway
8. Gateway sends to all WebSocket clients

### Catch-Up Synchronization
- Restarted node joins as follower with empty log
- First AppendEntries from leader will have `prevLogIndex` check fail
- Leader sends `/sync-log` endpoint call with missing entries
- Follower appends missing entries, updates commit index
- Follower is now in sync and participates normally

## 🔧 Development Commands

```bash
# Build images (without running)
docker-compose build

# Start in foreground (see logs directly)
docker-compose up

# Start in background
docker-compose up -d

# View logs for specific service
docker-compose logs -f gateway
docker-compose logs -f replica1

# View logs for all services
docker-compose logs -f

# Restart service
docker-compose restart replica1

# Stop all services
docker-compose down

# Remove volumes and networks too
docker-compose down -v

# Into shell of running container
docker-compose exec replica1 sh
```

## 🐛 Troubleshooting

### "Cannot GET /"
- Gateway can't find public/index.html
- Check: `ls gateway/public/index.html`
- Rebuild: `docker-compose up --build`

### "No leader available"
- Replicas not elected a leader yet (takes 500-800ms)
- Wait 5-10 seconds and retry drawing

### WebSocket "Connecting..."
- Gateway not running: `docker-compose ps`
- Browser console (F12) for detailed errors
- Rebuild gateway: `docker-compose up --build gateway`

### Port already in use
```bash
# Find process using port
netstat -ano | findstr :3000

# Kill process
taskkill /PID <PID> /F
```

### Containers won't start
- Check logs: `docker-compose logs`
- Ensure Docker daemon is running
- Rebuild: `docker system prune -a && docker-compose up --build`

## 📚 Learning Outcomes

This project teaches:

1. **Distributed Consensus**: RAFT algorithm, term-based elections, quorum validation
2. **Fault Tolerance**: Leader failover, Byzantine resilience with quorum
3. **State Replication**: Log-based append-only storage, commit tracking
4. **Real-Time Systems**: WebSocket, low-latency event propagation
5. **Cloud DevOps**: Docker, docker-compose, health checks, graceful shutdown
6. **Zero-Downtime Deployments**: Blue-green updates via container restart
7. **Microservices**: Service discovery, inter-service RPC communication

## 📝 License

MIT - Use freely for educational and commercial purposes.

---

**Now running in CC-MiniProj-V2 for flawless execution!** 🚀
