import { NextResponse } from 'next/server';
import { getRaftNode } from '@/lib/raft';

export async function POST() {
  const node = getRaftNode();
  node.forceElection();
  return NextResponse.json({ success: true });
}
