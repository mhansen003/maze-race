import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

const AGENTS = ['blaze', 'frost', 'venom', 'sol'];

export async function GET() {
  try {
    const pipeline = kv.pipeline();
    for (const name of AGENTS) {
      pipeline.get(`wins:${name}`);
    }
    const results = await pipeline.exec();
    const wins: Record<string, number> = {};
    AGENTS.forEach((name, i) => {
      wins[name] = (results[i] as number) || 0;
    });
    return NextResponse.json(wins);
  } catch {
    // KV not configured — return zeros
    const wins: Record<string, number> = {};
    for (const name of AGENTS) wins[name] = 0;
    return NextResponse.json(wins);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { winner } = await req.json();
    const name = (winner as string).toLowerCase();
    if (!AGENTS.includes(name)) {
      return NextResponse.json({ error: 'Invalid agent' }, { status: 400 });
    }
    const newCount = await kv.incr(`wins:${name}`);
    return NextResponse.json({ [name]: newCount });
  } catch {
    return NextResponse.json({ error: 'KV not configured' }, { status: 500 });
  }
}
