# Mini RAFT - Distributed Consensus System

A distributed drawing board implementing the RAFT consensus protocol using TypeScript, Node.js, and Docker Compose.

## 📋 Project Structure

```
├── src/              # Shared types & utilities
├── replica1/         # RAFT Node 1
├── replica2/         # RAFT Node 2
├── replica3/         # RAFT Node 3
├── gateway/          # WebSocket Gateway
└── docker-compose.yml
```

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+

### Run with Docker
```bash
docker-compose up --build
```
Access at: **http://localhost:3000**

### Run Locally
```bash
# Terminal 1: Replica 1
cd replica1 && npm install && REPLICA_ID=replica1 PORT=4001 PEERS=replica2:4002,replica3:4003 npm start

# Terminal 2: Replica 2
cd replica2 && npm install && REPLICA_ID=replica2 PORT=4002 PEERS=replica1:4001,replica3:4003 npm start

# Terminal 3: Replica 3
cd replica3 && npm install && REPLICA_ID=replica3 PORT=4003 PEERS=replica1:4001,replica2:4002 npm start

# Terminal 4: Gateway
cd gateway && npm install && npm start
```

## 🏗 Architecture

- **3 RAFT Replicas** (Follower/Candidate/Leader states)
- **WebSocket Gateway** (client communication)
- **Leader Election** with RequestVote RPC
- **Log Replication** via AppendEntries RPC
- **Real-time drawing** with stroke broadcasting

## 🔧 Commands

```bash
docker-compose up --build          # Start all services
docker-compose down                # Stop all services
docker-compose logs -f replica1    # View replica logs
curl http://localhost:4001/health  # Check replica health
```
