import { NextRequest, NextResponse } from 'next/server';
import { MoveRequest, Direction } from '@/lib/types';

export async function POST(req: NextRequest) {
  const body: MoveRequest = await req.json();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { direction: body.availableMoves[0] },
      { status: 200 }
    );
  }

  const prompt = `You are "${body.agentName}", an AI agent navigating a maze race. ${body.personality}

Here is the maze (# = wall, space = passage, A = you, G = goal):
${body.mazeAscii}

Your position: row ${body.position.row}, col ${body.position.col}
Goal position: row ${body.goal.row}, col ${body.goal.col}
Available moves: ${body.availableMoves.join(', ')}
Recent moves: ${body.recentMoves.length > 0 ? body.recentMoves.join(', ') : 'none yet'}

Pick the best move toward the goal. Avoid going back the way you just came unless it's the only option. Respond with ONLY one word: up, down, left, or right.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
        temperature: 0.2,
      }),
    });

    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content || '').trim().toLowerCase();

    // Parse the direction from the response
    const validDirs: Direction[] = ['up', 'down', 'left', 'right'];
    let direction: Direction | null = null;

    for (const d of validDirs) {
      if (content.includes(d) && body.availableMoves.includes(d)) {
        direction = d;
        break;
      }
    }

    // Fallback: pick first available move
    if (!direction) {
      direction = body.availableMoves[0];
    }

    return NextResponse.json({ direction });
  } catch {
    const fallback =
      body.availableMoves[Math.floor(Math.random() * body.availableMoves.length)];
    return NextResponse.json({ direction: fallback });
  }
}
