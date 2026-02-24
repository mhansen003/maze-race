import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const AGENTS = ['blaze', 'frost', 'venom', 'sol'];

const SEED_COUNTS: Record<string, number> = {
  blaze: 42,
  frost: 37,
  venom: 45,
  sol: 33,
};

const DEFAULT_LEAST_MOVES = 2000;

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function GET() {
  const redis = getRedis();
  if (!redis) {
    const data: Record<string, number> = { ...SEED_COUNTS };
    for (const name of AGENTS) data[`leastMoves:${name}`] = DEFAULT_LEAST_MOVES;
    return NextResponse.json(data);
  }

  try {
    const pipeline = redis.pipeline();
    for (const name of AGENTS) {
      pipeline.get(`wins:${name}`);
      pipeline.get(`leastMoves:${name}`);
    }
    const results = await pipeline.exec();
    const data: Record<string, number> = {};
    let allZero = true;
    AGENTS.forEach((name, i) => {
      data[name] = (results[i * 2] as number) || 0;
      data[`leastMoves:${name}`] = (results[i * 2 + 1] as number) || DEFAULT_LEAST_MOVES;
      if (data[name] > 0) allZero = false;
    });

    // Auto-seed if no wins exist yet
    if (allZero) {
      const seedPipeline = redis.pipeline();
      for (const name of AGENTS) {
        seedPipeline.set(`wins:${name}`, SEED_COUNTS[name]);
        seedPipeline.set(`leastMoves:${name}`, DEFAULT_LEAST_MOVES);
        data[name] = SEED_COUNTS[name];
        data[`leastMoves:${name}`] = DEFAULT_LEAST_MOVES;
      }
      await seedPipeline.exec();
    }

    return NextResponse.json(data);
  } catch {
    const data: Record<string, number> = { ...SEED_COUNTS };
    for (const name of AGENTS) data[`leastMoves:${name}`] = DEFAULT_LEAST_MOVES;
    return NextResponse.json(data);
  }
}

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Redis not configured' }, { status: 500 });
  }

  try {
    const { winner, moves } = await req.json();
    const name = (winner as string).toLowerCase();
    if (!AGENTS.includes(name)) {
      return NextResponse.json({ error: 'Invalid agent' }, { status: 400 });
    }
    const newCount = await redis.incr(`wins:${name}`);

    // Update least moves if this run is better
    const result: Record<string, number> = { [name]: newCount };
    if (typeof moves === 'number' && moves > 0) {
      const currentBest = (await redis.get(`leastMoves:${name}`)) as number | null;
      const best = currentBest || DEFAULT_LEAST_MOVES;
      if (moves < best) {
        await redis.set(`leastMoves:${name}`, moves);
        result[`leastMoves:${name}`] = moves;
      } else {
        result[`leastMoves:${name}`] = best;
      }
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Redis error' }, { status: 500 });
  }
}
