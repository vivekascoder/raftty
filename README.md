# Raft Node

A visual Raft consensus algorithm node built with Next.js.
Run multiple instances on different ports to form a cluster.

## Run

```bash
# Node 1 (default port 3000)
pnpm dev

# Node 2
PORT=3001 pnpm dev

# Node 3
PORT=3002 pnpm dev
```

## Connect peers

1. Open each node in the browser (`localhost:3000`, `localhost:3001`, etc.)
2. In the **Peers** panel, type the URL of another node and click **Add**
3. Do this on both sides — peers are not auto-discovered

Example: on node `:3000`, add `http://localhost:3001`, and vice versa.

## How it works

- Nodes start as **followers** and hold an election after 2–4 s with no heartbeat
- A candidate needs a majority vote to become **leader**
- The **leader** replicates log entries to followers via heartbeats every 500 ms
- An entry is **committed** once the majority acknowledges it

## Submit data

Type a command + payload in the **Submit Entry** form and press **Commit**.
If the current node is not the leader, it automatically forwards to the leader.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/raft/state` | Full node state (JSON) |
| `POST` | `/api/raft/vote` | RequestVote RPC |
| `POST` | `/api/raft/append-entries` | AppendEntries RPC |
| `GET/POST/DELETE` | `/api/raft/peers` | Manage peers |
| `POST` | `/api/raft/submit` | Submit a log entry |
