'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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

interface MessageEvent {
  id: string;
  from: string;
  to: string;
  type: 'vote_request' | 'vote_response' | 'append_entries' | 'append_entries_response';
  timestamp: number;
  success?: boolean;
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
  networkDelay: number;
  messages: MessageEvent[];
}

// ─── Color palette per state ──────────────────────────────────────

const STATE = {
  leader: {
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    text: 'text-emerald-400',
    color: '#10b981',
  },
  candidate: {
    dot: 'bg-amber-400 animate-pulse',
    badge: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    text: 'text-amber-400',
    color: '#f59e0b',
  },
  follower: {
    dot: 'bg-sky-400',
    badge: 'bg-sky-500/10 border-sky-500/30 text-sky-400',
    text: 'text-sky-400',
    color: '#38bdf8',
  },
} satisfies Record<NodeState, { dot: string; badge: string; text: string; color: string }>;

// ─── Main dashboard ───────────────────────────────────────────────

export default function RaftDashboard() {
  const [raft, setRaft] = useState<RaftState | null>(null);
  const [peerInput, setPeerInput] = useState('');
  const [command, setCommand] = useState('set');
  const [payload, setPayload] = useState('');
  const [submitMsg, setSubmitMsg] = useState('');
  const [peerMsg, setPeerMsg] = useState('');
  const [electionMsg, setElectionMsg] = useState('');
  const [activeTab, setActiveTab] = useState<'log' | 'graph'>('log');
  const [localDelay, setLocalDelay] = useState(0);
  const delayDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/raft/state');
      const data = await res.json();
      setRaft(data);
      // Sync slider only if user isn't actively dragging
      setLocalDelay((prev) => (Math.abs(prev - data.networkDelay) > 50 ? data.networkDelay : prev));
    } catch {
      // server not ready yet
    }
  }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 500);
    return () => clearInterval(id);
  }, [fetchState]);

  const handleDelayChange = (ms: number) => {
    setLocalDelay(ms);
    if (delayDebounce.current) clearTimeout(delayDebounce.current);
    delayDebounce.current = setTimeout(() => {
      fetch('/api/raft/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ networkDelay: ms }),
      });
    }, 150);
  };

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
            <StatBox label="Log length" value={String(raft.log.length)} />
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

          {/* Network delay slider */}
          <div className="px-5 py-4 border-b border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] text-gray-500 uppercase tracking-widest">
                Network Delay
              </p>
              <span className="text-[11px] text-gray-300 tabular-nums">
                {localDelay}ms
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={3000}
              step={50}
              value={localDelay}
              onChange={(e) => handleDelayChange(Number(e.target.value))}
              className="w-full accent-sky-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-gray-700 mt-1">
              <span>0ms</span>
              <span>1500ms</span>
              <span>3000ms</span>
            </div>
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

          {/* Tab bar */}
          <div className="flex border-b border-gray-800 flex-shrink-0">
            {(['log', 'graph'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2.5 text-[11px] uppercase tracking-widest transition-colors ${
                  activeTab === tab
                    ? 'text-gray-200 border-b border-gray-400'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'log' ? (
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
          ) : (
            <div className="flex-1 overflow-hidden">
              <GraphView raft={raft} />
            </div>
          )}
        </div>
      </div>

      {/* ── Footer legend ── */}
      <footer className="border-t border-gray-800 px-6 py-2 flex gap-6 flex-shrink-0">
        {(['leader', 'candidate', 'follower'] as NodeState[]).map((st) => (
          <div key={st} className="flex items-center gap-1.5">
            <div
              className={`h-1.5 w-1.5 rounded-full ${STATE[st].dot.replace(' animate-pulse', '')}`}
            />
            <span className={`text-[11px] ${STATE[st].text}`}>{st}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 text-[11px] text-gray-700 ml-6">
          <span className="w-2 h-2 rounded-full bg-emerald-500/60 inline-block" />
          append_entries
          <span className="w-2 h-2 rounded-full bg-amber-500/60 inline-block ml-2" />
          vote
        </div>
        <div className="ml-auto text-[11px] text-gray-700">
          Run on another port:{' '}
          <span className="text-gray-500">PORT=3001 pnpm dev</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Graph view ───────────────────────────────────────────────────

function GraphView({ raft }: { raft: RaftState }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 40);
    return () => clearInterval(id);
  }, []);

  const W = 800;
  const H = 480;
  const cx = W / 2;
  const cy = H / 2;
  const NODE_R = 30;

  const nodes = [
    { url: raft.selfUrl, state: raft.state, isSelf: true },
    ...raft.peers.map((p) => ({
      url: p.url,
      state: (p.state ?? 'follower') as NodeState,
      isSelf: false,
      isOnline: p.isOnline,
    })),
  ];

  const R = nodes.length === 1 ? 0 : Math.min(W, H) * 0.32;

  const nodePos = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    nodePos.set(node.url, {
      x: cx + R * Math.cos(angle),
      y: cy + R * Math.sin(angle),
    });
  });

  // Travel duration = max(400, delay * 1.5) so messages are visible even with 0 delay
  const travelMs = Math.max(400, raft.networkDelay * 1.5);
  const activeMessages = raft.messages.filter(
    (m) => now - m.timestamp < travelMs + 200
  );

  const isVote = (type: MessageEvent['type']) =>
    type === 'vote_request' || type === 'vote_response';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      style={{ background: 'transparent' }}
    >
      {/* Grid dots */}
      {Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 14 }, (_, col) => (
          <circle
            key={`${row}-${col}`}
            cx={(col + 0.5) * (W / 14)}
            cy={(row + 0.5) * (H / 8)}
            r={1}
            fill="#1f2937"
          />
        ))
      )}

      {/* Edges between all node pairs */}
      {nodes.flatMap((a, i) =>
        nodes.slice(i + 1).map((b) => {
          const pa = nodePos.get(a.url)!;
          const pb = nodePos.get(b.url)!;
          return (
            <line
              key={`edge-${a.url}-${b.url}`}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke="#1f2937"
              strokeWidth={1.5}
            />
          );
        })
      )}

      {/* In-flight messages */}
      {activeMessages.map((msg) => {
        const from = nodePos.get(msg.from);
        const to = nodePos.get(msg.to);
        if (!from || !to) return null;

        const age = now - msg.timestamp;
        const t = Math.min(1, age / travelMs);
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out
        const x = from.x + (to.x - from.x) * eased;
        const y = from.y + (to.y - from.y) * eased;
        const opacity = t > 0.85 ? (1 - t) / 0.15 : 1;
        const color = isVote(msg.type) ? '#f59e0b' : '#10b981';
        const isFailed = msg.success === false;

        return (
          <g key={msg.id}>
            {/* Glow */}
            <circle
              cx={x}
              cy={y}
              r={8}
              fill={color}
              opacity={opacity * 0.15}
            />
            {/* Dot */}
            <circle
              cx={x}
              cy={y}
              r={isFailed ? 3.5 : 4.5}
              fill={isFailed ? '#6b7280' : color}
              opacity={opacity}
            />
            {/* Label */}
            {t > 0.1 && t < 0.75 && (
              <text
                x={x}
                y={y - 10}
                textAnchor="middle"
                fill={color}
                fontSize={8}
                fontFamily="monospace"
                opacity={opacity * 0.8}
              >
                {msg.type === 'append_entries'
                  ? 'AE'
                  : msg.type === 'append_entries_response'
                  ? 'AE↩'
                  : msg.type === 'vote_request'
                  ? 'VR'
                  : 'VR↩'}
              </text>
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => {
        const pos = nodePos.get(node.url)!;
        const color = STATE[node.state].color;
        const label = node.url.replace('http://localhost:', ':');
        const isOffline = !node.isSelf && (node as { isOnline?: boolean }).isOnline === false;

        return (
          <g key={node.url}>
            {/* Outer glow for self */}
            {node.isSelf && (
              <circle
                cx={pos.x}
                cy={pos.y}
                r={NODE_R + 10}
                fill={color}
                opacity={0.05}
              />
            )}
            {/* Node ring */}
            <circle
              cx={pos.x}
              cy={pos.y}
              r={NODE_R}
              fill={isOffline ? '#111827' : `${color}18`}
              stroke={isOffline ? '#374151' : color}
              strokeWidth={node.isSelf ? 2 : 1.5}
              strokeDasharray={isOffline ? '4 3' : undefined}
            />
            {/* State label */}
            <text
              x={pos.x}
              y={pos.y - 5}
              textAnchor="middle"
              fill={isOffline ? '#4b5563' : color}
              fontSize={9}
              fontWeight="bold"
              fontFamily="monospace"
            >
              {node.state.toUpperCase()}
            </text>
            {/* URL label */}
            <text
              x={pos.x}
              y={pos.y + 8}
              textAnchor="middle"
              fill={isOffline ? '#374151' : '#9ca3af'}
              fontSize={9}
              fontFamily="monospace"
            >
              {label}
            </text>
            {/* Self indicator */}
            {node.isSelf && (
              <text
                x={pos.x}
                y={pos.y + 19}
                textAnchor="middle"
                fill="#4b5563"
                fontSize={8}
                fontFamily="monospace"
              >
                self
              </text>
            )}
            {/* Offline indicator */}
            {isOffline && (
              <text
                x={pos.x}
                y={pos.y + 19}
                textAnchor="middle"
                fill="#4b5563"
                fontSize={8}
                fontFamily="monospace"
              >
                offline
              </text>
            )}
          </g>
        );
      })}

      {/* Delay watermark */}
      {raft.networkDelay > 0 && (
        <text
          x={W - 12}
          y={H - 12}
          textAnchor="end"
          fill="#374151"
          fontSize={10}
          fontFamily="monospace"
        >
          delay {raft.networkDelay}ms
        </text>
      )}
    </svg>
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
