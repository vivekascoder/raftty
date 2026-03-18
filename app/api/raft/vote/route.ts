import { NextRequest, NextResponse } from 'next/server';
import { getRaftNode } from '@/lib/raft';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const node = getRaftNode();
  const result = node.handleRequestVote(body);
  return NextResponse.json(result);
}
