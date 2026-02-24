'use client';

import { useEffect, useRef } from 'react';
import { Cell, Position, Direction, Agent, AgentConfig, MoveRequest } from '@/lib/types';
import { generateMaze, mazeToAscii, getAvailableMoves, applyMove } from '@/lib/maze';

const MAZE_SIZE = 15;
const CENTER = Math.floor(MAZE_SIZE / 2); // 7
const TURN_DELAY = 800;

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

function createAgents(): Agent[] {
  return AGENT_CONFIGS.map((cfg) => ({
    ...cfg,
    position: { ...cfg.startPos },
    history: [],
    trail: [{ ...cfg.startPos }],
    finished: false,
    finishOrder: null,
  }));
}

type GameState = 'ready' | 'racing' | 'finished';

export default function MazeRacePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // All game state lives in refs so the animation loop never stales
  const mazeRef = useRef<Cell[][]>(generateMaze(MAZE_SIZE, MAZE_SIZE));
  const agentsRef = useRef<Agent[]>(createAgents());
  const stateRef = useRef<GameState>('ready');
  const turnRef = useRef(0);
  const winnerRef = useRef<Agent | null>(null);
  const processingRef = useRef(false);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    // Apply moves
    let finishCount = agents.filter((a) => a.finished).length;

    for (const move of results) {
      const agent = agents.find((a) => a.id === move.agentId);
      if (!agent || agent.finished) continue;

      const available = getAvailableMoves(maze, agent.position);
      if (available.includes(move.direction)) {
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
      }
    }

    turnRef.current++;
    processingRef.current = false;
  }

  function startRace() {
    stateRef.current = 'racing';
    loopRef.current = setInterval(processTurn, TURN_DELAY);
  }

  function newGame() {
    if (loopRef.current) clearInterval(loopRef.current);
    mazeRef.current = generateMaze(MAZE_SIZE, MAZE_SIZE);
    agentsRef.current = createAgents();
    turnRef.current = 0;
    winnerRef.current = null;
    processingRef.current = false;
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

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    let running = true;

    function draw() {
      if (!running) return;
      const w = canvas!.width;
      const h = canvas!.height;
      const maze = mazeRef.current;
      const agents = agentsRef.current;
      const state = stateRef.current;
      const turn = turnRef.current;
      const winner = winnerRef.current;

      // ── Background ──
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);

      // ── Maze dimensions ──
      const padding = 80;
      const topOffset = 70;
      const bottomOffset = 50;
      const availW = w - padding * 2;
      const availH = h - topOffset - bottomOffset - padding;
      const cellSize = Math.floor(Math.min(availW / MAZE_SIZE, availH / MAZE_SIZE));
      const mazeW = cellSize * MAZE_SIZE;
      const mazeH = cellSize * MAZE_SIZE;
      const ox = Math.floor((w - mazeW) / 2);
      const oy = Math.floor((h - mazeH) / 2) + 15;

      // ── Maze background ──
      ctx.fillStyle = '#111118';
      ctx.fillRect(ox, oy, mazeW, mazeH);

      // ── Draw walls ──
      ctx.strokeStyle = '#2d2d44';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';

      for (let r = 0; r < MAZE_SIZE; r++) {
        for (let c = 0; c < MAZE_SIZE; c++) {
          const x = ox + c * cellSize;
          const y = oy + r * cellSize;
          const cell = maze[r][c];

          if (cell.walls.top) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + cellSize, y);
            ctx.stroke();
          }
          if (cell.walls.right) {
            ctx.beginPath();
            ctx.moveTo(x + cellSize, y);
            ctx.lineTo(x + cellSize, y + cellSize);
            ctx.stroke();
          }
          if (cell.walls.bottom) {
            ctx.beginPath();
            ctx.moveTo(x, y + cellSize);
            ctx.lineTo(x + cellSize, y + cellSize);
            ctx.stroke();
          }
          if (cell.walls.left) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + cellSize);
            ctx.stroke();
          }
        }
      }

      // ── Outer border ──
      ctx.strokeStyle = '#3a3a55';
      ctx.lineWidth = 3;
      ctx.strokeRect(ox, oy, mazeW, mazeH);

      // ── Center goal ──
      const gx = ox + CENTER * cellSize + cellSize / 2;
      const gy = oy + CENTER * cellSize + cellSize / 2;
      const pulse = Math.sin(Date.now() / 300) * 0.3 + 0.7;

      // Goal glow
      const goalGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, cellSize * 0.7);
      goalGrad.addColorStop(0, `rgba(255,255,255,${pulse * 0.25})`);
      goalGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(gx, gy, cellSize * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = goalGrad;
      ctx.fill();

      // Goal dot
      ctx.beginPath();
      ctx.arc(gx, gy, cellSize * 0.2 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${pulse})`;
      ctx.fill();

      // Goal diamond
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(Math.PI / 4);
      const ds = cellSize * 0.18;
      ctx.strokeStyle = `rgba(255,255,255,${pulse * 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-ds, -ds, ds * 2, ds * 2);
      ctx.restore();

      // ── Agent trails ──
      for (const agent of agents) {
        if (agent.trail.length < 2) continue;
        ctx.beginPath();
        ctx.strokeStyle = agent.color + '30';
        ctx.lineWidth = cellSize * 0.18;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 0; i < agent.trail.length; i++) {
          const tx = ox + agent.trail[i].col * cellSize + cellSize / 2;
          const ty = oy + agent.trail[i].row * cellSize + cellSize / 2;
          if (i === 0) ctx.moveTo(tx, ty);
          else ctx.lineTo(tx, ty);
        }
        ctx.stroke();
      }

      // ── Agent dots ──
      for (const agent of agents) {
        const ax = ox + agent.position.col * cellSize + cellSize / 2;
        const ay = oy + agent.position.row * cellSize + cellSize / 2;

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

        // Thinking ring while racing
        if (state === 'racing' && !agent.finished && processingRef.current) {
          const ringPulse = Math.sin(Date.now() / 150 + agent.id) * 0.5 + 0.5;
          ctx.beginPath();
          ctx.arc(ax, ay, cellSize * 0.38, 0, Math.PI * 2);
          ctx.strokeStyle = agent.color + Math.floor(ringPulse * 99 + 10).toString(16);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // ── HUD: Title ──
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('M A Z E   R A C E', w / 2, 32);

      ctx.font = '13px "Courier New", monospace';
      ctx.fillStyle = '#555';
      ctx.fillText('Gemini Flash vs Gemini Flash vs Gemini Flash vs Gemini Flash', w / 2, 50);

      // ── HUD: Turn counter ──
      if (state === 'racing' || state === 'finished') {
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.fillText(`Turn ${turn}`, w - 20, 30);
      }

      // ── HUD: Agent status bar ──
      const barY = h - 35;
      const segW = w / 4;
      for (let i = 0; i < agents.length; i++) {
        const sx = segW * i + segW / 2;
        const a = agents[i];

        // Color dot
        ctx.beginPath();
        ctx.arc(sx - 50, barY, 5, 0, Math.PI * 2);
        ctx.fillStyle = a.color;
        ctx.fill();

        // Name
        ctx.fillStyle = a.color;
        ctx.font = 'bold 13px "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(a.name, sx - 40, barY + 4);

        // Status
        ctx.fillStyle = '#777';
        ctx.font = '12px "Courier New", monospace';
        let status: string;
        if (a.finished) {
          status = a.finishOrder === 1 ? 'WINNER' : `#${a.finishOrder}`;
          ctx.fillStyle = a.finishOrder === 1 ? a.color : '#555';
        } else {
          status = `${a.history.length} moves`;
        }
        ctx.fillText(status, sx + 20, barY + 4);
      }

      // ── Overlays ──
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

        // Animated start button
        const btnPulse = Math.sin(Date.now() / 500) * 0.15 + 0.85;
        ctx.fillStyle = `rgba(68,153,255,${btnPulse})`;
        ctx.font = 'bold 20px "Courier New", monospace';
        ctx.fillText('[ CLICK TO START ]', w / 2, h / 2 + 70);

        // Agent previews
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

        // Show all agent results
        const finishedAgents = [...agents]
          .filter((a) => a.finished)
          .sort((a, b) => (a.finishOrder || 99) - (b.finishOrder || 99));
        const unfinished = agents.filter((a) => !a.finished);

        let ry = h / 2 + 55;
        ctx.font = '14px "Courier New", monospace';
        for (const a of finishedAgents) {
          ctx.fillStyle = a.color;
          ctx.fillText(
            `#${a.finishOrder} ${a.name} — ${a.history.length} moves`,
            w / 2,
            ry
          );
          ry += 22;
        }
        for (const a of unfinished) {
          ctx.fillStyle = '#555';
          ctx.fillText(`-- ${a.name} — DNF (${a.history.length} moves)`, w / 2, ry);
          ry += 22;
        }

        const btnPulse2 = Math.sin(Date.now() / 500) * 0.15 + 0.85;
        ctx.fillStyle = `rgba(68,153,255,${btnPulse2})`;
        ctx.font = 'bold 18px "Courier New", monospace';
        ctx.fillText('[ CLICK FOR NEW RACE ]', w / 2, ry + 20);
      }

      requestAnimationFrame(draw);
    }

    draw();

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
