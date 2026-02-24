import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const AGENTS = ['blaze', 'frost', 'venom', 'sol'];

const SEED_COUNTS: Record<string, number> = {
  blaze: 42,
  frost: 37,
  venom: 45,
  sol: 33,
};

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ ...SEED_COUNTS });
  }

  try {
    const pipeline = redis.pipeline();
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
      const seedPipeline = redis.pipeline();
      for (const name of AGENTS) {
        seedPipeline.set(`wins:${name}`, SEED_COUNTS[name]);
        wins[name] = SEED_COUNTS[name];
      }
      await seedPipeline.exec();
    }

    return NextResponse.json(wins);
  } catch {
    return NextResponse.json({ ...SEED_COUNTS });
  }
}

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Redis not configured' }, { status: 500 });
  }

  try {
    const { winner } = await req.json();
    const name = (winner as string).toLowerCase();
    if (!AGENTS.includes(name)) {
      return NextResponse.json({ error: 'Invalid agent' }, { status: 400 });
    }
    const newCount = await redis.incr(`wins:${name}`);
    return NextResponse.json({ [name]: newCount });
  } catch {
    return NextResponse.json({ error: 'Redis error' }, { status: 500 });
  }
}
