import { NextRequest, NextResponse } from 'next/server';
import { getRaftNode } from '@/lib/raft';

export async function POST(req: NextRequest) {
  const { peerUrl } = await req.json();
  if (!peerUrl) {
    return NextResponse.json({ error: 'peerUrl required' }, { status: 400 });
  }
  const success = await getRaftNode().nominatePeer(peerUrl);
  return NextResponse.json({ success });
}
