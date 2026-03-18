'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────

type NodeState = 'follower' | 'candidate' | 'leader';

interface LogEntry {
  index: number;
  term: number;
  command: string;
  data?: unknown;
  timestamp: number;
}

interface PeerInfo {
  url: string;
  lastSeen: number | null;
  state: NodeState | null;
  term: number | null;
  isOnline: boolean;
}

interface RaftState {
  id: string;
  selfUrl: string;
  state: NodeState;
  currentTerm: number;
  votedFor: string | null;
  leaderUrl: string | null;
  commitIndex: number;
  lastApplied: number;
  log: LogEntry[];
  peers: PeerInfo[];
}

// ─── Color palette per state ──────────────────────────────────────

const STATE = {
  leader: {
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    text: 'text-emerald-400',
  },
  candidate: {
    dot: 'bg-amber-400 animate-pulse',
    badge: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    text: 'text-amber-400',
  },
  follower: {
    dot: 'bg-sky-400',
    badge: 'bg-sky-500/10 border-sky-500/30 text-sky-400',
    text: 'text-sky-400',
  },
} satisfies Record<NodeState, { dot: string; badge: string; text: string }>;

// ─── Main dashboard ───────────────────────────────────────────────

export default function RaftDashboard() {
  const [raft, setRaft] = useState<RaftState | null>(null);
  const [peerInput, setPeerInput] = useState('');
  const [command, setCommand] = useState('set');
  const [payload, setPayload] = useState('');
  const [submitMsg, setSubmitMsg] = useState('');
  const [peerMsg, setPeerMsg] = useState('');
  const [electionMsg, setElectionMsg] = useState('');

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/raft/state');
      setRaft(await res.json());
    } catch {
      // server not ready yet
    }
  }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 500);
    return () => clearInterval(id);
  }, [fetchState]);

  const addPeer = async () => {
    const url = peerInput.trim();
    if (!url) return;
    const res = await fetch('/api/raft/peers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    setPeerMsg(data.success ? 'Added' : (data.error ?? 'Failed'));
    if (data.success) setPeerInput('');
    setTimeout(() => setPeerMsg(''), 3000);
  };

  const triggerElection = async () => {
    const res = await fetch('/api/raft/election', { method: 'POST' });
    const data = await res.json();
    setElectionMsg(data.success ? 'Election started' : 'Failed');
    setTimeout(() => setElectionMsg(''), 3000);
  };

  const removePeer = (url: string) =>
    fetch('/api/raft/peers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

  const nominatePeer = async (peerUrl: string) => {
    await fetch('/api/raft/nominate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerUrl }),
    });
  };

  const submitEntry = async () => {
    if (!payload.trim()) return;
    const res = await fetch('/api/raft/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, data: payload }),
    });
    const data = await res.json();
    if (data.success) {
      setSubmitMsg(
        data.forwarded ? `Forwarded → ${data.leaderUrl}` : 'Committed'
      );
      setPayload('');
    } else {
      setSubmitMsg(data.error ?? 'Failed');
    }
    setTimeout(() => setSubmitMsg(''), 5000);
  };

  if (!raft) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <span className="text-gray-600 font-mono text-sm tracking-widest animate-pulse">
          connecting…
        </span>
      </div>
    );
  }

  const s = STATE[raft.state];
  const committed = raft.log.filter((e) => e.index <= raft.commitIndex);
  const uncommitted = raft.log.filter((e) => e.index > raft.commitIndex);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex flex-col">
      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-800 flex-shrink-0">
        <div className={`h-2 w-2 rounded-full ${s.dot}`} />
        <span className="text-xs font-bold text-gray-400 tracking-widest uppercase">
          Raft Node
        </span>
        <span
          className={`px-2 py-0.5 text-[11px] font-bold rounded border uppercase tracking-wider ${s.badge}`}
        >
          {raft.state}
        </span>
        <span className="text-xs text-gray-600">term {raft.currentTerm}</span>
        <div className="ml-auto flex items-center gap-3">
          {electionMsg && (
            <span className="text-[11px] text-amber-400">{electionMsg}</span>
          )}
          <button
            onClick={triggerElection}
            disabled={raft.state === 'candidate'}
            className="px-3 py-1 text-[11px] rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Start Election
          </button>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-gray-600">
          <span>{raft.selfUrl}</span>
          <span className="text-gray-800">{raft.id.slice(0, 8)}…</span>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden divide-x divide-gray-800">
        {/* ── Left panel ── */}
        <div className="w-96 flex flex-col overflow-hidden flex-shrink-0">
          {/* Stats */}
          <div className="p-5 border-b border-gray-800 grid grid-cols-2 gap-2">
            <StatBox label="State" value={raft.state} valueClass={s.text} />
            <StatBox label="Term" value={String(raft.currentTerm)} />
            <StatBox label="Commit index" value={String(raft.commitIndex)} />
            <StatBox
              label="Log length"
              value={String(raft.log.length)}
            />
            <StatBox
              label="Leader"
              value={
                raft.leaderUrl
                  ? raft.leaderUrl.replace('http://localhost:', ':')
                  : '—'
              }
              valueClass={raft.leaderUrl ? 'text-emerald-400' : 'text-gray-700'}
            />
            <StatBox
              label="Voted for"
              value={raft.votedFor ? raft.votedFor.slice(0, 8) + '…' : '—'}
            />
          </div>

          {/* Peers */}
          <div className="flex flex-col flex-1 overflow-hidden p-5">
            <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-3">
              Peers ({raft.peers.length})
            </p>

            {/* Add peer */}
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={peerInput}
                onChange={(e) => setPeerInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPeer()}
                placeholder="http://localhost:3001"
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 placeholder-gray-700 focus:outline-none focus:border-gray-500"
              />
              <button
                onClick={addPeer}
                className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-300 transition-colors"
              >
                Add
              </button>
            </div>
            {peerMsg && (
              <p className="text-[11px] text-gray-500 mb-2">{peerMsg}</p>
            )}

            {/* Peer list */}
            <div className="flex-1 overflow-auto space-y-1.5 mt-1">
              {raft.peers.length === 0 ? (
                <p className="text-xs text-gray-700">
                  No peers. Add a node URL above to form a cluster.
                </p>
              ) : (
                raft.peers.map((peer) => (
                  <PeerRow
                    key={peer.url}
                    peer={peer}
                    onRemove={() => removePeer(peer.url)}
                    onNominate={() => nominatePeer(peer.url)}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Submit */}
          <div className="p-5 border-b border-gray-800 flex-shrink-0">
            <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-3">
              Submit Entry
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="cmd"
                className="w-20 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-sky-400 placeholder-gray-700 focus:outline-none focus:border-gray-500"
              />
              <input
                type="text"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitEntry()}
                placeholder="payload…"
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 placeholder-gray-700 focus:outline-none focus:border-gray-500"
              />
              <button
                onClick={submitEntry}
                className="px-4 py-1.5 text-xs bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded text-emerald-400 transition-colors"
              >
                Commit
              </button>
            </div>
            {submitMsg && (
              <p className="text-[11px] text-gray-500 mt-2">{submitMsg}</p>
            )}
          </div>

          {/* Log */}
          <div className="flex-1 overflow-auto p-5">
            <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-3">
              Replicated log &mdash; {committed.length} committed /{' '}
              {raft.log.length} total
            </p>

            {raft.log.length === 0 ? (
              <p className="text-xs text-gray-700">
                No log entries yet. Submit data to start replication.
              </p>
            ) : (
              <div className="space-y-1">
                {[...raft.log].reverse().map((entry) => (
                  <LogRow
                    key={`${entry.index}-${entry.term}`}
                    entry={entry}
                    committed={entry.index <= raft.commitIndex}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer legend ── */}
      <footer className="border-t border-gray-800 px-6 py-2 flex gap-6 flex-shrink-0">
        {(['leader', 'candidate', 'follower'] as NodeState[]).map((st) => (
          <div key={st} className="flex items-center gap-1.5">
            <div className={`h-1.5 w-1.5 rounded-full ${STATE[st].dot.replace(' animate-pulse', '')}`} />
            <span className={`text-[11px] ${STATE[st].text}`}>{st}</span>
          </div>
        ))}
        <div className="ml-auto text-[11px] text-gray-700">
          Run on another port: <span className="text-gray-500">PORT=3001 pnpm dev</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function StatBox({
  label,
  value,
  valueClass = 'text-gray-200',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-3">
      <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`text-sm font-semibold truncate ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

function PeerRow({
  peer,
  onRemove,
  onNominate,
}: {
  peer: PeerInfo;
  onRemove: () => void;
  onNominate: () => void;
}) {
  const stateText = peer.state ? STATE[peer.state].text : 'text-gray-600';
  return (
    <div className="group flex items-center gap-3 bg-gray-900 border border-gray-800 rounded p-3">
      <div
        className={`h-2 w-2 rounded-full flex-shrink-0 ${
          peer.isOnline ? 'bg-emerald-500' : 'bg-gray-700'
        }`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-300 truncate">{peer.url}</p>
        <p className="flex gap-2 mt-0.5">
          {peer.state && (
            <span className={`text-[10px] ${stateText}`}>{peer.state}</span>
          )}
          {peer.term !== null && (
            <span className="text-[10px] text-gray-600">t{peer.term}</span>
          )}
          {!peer.isOnline && (
            <span className="text-[10px] text-gray-700">
              {peer.lastSeen ? 'offline' : 'never contacted'}
            </span>
          )}
        </p>
      </div>
      <button
        onClick={onNominate}
        title="Vote for this peer as leader"
        className="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-[10px] rounded border border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-all"
      >
        vote
      </button>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-400 text-xs transition-opacity"
      >
        ✕
      </button>
    </div>
  );
}

function LogRow({
  entry,
  committed,
}: {
  entry: LogEntry;
  committed: boolean;
}) {
  const ts = new Date(entry.timestamp).toLocaleTimeString();
  return (
    <div
      className={`flex items-center gap-3 rounded px-3 py-2 border text-xs ${
        committed
          ? 'bg-gray-900 border-gray-800'
          : 'bg-amber-500/5 border-amber-500/20'
      }`}
    >
      <span className="text-gray-700 w-6 text-right flex-shrink-0">
        #{entry.index}
      </span>
      <span className="text-gray-600 flex-shrink-0">T{entry.term}</span>
      <span className="text-sky-400 flex-shrink-0">{entry.command}</span>
      <span className="text-gray-300 flex-1 truncate">
        {String(entry.data ?? '')}
      </span>
      <span className="text-gray-700 flex-shrink-0">{ts}</span>
      <span
        className={`flex-shrink-0 text-[10px] ${
          committed ? 'text-emerald-600' : 'text-amber-600'
        }`}
      >
        {committed ? '✓' : '…'}
      </span>
    </div>
  );
}
