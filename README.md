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
