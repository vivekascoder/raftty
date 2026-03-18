// Raft consensus algorithm — single-node implementation
// This module is a singleton held in `globalThis` so it survives Next.js HMR

export type NodeState = 'follower' | 'candidate' | 'leader';

export interface LogEntry {
  index: number;
  term: number;
  command: string;
  data?: unknown;
  timestamp: number;
}

export interface PeerInfo {
  url: string;
  lastSeen: number | null;
  state: NodeState | null;
  term: number | null;
}

export interface MessageEvent {
  id: string;
  from: string;
  to: string;
  type: 'vote_request' | 'vote_response' | 'append_entries' | 'append_entries_response';
  timestamp: number;
  success?: boolean;
}

class RaftNode {
  readonly id: string;
  readonly selfUrl: string;

  state: NodeState = 'follower';
  currentTerm = 0;
  votedFor: string | null = null;
  leaderUrl: string | null = null;

  log: LogEntry[] = [];
  commitIndex = -1;
  lastApplied = -1;

  peers: Map<string, PeerInfo> = new Map();

  networkDelay = 0;
  messages: MessageEvent[] = [];

  // Leader-only volatile state
  private nextIndex: Map<string, number> = new Map();
  private matchIndex: Map<string, number> = new Map();

  // Election bookkeeping
  private votesReceived: Set<string> = new Set();

  private electionTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private readonly ELECTION_TIMEOUT_MIN = 2000;
  private readonly ELECTION_TIMEOUT_MAX = 4000;
  private readonly HEARTBEAT_INTERVAL = 500;

  constructor(selfUrl: string) {
    this.id = crypto.randomUUID();
    this.selfUrl = selfUrl;
    this.resetElectionTimer();
  }

  // ─── Delay & message tracking ─────────────────────────────────────

  private delay(ms: number) {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  private logMessage(msg: Omit<MessageEvent, 'id' | 'timestamp'>) {
    this.messages.push({ ...msg, id: crypto.randomUUID(), timestamp: Date.now() });
    if (this.messages.length > 200) this.messages = this.messages.slice(-200);
  }

  setNetworkDelay(ms: number) {
    this.networkDelay = Math.max(0, Math.min(5000, ms));
  }

  // ─── Timer helpers ────────────────────────────────────────────────

  private randomElectionTimeout() {
    return (
      this.ELECTION_TIMEOUT_MIN +
      Math.random() * (this.ELECTION_TIMEOUT_MAX - this.ELECTION_TIMEOUT_MIN)
    );
  }

  resetElectionTimer() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    this.electionTimer = setTimeout(
      () => this.startElection(),
      this.randomElectionTimeout()
    );
  }

  // ─── State transitions ────────────────────────────────────────────

  private becomeFollower(term: number, leaderUrl: string | null = null) {
    this.state = 'follower';
    this.currentTerm = term;
    this.votedFor = null;
    this.leaderUrl = leaderUrl;
    this.votesReceived.clear();

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.resetElectionTimer();
  }

