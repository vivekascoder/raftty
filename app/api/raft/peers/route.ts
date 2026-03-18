import { NextRequest, NextResponse } from 'next/server';
import { getRaftNode } from '@/lib/raft';

export async function GET() {
  const node = getRaftNode();
  return NextResponse.json({ peers: node.getState().peers });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const url: string = body?.url;
  if (!url) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }
  getRaftNode().addPeer(url.trim());
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const url: string = body?.url;
  if (!url) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }
  getRaftNode().removePeer(url.trim());
  return NextResponse.json({ success: true });
}
