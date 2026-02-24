import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

const AGENTS = ['blaze', 'frost', 'venom', 'sol'];

const SEED_COUNTS: Record<string, number> = {
  blaze: 42,
  frost: 37,
  venom: 45,
  sol: 33,
};

export async function GET() {
  try {
    const pipeline = kv.pipeline();
    for (const name of AGENTS) {
      pipeline.get(`wins:${name}`);
    }
    const results = await pipeline.exec();
    const wins: Record<string, number> = {};
    let allZero = true;
    AGENTS.forEach((name, i) => {
      wins[name] = (results[i] as number) || 0;
      if (wins[name] > 0) allZero = false;
    });

    // Auto-seed if no wins exist yet
    if (allZero) {
      const seedPipeline = kv.pipeline();
      for (const name of AGENTS) {
        seedPipeline.set(`wins:${name}`, SEED_COUNTS[name]);
        wins[name] = SEED_COUNTS[name];
      }
      await seedPipeline.exec();
    }

    return NextResponse.json(wins);
  } catch {
    // KV not configured — return seed counts as fallback
    return NextResponse.json({ ...SEED_COUNTS });
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
