'use client';

import { useEffect, useRef } from 'react';
import { Cell, Position, Direction, AgentConfig, MoveRequest } from '@/lib/types';
import { generateMaze, mazeToAscii, getAvailableMoves, applyMove } from '@/lib/maze';

// ─── Constants ─────────────────────────────────────────────

const MAZE_SIZE = 15;
const CENTER = Math.floor(MAZE_SIZE / 2); // 7
const TURN_DELAY = 700;
const ANIM_DURATION = 380; // ms for smooth slide between cells

const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 0,
    name: 'Blaze',
    color: '#ff4444',
    glowColor: 'rgba(255,68,68,0.5)',
    personality:
      'You are aggressive and direct. Always move toward the goal. Prefer moves that reduce your Manhattan distance to the goal.',
    startPos: { row: 0, col: 0 },
  },
  {
    id: 1,
    name: 'Frost',
    color: '#4499ff',
    glowColor: 'rgba(68,153,255,0.5)',
    personality:
      'You are methodical. Think step by step about which passage leads toward the goal. Avoid revisiting cells if possible.',
    startPos: { row: 0, col: MAZE_SIZE - 1 },
  },
  {
    id: 2,
    name: 'Venom',
    color: '#44ff66',
    glowColor: 'rgba(68,255,102,0.5)',
    personality:
      'You are analytical. Study the maze structure carefully. If you detect a dead end ahead, turn early. Always choose the path that looks most open toward the goal.',
    startPos: { row: MAZE_SIZE - 1, col: 0 },
  },
  {
    id: 3,
    name: 'Sol',
    color: '#ffcc00',
    glowColor: 'rgba(255,204,0,0.5)',
    personality:
      'You are intuitive. Follow the right-hand rule when unsure but break from it when you spot a clear path to the goal. Prioritize progress over exploration.',
    startPos: { row: MAZE_SIZE - 1, col: MAZE_SIZE - 1 },
  },
];

// ─── Animation helpers ─────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ─── Extended agent with animation state ───────────────────

interface AnimAgent {
  id: number;
  name: string;
  color: string;
  glowColor: string;
  personality: string;
  position: Position;
  prevPosition: Position;
  history: Direction[];
  trail: Position[];
  finished: boolean;
  finishOrder: number | null;
}

function createAgents(): AnimAgent[] {
  return AGENT_CONFIGS.map((cfg) => ({
    ...cfg,
    position: { ...cfg.startPos },
    prevPosition: { ...cfg.startPos },
    history: [],
    trail: [{ ...cfg.startPos }],
    finished: false,
    finishOrder: null,
  }));
}

type GameState = 'ready' | 'racing' | 'finished';

// ─── Component ─────────────────────────────────────────────

