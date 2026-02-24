import { NextRequest, NextResponse } from 'next/server';
import { MoveRequest, MoveOption, Direction } from '@/lib/types';

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

const ARROWS: Record<Direction, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

function buildPrompt(body: MoveRequest): string {
  const { position: pos, goal } = body;

  // General direction hint
  const dr = goal.row - pos.row;
  const dc = goal.col - pos.col;
  let goalDir = '';
  if (dr > 0 && dc > 0) goalDir = 'below-right';
  else if (dr > 0 && dc < 0) goalDir = 'below-left';
  else if (dr < 0 && dc > 0) goalDir = 'above-right';
  else if (dr < 0 && dc < 0) goalDir = 'above-left';
  else if (dr > 0) goalDir = 'directly below';
  else if (dr < 0) goalDir = 'directly above';
  else if (dc > 0) goalDir = 'directly right';
  else if (dc < 0) goalDir = 'directly left';

  // Build options list
  const optionLines = body.moveOptions.map((o) => {
    const arrow = ARROWS[o.direction];
    const label = o.direction.toUpperCase().padEnd(5);
    const dist = `distance ${o.distanceToGoal}`;
    let note = '';
    if (o.timesVisited === 0) note = 'FRESH PATH';
    else note = `visited ${o.timesVisited}x`;
    if (o.isReverse) note += ' — GOING BACK';
    return `  ${arrow} ${label} → (${o.row},${o.col}) — ${dist} — ${note}`;
  });

  // Recent path summary
  const recentStr =
    body.recentMoves.length > 0
      ? body.recentMoves.slice(-8).join(', ')
      : 'none yet';

  return `You are "${body.agentName}" racing through a maze. ${body.personality}

POSITION: (${pos.row}, ${pos.col})
GOAL: (${goal.row}, ${goal.col}) — ${goalDir} — distance ${body.currentDistance}

YOUR OPTIONS:
${optionLines.join('\n')}

Recent moves: ${recentStr}

RULES:
- Pick FRESH paths over visited ones
- Move TOWARD the goal when possible
- Only go back if it is the ONLY option
- Respond with a SINGLE WORD: ${body.moveOptions.map((o) => o.direction).join(', ')}`;
}

/**
 * Anti-oscillation: if the AI tries to reverse and better options exist, override.
 */
function applyGuardrails(
  aiChoice: Direction,
  options: MoveOption[]
): Direction {
  const chosen = options.find((o) => o.direction === aiChoice);

  // Invalid move — pick best available
  if (!chosen) {
    return pickBest(options);
  }

  // If reversing and there are non-reverse alternatives
  if (chosen.isReverse && options.length > 1) {
    const alts = options.filter((o) => !o.isReverse);
    if (alts.length > 0) {
      // Prefer fresh paths, then closest to goal
      const fresh = alts.filter((o) => o.timesVisited === 0);
      if (fresh.length > 0) return pickBest(fresh);
      return pickBest(alts);
    }
  }

  return aiChoice;
}

function pickBest(options: MoveOption[]): Direction {
  // Sort: unvisited first, then lowest visit count, then closest to goal
  const sorted = [...options].sort((a, b) => {
    if (a.timesVisited === 0 && b.timesVisited > 0) return -1;
    if (b.timesVisited === 0 && a.timesVisited > 0) return 1;
    if (a.timesVisited !== b.timesVisited) return a.timesVisited - b.timesVisited;
    return a.distanceToGoal - b.distanceToGoal;
  });
  return sorted[0].direction;
}

export async function POST(req: NextRequest) {
  const body: MoveRequest = await req.json();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ direction: pickBest(body.moveOptions) });
  }

  const prompt = buildPrompt(body);

  try {
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-001',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 10,
          temperature: 0.3,
        }),
      }
    );

    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content || '')
      .trim()
      .toLowerCase();

    // Parse direction
    const validDirs: Direction[] = ['up', 'down', 'left', 'right'];
    let aiChoice: Direction | null = null;
    for (const d of validDirs) {
      if (content.includes(d)) {
        aiChoice = d;
        break;
      }
    }

    // Validate it's actually available
    const available = body.moveOptions.map((o) => o.direction);
    if (!aiChoice || !available.includes(aiChoice)) {
      return NextResponse.json({ direction: pickBest(body.moveOptions) });
    }

    // Apply anti-oscillation guardrails
    const finalDir = applyGuardrails(aiChoice, body.moveOptions);
    return NextResponse.json({ direction: finalDir });
  } catch {
    return NextResponse.json({ direction: pickBest(body.moveOptions) });
  }
}
