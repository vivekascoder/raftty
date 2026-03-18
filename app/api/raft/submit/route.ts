import { NextRequest, NextResponse } from 'next/server';
import { getRaftNode } from '@/lib/raft';

export async function POST(req: NextRequest) {
  const { command, data } = await req.json();
  const node = getRaftNode();

  if (node.state === 'leader') {
    const ok = await node.submitEntry(command ?? 'set', data);
    return NextResponse.json({ success: ok });
  }

  // Forward to leader if known
  if (node.leaderUrl) {
    try {
      const res = await fetch(`${node.leaderUrl}/api/raft/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, data }),
        signal: AbortSignal.timeout(3000),
      });
      const result = await res.json();
      return NextResponse.json({
        ...result,
        forwarded: true,
        leaderUrl: node.leaderUrl,
      });
    } catch {
      return NextResponse.json(
        { success: false, error: 'Leader unreachable' },
        { status: 503 }
      );
    }
  }

  return NextResponse.json(
    { success: false, error: 'No leader elected yet — try again shortly' },
    { status: 503 }
  );
}
