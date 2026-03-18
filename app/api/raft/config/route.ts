import { getRaftNode } from '@/lib/raft';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { networkDelay } = await req.json();
  const node = getRaftNode();
  node.setNetworkDelay(Number(networkDelay) || 0);
  return NextResponse.json({ ok: true, networkDelay: node.networkDelay });
}