  private async startElection() {
    this.state = 'candidate';
    this.currentTerm++;
    this.votedFor = this.id;
    this.votesReceived = new Set([this.id]);
    this.leaderUrl = null;

    this.resetElectionTimer();

    const peerUrls = [...this.peers.keys()];
    const clusterSize = peerUrls.length + 1;
    const majority = Math.floor(clusterSize / 2) + 1;

    // Single-node cluster — win immediately
    if (clusterSize === 1) {
      this.becomeLeader();
      return;
    }

    const lastLog = this.log[this.log.length - 1];
    const lastLogIndex = lastLog ? lastLog.index : -1;
    const lastLogTerm = lastLog ? lastLog.term : 0;

    await Promise.all(
      peerUrls.map(async (peerUrl) => {
        try {
          await this.delay(this.networkDelay);
          this.logMessage({ from: this.selfUrl, to: peerUrl, type: 'vote_request' });

          const res = await fetch(`${peerUrl}/api/raft/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              term: this.currentTerm,
              candidateId: this.id,
              candidateUrl: this.selfUrl,
              lastLogIndex,
              lastLogTerm,
            }),
            signal: AbortSignal.timeout(1500),
          });

          const vote = (await res.json()) as {
            term: number;
            voteGranted: boolean;
          };

          this.logMessage({ from: peerUrl, to: this.selfUrl, type: 'vote_response', success: vote.voteGranted });

          if (vote.term > this.currentTerm) {
            this.becomeFollower(vote.term);
            return;
          }

          if (this.state !== 'candidate') return;

          if (vote.voteGranted) {
            this.votesReceived.add(peerUrl);
            if (this.votesReceived.size >= majority) this.becomeLeader();
          }
        } catch {
          // peer unreachable
        }
      })
    );

    // Final check after all responses
    if (this.state === 'candidate' && this.votesReceived.size >= majority) {
      this.becomeLeader();
    }
  }

  private becomeLeader() {
    if (this.state !== 'candidate') return;

    this.state = 'leader';
    this.leaderUrl = this.selfUrl;

    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }

    const lastLogIndex =
      this.log.length > 0 ? this.log[this.log.length - 1].index : -1;

    for (const url of this.peers.keys()) {
      this.nextIndex.set(url, lastLogIndex + 1);
      this.matchIndex.set(url, -1);
    }

    // Send immediate heartbeat, then on interval
    this.replicateToAll();
    this.heartbeatTimer = setInterval(
      () => this.replicateToAll(),
      this.HEARTBEAT_INTERVAL
    );
  }

  // ─── Log replication ──────────────────────────────────────────────

  private replicateToAll() {
    if (this.state !== 'leader') return;
    for (const url of this.peers.keys()) {
      this.replicateTo(url).catch(() => {});
    }
  }

  private async replicateTo(peerUrl: string) {
    if (this.state !== 'leader') return;

    const nextIdx = this.nextIndex.get(peerUrl) ?? 0;
    const prevLogIndex = nextIdx - 1;
    const prevEntry =
      prevLogIndex >= 0
        ? this.log.find((e) => e.index === prevLogIndex)
        : null;
    const prevLogTerm = prevEntry ? prevEntry.term : 0;
    const entries = this.log.filter((e) => e.index >= nextIdx);

    try {
      await this.delay(this.networkDelay);
      this.logMessage({ from: this.selfUrl, to: peerUrl, type: 'append_entries' });

      const res = await fetch(`${peerUrl}/api/raft/append-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term: this.currentTerm,
          leaderId: this.id,
          leaderUrl: this.selfUrl,
          prevLogIndex,
          prevLogTerm,
          entries,
          leaderCommit: this.commitIndex,
        }),
        signal: AbortSignal.timeout(1500),
      });

      const reply = (await res.json()) as {
        term: number;
        success: boolean;
        state?: NodeState;
      };

      this.logMessage({ from: peerUrl, to: this.selfUrl, type: 'append_entries_response', success: reply.success });

      if (reply.term > this.currentTerm) {
        this.becomeFollower(reply.term);
        return;
      }

      if (this.state !== 'leader') return;

      // Update peer metadata
      const peer = this.peers.get(peerUrl);
      if (peer) {
        peer.lastSeen = Date.now();
        if (reply.state) peer.state = reply.state;
        peer.term = reply.term;
      }

      if (reply.success) {
        if (entries.length > 0) {
          const lastSent = entries[entries.length - 1].index;
          this.matchIndex.set(peerUrl, lastSent);
          this.nextIndex.set(peerUrl, lastSent + 1);
          this.advanceCommitIndex();
        }
      } else {
        // Log inconsistency — decrement and retry next heartbeat
        const cur = this.nextIndex.get(peerUrl) ?? 1;
        this.nextIndex.set(peerUrl, Math.max(0, cur - 1));
      }
    } catch {
      // peer unreachable — will retry next heartbeat
    }
  }

  private advanceCommitIndex() {
    const total = this.peers.size + 1;
    const majority = Math.floor(total / 2) + 1;

    // Scan log in reverse to find the highest N that is replicated on majority
    for (let i = this.log.length - 1; i >= 0; i--) {
      const entry = this.log[i];
      if (entry.index <= this.commitIndex) break;
      if (entry.term !== this.currentTerm) continue;

      let count = 1; // self
      for (const m of this.matchIndex.values()) {
        if (m >= entry.index) count++;
      }

      if (count >= majority) {
        this.commitIndex = entry.index;
        this.applyEntries();
        break;
      }
    }
  }

