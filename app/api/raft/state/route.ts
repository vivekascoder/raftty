import { NextResponse } from 'next/server';
import { getRaftNode } from '@/lib/raft';

export async function GET() {
  const node = getRaftNode();
  return NextResponse.json(node.getState());
}