export default function MazeRacePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // All game state in refs — the animation loop reads these every frame
  const mazeRef = useRef<Cell[][]>(generateMaze(MAZE_SIZE, MAZE_SIZE));
  const agentsRef = useRef<AnimAgent[]>(createAgents());
  const stateRef = useRef<GameState>('ready');
  const turnRef = useRef(0);
  const winnerRef = useRef<AnimAgent | null>(null);
  const processingRef = useRef(false);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const moveTimeRef = useRef(0); // timestamp of the last move batch

  // ─── Game logic ──────────────────────────────────────────

  async function processTurn() {
    if (processingRef.current || stateRef.current !== 'racing') return;
    processingRef.current = true;

    const maze = mazeRef.current;
    const agents = agentsRef.current;
    const goal: Position = { row: CENTER, col: CENTER };

    const active = agents.filter((a) => !a.finished);
    if (active.length === 0) {
      processingRef.current = false;
      return;
    }

    // Query all agents in parallel
    const results = await Promise.all(
      active.map(async (agent) => {
        const available = getAvailableMoves(maze, agent.position);
        const ascii = mazeToAscii(maze, agent.position, goal);

        const body: MoveRequest = {
          agentName: agent.name,
          personality: agent.personality,
          position: agent.position,
          goal,
          mazeAscii: ascii,
          availableMoves: available,
          recentMoves: agent.history.slice(-10),
        };

        try {
          const res = await fetch('/api/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          return { agentId: agent.id, direction: data.direction as Direction };
        } catch {
          return {
            agentId: agent.id,
            direction: available[Math.floor(Math.random() * available.length)],
          };
        }
      })
    );

    // Snapshot previous positions, then apply moves
    let finishCount = agents.filter((a) => a.finished).length;

    for (const move of results) {
      const agent = agents.find((a) => a.id === move.agentId);
      if (!agent || agent.finished) continue;

      const available = getAvailableMoves(maze, agent.position);
      if (available.includes(move.direction)) {
        // Save previous position for animation interpolation
        agent.prevPosition = { ...agent.position };
        agent.position = applyMove(agent.position, move.direction);
        agent.history.push(move.direction);
        agent.trail.push({ ...agent.position });

        if (agent.position.row === CENTER && agent.position.col === CENTER) {
          finishCount++;
          agent.finished = true;
          agent.finishOrder = finishCount;
          if (finishCount === 1) {
            winnerRef.current = agent;
            stateRef.current = 'finished';
            if (loopRef.current) {
              clearInterval(loopRef.current);
              loopRef.current = null;
            }
          }
        }
      } else {
        // Invalid move — agent stays put, but still set prevPosition so no jump
        agent.prevPosition = { ...agent.position };
      }
    }

    // Mark the time so the draw loop can interpolate
    moveTimeRef.current = performance.now();
    turnRef.current++;
    processingRef.current = false;
  }

  function startRace() {
    stateRef.current = 'racing';
    moveTimeRef.current = performance.now();
    loopRef.current = setInterval(processTurn, TURN_DELAY);
  }

  function newGame() {
    if (loopRef.current) clearInterval(loopRef.current);
    mazeRef.current = generateMaze(MAZE_SIZE, MAZE_SIZE);
    agentsRef.current = createAgents();
    turnRef.current = 0;
    winnerRef.current = null;
    processingRef.current = false;
    moveTimeRef.current = 0;
    stateRef.current = 'ready';
  }

  function handleClick() {
    if (stateRef.current === 'ready') startRace();
    else if (stateRef.current === 'finished') newGame();
  }

  // ─── Rendering ───────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let dpr = 1;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      canvas!.width = Math.floor(window.innerWidth * dpr);
      canvas!.height = Math.floor(window.innerHeight * dpr);
      canvas!.style.width = window.innerWidth + 'px';
      canvas!.style.height = window.innerHeight + 'px';
    }
    resize();
    window.addEventListener('resize', resize);

    let running = true;

    function draw() {
      if (!running) return;

      // Reset transform to identity then scale for DPI
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = window.innerWidth;
      const h = window.innerHeight;
      const maze = mazeRef.current;
      const agents = agentsRef.current;
      const state = stateRef.current;
      const turn = turnRef.current;
      const winner = winnerRef.current;
      const now = performance.now();

      // Animation progress: 0 → 1 over ANIM_DURATION ms after each move
      const rawT = moveTimeRef.current > 0
        ? (now - moveTimeRef.current) / ANIM_DURATION
        : 1;
      const animT = easeOutCubic(Math.min(Math.max(rawT, 0), 1));

      // ── Background ──
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);

      // ── Maze dimensions ──
      const padding = 80;
      const availW = w - padding * 2;
      const availH = h - 130 - padding;
      const cellSize = Math.floor(Math.min(availW / MAZE_SIZE, availH / MAZE_SIZE));
      const mazeW = cellSize * MAZE_SIZE;
      const mazeH = cellSize * MAZE_SIZE;
      const ox = Math.floor((w - mazeW) / 2);
      const oy = Math.floor((h - mazeH) / 2) + 15;

      // ── Maze background ──
      ctx.fillStyle = '#111118';
      ctx.fillRect(ox, oy, mazeW, mazeH);

      // ── Draw walls (batched into one path per style for perf) ──
      ctx.strokeStyle = '#2d2d44';
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (let r = 0; r < MAZE_SIZE; r++) {
        for (let c = 0; c < MAZE_SIZE; c++) {
          const x = ox + c * cellSize;
          const y = oy + r * cellSize;
          const cell = maze[r][c];
          if (cell.walls.top) {
            ctx.moveTo(x, y);
            ctx.lineTo(x + cellSize, y);
          }
          if (cell.walls.right) {
            ctx.moveTo(x + cellSize, y);
            ctx.lineTo(x + cellSize, y + cellSize);
          }
          if (cell.walls.bottom) {
            ctx.moveTo(x, y + cellSize);
            ctx.lineTo(x + cellSize, y + cellSize);
          }
          if (cell.walls.left) {
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + cellSize);
          }
        }
      }
      ctx.stroke();

      // ── Outer border ──
      ctx.strokeStyle = '#3a3a55';
      ctx.lineWidth = 3;
      ctx.strokeRect(ox, oy, mazeW, mazeH);

      // ── Center goal ──
      const gx = ox + CENTER * cellSize + cellSize / 2;
      const gy = oy + CENTER * cellSize + cellSize / 2;
      const pulse = Math.sin(now / 300) * 0.3 + 0.7;

      const goalGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, cellSize * 0.7);
      goalGrad.addColorStop(0, `rgba(255,255,255,${(pulse * 0.25).toFixed(2)})`);
      goalGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(gx, gy, cellSize * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = goalGrad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(gx, gy, cellSize * 0.2 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${pulse.toFixed(2)})`;
      ctx.fill();

      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(Math.PI / 4);
      const ds = cellSize * 0.18;
      ctx.strokeStyle = `rgba(255,255,255,${(pulse * 0.6).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-ds, -ds, ds * 2, ds * 2);
      ctx.restore();

      // ── Agent trails + animated dots ──
      for (const agent of agents) {
        // Compute interpolated visual position
        const visCol = lerp(agent.prevPosition.col, agent.position.col, animT);
        const visRow = lerp(agent.prevPosition.row, agent.position.row, animT);
        const ax = ox + visCol * cellSize + cellSize / 2;
        const ay = oy + visRow * cellSize + cellSize / 2;

        // Trail (draw settled trail segments, not the animated one)
        if (agent.trail.length >= 2) {
          ctx.beginPath();
          ctx.strokeStyle = agent.color + '25';
          ctx.lineWidth = cellSize * 0.15;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          for (let i = 0; i < agent.trail.length; i++) {
            const tx = ox + agent.trail[i].col * cellSize + cellSize / 2;
            const ty = oy + agent.trail[i].row * cellSize + cellSize / 2;
            if (i === 0) ctx.moveTo(tx, ty);
            else ctx.lineTo(tx, ty);
          }
          // Extend trail to current animated position
          ctx.lineTo(ax, ay);
          ctx.stroke();
        }

        // Glow
        const glow = ctx.createRadialGradient(ax, ay, 0, ax, ay, cellSize * 0.55);
        glow.addColorStop(0, agent.glowColor);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.arc(ax, ay, cellSize * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Dot
        ctx.beginPath();
        ctx.arc(ax, ay, cellSize * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = agent.color;
        ctx.fill();

        // Thinking ring while waiting for API
        if (state === 'racing' && !agent.finished && processingRef.current) {
          const spin = (now / 600 + agent.id * 1.5) % (Math.PI * 2);
          ctx.beginPath();
          ctx.arc(ax, ay, cellSize * 0.38, spin, spin + Math.PI * 1.2);
          ctx.strokeStyle = agent.color + '88';
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }

      // ── HUD: Title ──
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('M A Z E   R A C E', w / 2, 10);

      ctx.font = '13px "Courier New", monospace';
      ctx.fillStyle = '#555';
      ctx.fillText('Gemini Flash vs Gemini Flash vs Gemini Flash vs Gemini Flash', w / 2, 36);

      // ── HUD: Turn counter ──
      if (state === 'racing' || state === 'finished') {
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`Turn ${turn}`, w - 20, 12);
      }

      // ── HUD: Agent status bar ──
      ctx.textBaseline = 'middle';
      const barY = h - 28;
      const segW = w / 4;
      for (let i = 0; i < agents.length; i++) {
        const sx = segW * i + segW / 2;
        const a = agents[i];

        ctx.beginPath();
        ctx.arc(sx - 50, barY, 5, 0, Math.PI * 2);
        ctx.fillStyle = a.color;
        ctx.fill();

        ctx.fillStyle = a.color;
        ctx.font = 'bold 13px "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(a.name, sx - 40, barY);

        ctx.font = '12px "Courier New", monospace';
        if (a.finished) {
          ctx.fillStyle = a.finishOrder === 1 ? a.color : '#555';
          ctx.fillText(a.finishOrder === 1 ? 'WINNER' : `#${a.finishOrder}`, sx + 22, barY);
        } else {
          ctx.fillStyle = '#666';
          ctx.fillText(`${a.history.length} moves`, sx + 22, barY);
        }
      }

      // ── Overlays ──
      ctx.textBaseline = 'alphabetic';

      if (state === 'ready') {
        ctx.fillStyle = 'rgba(10,10,15,0.65)';
        ctx.fillRect(0, 0, w, h);

        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 42px "Courier New", monospace';
        ctx.fillText('MAZE RACE', w / 2, h / 2 - 50);

        ctx.fillStyle = '#888';
        ctx.font = '16px "Courier New", monospace';
        ctx.fillText('4 AI agents powered by Gemini Flash', w / 2, h / 2 - 10);
        ctx.fillText('race through a maze to reach the center', w / 2, h / 2 + 14);

        const btnPulse = Math.sin(now / 500) * 0.15 + 0.85;
        ctx.fillStyle = `rgba(68,153,255,${btnPulse.toFixed(2)})`;
        ctx.font = 'bold 20px "Courier New", monospace';
        ctx.fillText('[ CLICK TO START ]', w / 2, h / 2 + 70);

        for (let i = 0; i < AGENT_CONFIGS.length; i++) {
          const cfg = AGENT_CONFIGS[i];
          const px = w / 2 - 180 + i * 120;
          const py = h / 2 + 120;
          ctx.beginPath();
          ctx.arc(px, py, 8, 0, Math.PI * 2);
          ctx.fillStyle = cfg.color;
          ctx.fill();
          ctx.fillStyle = '#aaa';
          ctx.font = '11px "Courier New", monospace';
          ctx.fillText(cfg.name, px, py + 22);
        }
      }

      if (state === 'finished' && winner) {
        ctx.fillStyle = 'rgba(10,10,15,0.75)';
        ctx.fillRect(0, 0, w, h);

        ctx.textAlign = 'center';
        ctx.fillStyle = winner.color;
        ctx.font = 'bold 48px "Courier New", monospace';
        ctx.fillText(`${winner.name} WINS!`, w / 2, h / 2 - 30);

        ctx.fillStyle = '#aaa';
        ctx.font = '18px "Courier New", monospace';
        ctx.fillText(
          `Reached the center in ${winner.history.length} moves (${turn} turns)`,
          w / 2,
          h / 2 + 10
        );

        const finishedAgents = [...agents]
          .filter((a) => a.finished)
          .sort((a, b) => (a.finishOrder || 99) - (b.finishOrder || 99));
        const unfinished = agents.filter((a) => !a.finished);

        let ry = h / 2 + 55;
        ctx.font = '14px "Courier New", monospace';
        for (const a of finishedAgents) {
          ctx.fillStyle = a.color;
          ctx.fillText(`#${a.finishOrder} ${a.name} — ${a.history.length} moves`, w / 2, ry);
          ry += 22;
        }
        for (const a of unfinished) {
          ctx.fillStyle = '#555';
          ctx.fillText(`-- ${a.name} — DNF (${a.history.length} moves)`, w / 2, ry);
          ry += 22;
        }

        const btnP = Math.sin(now / 500) * 0.15 + 0.85;
        ctx.fillStyle = `rgba(68,153,255,${btnP.toFixed(2)})`;
        ctx.font = 'bold 18px "Courier New", monospace';
        ctx.fillText('[ CLICK FOR NEW RACE ]', w / 2, ry + 20);
      }

      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);

    return () => {
      running = false;
      window.removeEventListener('resize', resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ display: 'block', cursor: 'pointer' }}
    />
  );
}