  private applyEntries() {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
    }
  }

  // ─── RPC handlers (called by API routes) ─────────────────────────

  handleRequestVote(args: {
    term: number;
    candidateId: string;
    candidateUrl: string;
    lastLogIndex: number;
    lastLogTerm: number;
  }): { term: number; voteGranted: boolean } {
    this.logMessage({ from: args.candidateUrl, to: this.selfUrl, type: 'vote_request' });

    if (args.term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false };
    }

    if (args.term > this.currentTerm) {
      this.becomeFollower(args.term);
    }

    const lastLog = this.log[this.log.length - 1];
    const myLastIdx = lastLog ? lastLog.index : -1;
    const myLastTerm = lastLog ? lastLog.term : 0;

    const candidateIsUpToDate =
      args.lastLogTerm > myLastTerm ||
      (args.lastLogTerm === myLastTerm && args.lastLogIndex >= myLastIdx);

    const canGrant =
      (this.votedFor === null || this.votedFor === args.candidateId) &&
      candidateIsUpToDate;

    if (canGrant) {
      this.votedFor = args.candidateId;
      this.resetElectionTimer();
      return { term: this.currentTerm, voteGranted: true };
    }

    return { term: this.currentTerm, voteGranted: false };
  }

  handleAppendEntries(args: {
    term: number;
    leaderId: string;
    leaderUrl: string;
    prevLogIndex: number;
    prevLogTerm: number;
    entries: LogEntry[];
    leaderCommit: number;
  }): { term: number; success: boolean; state: NodeState } {
    this.logMessage({ from: args.leaderUrl, to: this.selfUrl, type: 'append_entries' });

    if (args.term < this.currentTerm) {
      return { term: this.currentTerm, success: false, state: this.state };
    }

    this.resetElectionTimer();
    this.becomeFollower(args.term, args.leaderUrl);

    // Track the leader as a peer if it's already in our list
    const leaderPeer = this.peers.get(args.leaderUrl);
    if (leaderPeer) {
      leaderPeer.lastSeen = Date.now();
      leaderPeer.state = 'leader';
      leaderPeer.term = args.term;
    }

    // Consistency check
    if (args.prevLogIndex >= 0) {
      const prev = this.log.find((e) => e.index === args.prevLogIndex);
      if (!prev || prev.term !== args.prevLogTerm) {
        return { term: this.currentTerm, success: false, state: this.state };
      }
    }

    // Merge incoming entries (resolve conflicts)
    for (const entry of args.entries) {
      const idx = this.log.findIndex((e) => e.index === entry.index);
      if (idx >= 0) {
        if (this.log[idx].term !== entry.term) {
          this.log = this.log.slice(0, idx);
          this.log.push(entry);
        }
        // else already have this entry — skip
      } else {
        this.log.push(entry);
      }
    }

    this.log.sort((a, b) => a.index - b.index);

    if (args.leaderCommit > this.commitIndex) {
      const lastNewIdx =
        args.entries.length > 0
          ? args.entries[args.entries.length - 1].index
          : this.log.length > 0
          ? this.log[this.log.length - 1].index
          : -1;
      this.commitIndex = Math.min(args.leaderCommit, lastNewIdx);
      this.applyEntries();
    }

    return { term: this.currentTerm, success: true, state: this.state };
  }

  // ─── Client-facing API ────────────────────────────────────────────

  async submitEntry(command: string, data?: unknown): Promise<boolean> {
    if (this.state !== 'leader') return false;

    const newIndex =
      this.log.length > 0 ? this.log[this.log.length - 1].index + 1 : 0;

    this.log.push({
      index: newIndex,
      term: this.currentTerm,
      command,
      data,
      timestamp: Date.now(),
    });

    if (this.peers.size === 0) {
      // Single-node: commit immediately
      this.commitIndex = newIndex;
      this.applyEntries();
    } else {
      // Push to all peers without waiting for the heartbeat tick
      this.replicateToAll();
    }

    return true;
  }

  addPeer(url: string) {
    if (url === this.selfUrl || this.peers.has(url)) return;
    this.peers.set(url, { url, lastSeen: null, state: null, term: null });

    if (this.state === 'leader') {
      const lastIdx =
        this.log.length > 0 ? this.log[this.log.length - 1].index : -1;
      this.nextIndex.set(url, lastIdx + 1);
      this.matchIndex.set(url, -1);
    }
  }

  removePeer(url: string) {
    this.peers.delete(url);
    this.nextIndex.delete(url);
    this.matchIndex.delete(url);
  }

  getState() {
    const now = Date.now();
    return {
      id: this.id,
      selfUrl: this.selfUrl,
      state: this.state,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      leaderUrl: this.leaderUrl,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      log: this.log,
      peers: [...this.peers.values()].map((p) => ({
        ...p,
        isOnline: p.lastSeen !== null && now - p.lastSeen < 3000,
      })),
      networkDelay: this.networkDelay,
      messages: this.messages.filter((m) => now - m.timestamp < 8000),
    };
  }

  destroy() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }
}

// ─── Singleton ────────────────────────────────────────────────────

const g = globalThis as typeof globalThis & { __raftNode?: RaftNode };

export function getRaftNode(): RaftNode {
  const port = process.env.PORT ?? '3000';
  const selfUrl = `http://localhost:${port}`;

  if (!g.__raftNode) {
    g.__raftNode = new RaftNode(selfUrl);
  }

  return g.__raftNode;
}
