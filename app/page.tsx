'use client';

import { useEffect, useRef } from 'react';
import { Cell, Position, Direction, AgentConfig, MoveRequest, MoveOption, Enemy, EnemyType, NearbyEnemy } from '@/lib/types';
import { generateMaze, getAvailableMoves, applyMove } from '@/lib/maze';

// ─── Constants ─────────────────────────────────────────────

const MAZE_SIZE = 25;
const CENTER = Math.floor(MAZE_SIZE / 2); // 12
const ANIM_DURATION = 320; // shorter for snappier movement
const MIN_TURN_GAP = 0;   // no pause — continuous flowing movement
const ENEMY_DETECT_RANGE = 3;
const NUM_POWERUPS = 3;
const WRAPS_PER_EDGE = 2; // 1-2 wrap-around openings per maze edge

// ─── Power-up config ──────────────────────────────────────

type PowerUpType = 'speed' | 'shield' | 'magnet';

interface PowerUp {
  id: number;
  type: PowerUpType;
  position: Position;
  collected: boolean;
  respawnAt: number; // turn when it respawns
}

const POWERUP_DEFS: { type: PowerUpType; color: string; label: string; duration: number }[] = [
  { type: 'speed', color: '#ffdd00', label: 'Speed', duration: 5 },
  { type: 'shield', color: '#00ddff', label: 'Shield', duration: 6 },
  { type: 'magnet', color: '#ffffff', label: 'Magnet', duration: 0 }, // instant
];

const POWERUP_COLORS: Record<PowerUpType, string> = {
  speed: '#ffdd00',
  shield: '#00ddff',
  magnet: '#ffffff',
};

const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 0,
    name: 'Blaze',
    color: '#ff4444',
    glowColor: 'rgba(255,68,68,0.5)',
    personality:
      'You are bold and decisive. Pick fresh paths over visited ones. Move toward the goal when you can.',
    startPos: { row: 0, col: 0 },
  },
  {
    id: 1,
    name: 'Frost',
    color: '#4499ff',
    glowColor: 'rgba(68,153,255,0.5)',
    personality:
      'You are calm and calculated. Pick fresh paths over visited ones. Move toward the goal when you can.',
    startPos: { row: 0, col: MAZE_SIZE - 1 },
  },
  {
    id: 2,
    name: 'Venom',
    color: '#44ff66',
    glowColor: 'rgba(68,255,102,0.5)',
    personality:
      'You are sharp and tenacious. Pick fresh paths over visited ones. Move toward the goal when you can.',
    startPos: { row: MAZE_SIZE - 1, col: 0 },
  },
  {
    id: 3,
    name: 'Sol',
    color: '#ffcc00',
    glowColor: 'rgba(255,204,0,0.5)',
    personality:
      'You are quick and instinctive. Pick fresh paths over visited ones. Move toward the goal when you can.',
    startPos: { row: MAZE_SIZE - 1, col: MAZE_SIZE - 1 },
  },
];

// ─── Enemy config ─────────────────────────────────────────

const ENEMY_TYPES: { type: EnemyType; color: string; label: string }[] = [
  { type: 'ghost', color: '#aa44ff', label: 'Ghost' },
  { type: 'freezer', color: '#44ffff', label: 'Freezer' },
  { type: 'scrambler', color: '#ff8800', label: 'Scrambler' },
  { type: 'thief', color: '#aa2222', label: 'Thief' },
];

const ENEMY_COLORS: Record<EnemyType, string> = {
  ghost: '#aa44ff',
  freezer: '#44ffff',
  scrambler: '#ff8800',
  thief: '#aa2222',
};

// ─── Animation helpers ─────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ─── Helpers ───────────────────────────────────────────────

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down', down: 'up', left: 'right', right: 'left',
};

function posKey(p: Position): string {
  return `${p.row},${p.col}`;
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function samePos(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

/** Check if there's a clear straight-line path through maze corridors (no walls blocking). */
function hasLineOfSight(maze: Cell[][], from: Position, to: Position): boolean {
  if (from.row === to.row && from.col === to.col) return false; // same cell
  if (from.row !== to.row && from.col !== to.col) return false; // not axis-aligned

  if (from.row === to.row) {
    // Horizontal corridor — check for right/left walls between cells
    const row = from.row;
    const minCol = Math.min(from.col, to.col);
    const maxCol = Math.max(from.col, to.col);
    for (let c = minCol; c < maxCol; c++) {
      if (maze[row][c].walls.right) return false;
    }
    return true;
  } else {
    // Vertical corridor — check for bottom/top walls between cells
    const col = from.col;
    const minRow = Math.min(from.row, to.row);
    const maxRow = Math.max(from.row, to.row);
    for (let r = minRow; r < maxRow; r++) {
      if (maze[r][col].walls.bottom) return false;
    }
    return true;
  }
}

// ─── Splash screen particles ─────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
}

function createParticles(count: number): Particle[] {
  const colors = ['#ff4444', '#4499ff', '#44ff66', '#ffcc00', '#aa44ff', '#44ffff', '#ff8800'];
  return Array.from({ length: count }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0003,
    vy: (Math.random() - 0.5) * 0.0003,
    size: Math.random() * 2 + 0.5,
    color: colors[Math.floor(Math.random() * colors.length)],
    alpha: Math.random() * 0.4 + 0.1,
  }));
}

// ─── Extended agent with animation + visited tracking ──────

interface AnimAgent {
  id: number;
  name: string;
  color: string;
  glowColor: string;
  personality: string;
  startPos: Position;
  position: Position;
  prevPosition: Position;
  history: Direction[];
  trail: Position[];
  visited: Record<string, number>;
  finished: boolean;
  finishOrder: number | null;
  frozenTurns: number;
  scrambledTurns: number;
  statusEffect: EnemyType | null;
  statusEffectTurn: number;
  respawnTurn: number;
  speedTurns: number;
  shieldTurns: number;
}

function createAgents(): AnimAgent[] {
  return AGENT_CONFIGS.map((cfg) => {
    const key = posKey(cfg.startPos);
    return {
      ...cfg,
      startPos: { ...cfg.startPos },
      position: { ...cfg.startPos },
      prevPosition: { ...cfg.startPos },
      history: [],
      trail: [{ ...cfg.startPos }],
      visited: { [key]: 1 },
      finished: false,
      finishOrder: null,
      frozenTurns: 0,
      scrambledTurns: 0,
      statusEffect: null,
      statusEffectTurn: 0,
      respawnTurn: -99,
      speedTurns: 0,
      shieldTurns: 0,
    };
  });
}

// ─── Wrap-around edge helpers ─────────────────────────────

interface WrapOpening {
  edge: 'top' | 'bottom' | 'left' | 'right';
  pos: number; // row for left/right edges, col for top/bottom edges
}

/**
 * Punch wrap-around openings in the maze border.
 * Each opening removes a border wall on one edge and the matching wall on the opposite edge,
 * creating a tunnel that wraps the position around.
 */
function createWraps(maze: Cell[][]): WrapOpening[] {
  const last = MAZE_SIZE - 1;
  // Avoid corners (agent start positions) and center column/row
  const forbidden = new Set([0, last, CENTER]);

  function pickPositions(count: number): number[] {
    const picks: number[] = [];
    const used = new Set<number>();
    let attempts = 0;
    while (picks.length < count && attempts < 100) {
      const p = Math.floor(Math.random() * (MAZE_SIZE - 2)) + 1;
      if (!forbidden.has(p) && !used.has(p)) {
        picks.push(p);
        used.add(p);
      }
      attempts++;
    }
    return picks;
  }

  const wraps: WrapOpening[] = [];

  // Top-bottom wraps (punch top wall of row 0 + bottom wall of last row at same col)
  for (const col of pickPositions(WRAPS_PER_EDGE)) {
    maze[0][col].walls.top = false;
    maze[last][col].walls.bottom = false;
    wraps.push({ edge: 'top', pos: col });
    wraps.push({ edge: 'bottom', pos: col });
  }

  // Left-right wraps (punch left wall of col 0 + right wall of last col at same row)
  for (const row of pickPositions(WRAPS_PER_EDGE)) {
    maze[row][0].walls.left = false;
    maze[row][last].walls.right = false;
    wraps.push({ edge: 'left', pos: row });
    wraps.push({ edge: 'right', pos: row });
  }

  return wraps;
}

/** Check if a position is a wrap opening and return the wrapped destination. */
function checkWrap(pos: Position, dir: Direction): Position | null {
  if (dir === 'up' && pos.row < 0) return { row: MAZE_SIZE - 1, col: pos.col };
  if (dir === 'down' && pos.row >= MAZE_SIZE) return { row: 0, col: pos.col };
  if (dir === 'left' && pos.col < 0) return { row: pos.row, col: MAZE_SIZE - 1 };
  if (dir === 'right' && pos.col >= MAZE_SIZE) return { row: pos.row, col: 0 };
  return null;
}

// ─── Enemy helpers ────────────────────────────────────────

function createEnemies(): Enemy[] {
  const types: EnemyType[] = ['ghost', 'freezer', 'scrambler', 'thief'];
  const center: Position = { row: CENTER, col: CENTER };
  const startDirs: (Direction | null)[] = ['up', 'down', 'left', 'right'];

  return types.map((type, i) => ({
    id: i,
    type,
    position: { ...center },
    prevPosition: { ...center },
    lastDirection: startDirs[i],
  }));
}


// ─── Power-up helpers ─────────────────────────────────────

function getRandomPowerUpPosition(): Position {
  const center = CENTER;
  const forbidden = new Set([
    '0,0', `0,${MAZE_SIZE - 1}`,
    `${MAZE_SIZE - 1},0`, `${MAZE_SIZE - 1},${MAZE_SIZE - 1}`,
    `${center},${center}`,
  ]);
  let pos: Position;
  do {
    pos = {
      row: Math.floor(Math.random() * (MAZE_SIZE - 2)) + 1,
      col: Math.floor(Math.random() * (MAZE_SIZE - 2)) + 1,
    };
  } while (forbidden.has(posKey(pos)));
  return pos;
}

function createPowerUps(): PowerUp[] {
  const types: PowerUpType[] = ['speed', 'shield', 'magnet'];
  return types.map((type, i) => ({
    id: i,
    type,
    position: getRandomPowerUpPosition(),
    collected: false,
    respawnAt: 0,
  }));
}

function moveEnemies(enemies: Enemy[], maze: Cell[][], agents: AnimAgent[]) {
  for (const enemy of enemies) {
    const available = getAvailableMoves(maze, enemy.position);
    if (available.length === 0) continue;

    // Check LOS to nearest active agent — chase if spotted
    let chaseDir: Direction | null = null;
    let closestDist = Infinity;
    for (const agent of agents) {
      if (agent.finished) continue;
      if (!hasLineOfSight(maze, enemy.position, agent.position)) continue;
      const dist = manhattan(enemy.position, agent.position);
      if (dist >= closestDist) continue;
      closestDist = dist;
      // Determine direction toward agent
      if (agent.position.row < enemy.position.row && available.includes('up')) chaseDir = 'up';
      else if (agent.position.row > enemy.position.row && available.includes('down')) chaseDir = 'down';
      else if (agent.position.col < enemy.position.col && available.includes('left')) chaseDir = 'left';
      else if (agent.position.col > enemy.position.col && available.includes('right')) chaseDir = 'right';
    }

    let dir: Direction;
    if (chaseDir) {
      // LOS chase — lock on and pursue
      dir = chaseDir;
    } else if (enemy.lastDirection && available.includes(enemy.lastDirection) && Math.random() < 0.7) {
      dir = enemy.lastDirection;
    } else {
      const nonReverse = enemy.lastDirection
        ? available.filter((d) => d !== OPPOSITE[enemy.lastDirection!])
        : available;
      const choices = nonReverse.length > 0 ? nonReverse : available;
      dir = choices[Math.floor(Math.random() * choices.length)];
    }

    enemy.prevPosition = { ...enemy.position };
    let eNewPos = applyMove(enemy.position, dir);
    const ew = checkWrap(eNewPos, dir);
    if (ew) eNewPos = ew;
    enemy.position = eNewPos;
    enemy.lastDirection = dir;
  }
}

type GameState = 'ready' | 'racing' | 'finished';

// ─── Component ─────────────────────────────────────────────

export default function MazeRacePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const initMaze = generateMaze(MAZE_SIZE, MAZE_SIZE);
  const initWraps = createWraps(initMaze);
  const mazeRef = useRef<Cell[][]>(initMaze);
  const wrapsRef = useRef<WrapOpening[]>(initWraps);
  const agentsRef = useRef<AnimAgent[]>(createAgents());
  const enemiesRef = useRef<Enemy[]>(createEnemies());
  const powerUpsRef = useRef<PowerUp[]>(createPowerUps());
  const stateRef = useRef<GameState>('ready');
  const turnRef = useRef(0);
  const winnerRef = useRef<AnimAgent | null>(null);
  const processingRef = useRef(false);
  const gameLoopActiveRef = useRef(false);
  const moveTimeRef = useRef(0);

  // Floating notifications for power-up pickups
  const notificationsRef = useRef<{ text: string; color: string; agentColor: string; time: number; pos: Position }[]>([]);

  // Splash / pick-your-winner state
  const mouseRef = useRef({ x: 0, y: 0 });
  const pickedWinnerRef = useRef<number | null>(null); // agent id
  const particlesRef = useRef<Particle[]>(createParticles(60));
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ─── Collision detection & respawn ────────────────────────

  function checkEnemyCollisions() {
    const agents = agentsRef.current;
    const enemies = enemiesRef.current;
    const currentTurn = turnRef.current;

    for (const enemy of enemies) {
      for (const agent of agents) {
        if (agent.finished) continue;

        const sameCellNow = samePos(agent.position, enemy.position);
        const crossedPaths =
          samePos(agent.position, enemy.prevPosition) &&
          samePos(agent.prevPosition, enemy.position);

        if (sameCellNow || crossedPaths) {
          if (agent.shieldTurns > 0) {
            // Shield absorbs the hit — enemy just passes through
          } else {
            respawnAgent(agent, currentTurn);
          }
        }
      }
    }
  }

  function respawnAgent(agent: AnimAgent, currentTurn: number) {
    const start = agent.startPos;
    agent.position = { ...start };
    agent.prevPosition = { ...start };
    agent.trail = [{ ...start }];
    agent.visited = { [posKey(start)]: 1 };
    agent.respawnTurn = currentTurn;
    agent.frozenTurns = 0;
    agent.scrambledTurns = 0;
    agent.statusEffect = null;
    agent.speedTurns = 0;
    agent.shieldTurns = 0;
  }

  // ─── Power-up collection ──────────────────────────────────

  function checkPowerUpCollection(agent: AnimAgent, maze: Cell[][]) {
    const powerUps = powerUpsRef.current;
    const currentTurn = turnRef.current;
    const goal: Position = { row: CENTER, col: CENTER };

    for (const pu of powerUps) {
      if (pu.collected) continue;
      if (!samePos(agent.position, pu.position)) continue;

      // Collect it
      pu.collected = true;
      pu.respawnAt = currentTurn + 10; // respawn after 10 turns
      const puDef = POWERUP_DEFS.find((d) => d.type === pu.type)!;
      notificationsRef.current.push({
        text: `${agent.name} +${puDef.label.toUpperCase()}`,
        color: puDef.color,
        agentColor: agent.color,
        time: performance.now(),
        pos: { ...agent.position },
      });

      switch (pu.type) {
        case 'speed':
          agent.speedTurns = 5;
          break;
        case 'shield':
          agent.shieldTurns = 6;
          break;
        case 'magnet': {
          // Pull agent 2 steps toward goal using maze paths
          for (let step = 0; step < 2; step++) {
            const dirs = getAvailableMoves(maze, agent.position);
            if (dirs.length === 0) break;
            // Pick direction that reduces distance to goal
            let bestDir = dirs[0];
            let bestDist = Infinity;
            for (const d of dirs) {
              let next = applyMove(agent.position, d);
              const mw = checkWrap(next, d);
              if (mw) next = mw;
              const dist = manhattan(next, goal);
              if (dist < bestDist) {
                bestDist = dist;
                bestDir = d;
              }
            }
            agent.prevPosition = { ...agent.position };
            let magnetPos = applyMove(agent.position, bestDir);
            const mwp = checkWrap(magnetPos, bestDir);
            if (mwp) magnetPos = mwp;
            agent.position = magnetPos;
            agent.trail.push({ ...agent.position });
            const key = posKey(agent.position);
            agent.visited[key] = (agent.visited[key] || 0) + 1;

            // Check if reached goal
            if (agent.position.row === CENTER && agent.position.col === CENTER) break;
          }
          break;
        }
      }
    }
  }

  function respawnCollectedPowerUps() {
    const currentTurn = turnRef.current;
    for (const pu of powerUpsRef.current) {
      if (pu.collected && currentTurn >= pu.respawnAt) {
        pu.position = getRandomPowerUpPosition();
        pu.collected = false;
      }
    }
  }

  // ─── Game logic ──────────────────────────────────────────

  async function processTurn() {
    if (processingRef.current || stateRef.current !== 'racing') return;
    processingRef.current = true;

    const maze = mazeRef.current;
    const agents = agentsRef.current;
    const enemies = enemiesRef.current;
    const goal: Position = { row: CENTER, col: CENTER };

    const active = agents.filter((a) => !a.finished);
    if (active.length === 0) {
      processingRef.current = false;
      return;
    }

    for (const enemy of enemies) {
      enemy.prevPosition = { ...enemy.position };
    }

    const results = await Promise.all(
      active.map(async (agent) => {
        const directions = getAvailableMoves(maze, agent.position);
        const lastMove = agent.history.length > 0 ? agent.history[agent.history.length - 1] : null;

        const moveOptions: MoveOption[] = directions.map((dir) => {
          let target = applyMove(agent.position, dir);
          const wrapped = checkWrap(target, dir);
          if (wrapped) target = wrapped;
          const key = posKey(target);
          return {
            direction: dir,
            row: target.row,
            col: target.col,
            distanceToGoal: manhattan(target, goal),
            timesVisited: agent.visited[key] || 0,
            isReverse: lastMove !== null && dir === OPPOSITE[lastMove],
          };
        });

        const nearbyEnemies: NearbyEnemy[] = enemies
          .map((e) => ({
            type: e.type,
            position: e.position,
            distance: manhattan(agent.position, e.position),
          }))
          .filter((e) => e.distance <= ENEMY_DETECT_RANGE);

        const body: MoveRequest = {
          agentName: agent.name,
          personality: agent.personality,
          position: agent.position,
          goal,
          currentDistance: manhattan(agent.position, goal),
          moveOptions,
          recentMoves: agent.history.slice(-15),
          nearbyEnemies,
          isScrambled: false,
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
          const best = [...moveOptions].sort((a, b) => {
            if (a.timesVisited === 0 && b.timesVisited > 0) return -1;
            if (b.timesVisited === 0 && a.timesVisited > 0) return 1;
            return a.distanceToGoal - b.distanceToGoal;
          });
          return { agentId: agent.id, direction: best[0].direction };
        }
      })
    );

    for (const agent of active) {
      agent.prevPosition = { ...agent.position };
    }

    let finishCount = agents.filter((a) => a.finished).length;

    for (const move of results) {
      const agent = agents.find((a) => a.id === move.agentId);
      if (!agent || agent.finished) continue;

      const available = getAvailableMoves(maze, agent.position);
      if (available.includes(move.direction)) {
        let newPos = applyMove(agent.position, move.direction);
        const wrapped = checkWrap(newPos, move.direction);
        if (wrapped) newPos = wrapped;
        agent.position = newPos;
        agent.history.push(move.direction);
        agent.trail.push({ ...agent.position });

        const key = posKey(agent.position);
        agent.visited[key] = (agent.visited[key] || 0) + 1;

        if (agent.position.row === CENTER && agent.position.col === CENTER) {
          finishCount++;
          agent.finished = true;
          agent.finishOrder = finishCount;
          if (finishCount === 1) {
            winnerRef.current = agent;
            stateRef.current = 'finished';
            gameLoopActiveRef.current = false;
          }
        }
      }
    }

    // Check power-up collection for all agents that moved
    for (const move of results) {
      const agent = agents.find((a) => a.id === move.agentId);
      if (agent && !agent.finished) {
        checkPowerUpCollection(agent, maze);
      }
    }

    // Speed boost: agents with speed get a bonus move
    for (const agent of agents) {
      if (agent.finished || agent.speedTurns <= 0) continue;

      const dirs = getAvailableMoves(maze, agent.position);
      const lastMove = agent.history.length > 0 ? agent.history[agent.history.length - 1] : null;
      const goal: Position = { row: CENTER, col: CENTER };

      // Pick best direction (unvisited + toward goal)
      const options = dirs.map((dir) => {
        let target = applyMove(agent.position, dir);
        const w = checkWrap(target, dir);
        if (w) target = w;
        return {
          dir,
          dist: manhattan(target, goal),
          visited: agent.visited[posKey(target)] || 0,
          isReverse: lastMove !== null && dir === OPPOSITE[lastMove],
        };
      });
      options.sort((a, b) => {
        if (a.visited === 0 && b.visited > 0) return -1;
        if (b.visited === 0 && a.visited > 0) return 1;
        return a.dist - b.dist;
      });

      if (options.length > 0) {
        agent.prevPosition = { ...agent.position };
        let bonusPos = applyMove(agent.position, options[0].dir);
        const bw = checkWrap(bonusPos, options[0].dir);
        if (bw) bonusPos = bw;
        agent.position = bonusPos;
        agent.history.push(options[0].dir);
        agent.trail.push({ ...agent.position });
        const key = posKey(agent.position);
        agent.visited[key] = (agent.visited[key] || 0) + 1;

        checkPowerUpCollection(agent, maze);

        if (agent.position.row === CENTER && agent.position.col === CENTER && !agent.finished) {
          finishCount++;
          agent.finished = true;
          agent.finishOrder = finishCount;
          if (finishCount === 1) {
            winnerRef.current = agent;
            stateRef.current = 'finished';
            gameLoopActiveRef.current = false;
          }
        }
      }
    }

    // Decrement power-up timers
    for (const agent of agents) {
      if (agent.speedTurns > 0) agent.speedTurns--;
      if (agent.shieldTurns > 0) agent.shieldTurns--;
    }

    // Respawn collected power-ups
    respawnCollectedPowerUps();

    moveEnemies(enemies, maze, agents);

    checkEnemyCollisions();

    // Periodic shuffle — uncollected power-ups drift every 15 turns
    const nextTurn = turnRef.current + 1;
    if (nextTurn > 0 && nextTurn % 15 === 0) {
      for (const pu of powerUpsRef.current) {
        if (!pu.collected) {
          pu.position = getRandomPowerUpPosition();
        }
      }
    }

    moveTimeRef.current = performance.now();
    turnRef.current++;
    processingRef.current = false;
  }

  function startRace() {
    stateRef.current = 'racing';
    moveTimeRef.current = performance.now();
    gameLoopActiveRef.current = true;

    // Start music
    if (!audioRef.current) {
      audioRef.current = new Audio('/music.mp3');
      audioRef.current.loop = true;
      audioRef.current.volume = 0.5;
    }
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});

    // Async game loop — waits for each turn + animation before starting next
    (async () => {
      while (gameLoopActiveRef.current) {
        await processTurn();
        const elapsed = performance.now() - moveTimeRef.current;
        const remaining = ANIM_DURATION + MIN_TURN_GAP - elapsed;
        if (remaining > 0) {
          await new Promise((r) => setTimeout(r, remaining));
        }
      }
    })();
  }

  function newGame() {
    gameLoopActiveRef.current = false;
    const newMaze = generateMaze(MAZE_SIZE, MAZE_SIZE);
    wrapsRef.current = createWraps(newMaze);
    mazeRef.current = newMaze;
    agentsRef.current = createAgents();
    enemiesRef.current = createEnemies();
    powerUpsRef.current = createPowerUps();
    turnRef.current = 0;
    winnerRef.current = null;
    processingRef.current = false;
    moveTimeRef.current = 0;
    pickedWinnerRef.current = null;
    stateRef.current = 'ready';

    // Stop music
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }

  // ─── Click handling with agent picking ────────────────────

  function getAgentCardBounds(w: number, h: number) {
    const cardW = 110;
    const cardH = 70;
    const gap = 20;
    const totalW = AGENT_CONFIGS.length * cardW + (AGENT_CONFIGS.length - 1) * gap;
    const startX = (w - totalW) / 2;
    const cardY = h / 2 + 12;

    return AGENT_CONFIGS.map((_, i) => ({
      x: startX + i * (cardW + gap),
      y: cardY,
      w: cardW,
      h: cardH,
    }));
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (stateRef.current === 'ready') {
      // Check if clicking on an agent card
      const bounds = getAgentCardBounds(w, h);
      for (let i = 0; i < bounds.length; i++) {
        const b = bounds[i];
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          pickedWinnerRef.current = i;
          return;
        }
      }

      // Check if clicking the start button (only if a winner is picked)
      if (pickedWinnerRef.current !== null) {
        const btnY = h / 2 + 120;
        if (my >= btnY - 15 && my <= btnY + 15) {
          startRace();
        }
      }
    } else if (stateRef.current === 'finished') {
      newGame();
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    mouseRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
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

    // ─── Enemy shape drawing helpers ──────────────────────

    function drawGhost(cx: number, cy: number, size: number, now: number) {
      ctx.beginPath();
      ctx.arc(cx, cy - size * 0.15, size * 0.7, Math.PI, 0);
      ctx.lineTo(cx + size * 0.7, cy + size * 0.5);
      for (let i = 3; i >= -3; i--) {
        const wx = cx + (i / 3) * size * 0.7;
        const wy = cy + size * 0.5 + Math.sin(i + now / 150) * size * 0.15;
        ctx.lineTo(wx, wy);
      }
      ctx.closePath();
    }

    function drawDiamond(cx: number, cy: number, size: number) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - size * 0.65);
      ctx.lineTo(cx + size * 0.5, cy);
      ctx.lineTo(cx, cy + size * 0.65);
      ctx.lineTo(cx - size * 0.5, cy);
      ctx.closePath();
    }

    function drawTriangle(cx: number, cy: number, size: number) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - size * 0.6);
      ctx.lineTo(cx + size * 0.55, cy + size * 0.45);
      ctx.lineTo(cx - size * 0.55, cy + size * 0.45);
      ctx.closePath();
    }

    function drawSquareShape(cx: number, cy: number, size: number) {
      const half = size * 0.45;
      ctx.beginPath();
      ctx.rect(cx - half, cy - half, half * 2, half * 2);
    }

    // ─── Draw splash screen (fully opaque) ───────────────

    function drawSplash(w: number, h: number, now: number) {
      // Solid dark background
      ctx.fillStyle = '#08080e';
      ctx.fillRect(0, 0, w, h);

      // Animated particles
      const particles = particlesRef.current;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;

        const px = p.x * w;
        const py = p.y * h;
        const twinkle = Math.sin(now / 1000 + p.x * 10 + p.y * 10) * 0.3 + 0.7;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color + Math.floor(p.alpha * twinkle * 255).toString(16).padStart(2, '0');
        ctx.fill();
      }

      // Subtle vignette
      const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.8);
      vg.addColorStop(0, 'rgba(8,8,14,0)');
      vg.addColorStop(1, 'rgba(8,8,14,0.6)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      ctx.textAlign = 'center';

      // Title with glow
      const titleY = h / 2 - 130;
      ctx.save();
      ctx.shadowColor = '#4499ff';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 52px "Courier New", monospace';
      ctx.fillText('MAZE RACE', w / 2, titleY);
      ctx.restore();

      // Decorative line
      const lineW = 300;
      const lineGrad = ctx.createLinearGradient(w / 2 - lineW / 2, 0, w / 2 + lineW / 2, 0);
      lineGrad.addColorStop(0, 'rgba(68,153,255,0)');
      lineGrad.addColorStop(0.5, 'rgba(68,153,255,0.6)');
      lineGrad.addColorStop(1, 'rgba(68,153,255,0)');
      ctx.fillStyle = lineGrad;
      ctx.fillRect(w / 2 - lineW / 2, titleY + 18, lineW, 1.5);

      // Subtitle
      ctx.fillStyle = '#6688aa';
      ctx.font = '15px "Courier New", monospace';
      ctx.fillText('4 AI agents  //  Gemini Flash  //  dodge enemies  //  reach the center', w / 2, titleY + 48);

      // "WHO WILL WIN?" prompt
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px "Courier New", monospace';
      ctx.fillText('WHO WILL WIN?', w / 2, h / 2 - 20);

      ctx.fillStyle = '#556677';
      ctx.font = '13px "Courier New", monospace';
      ctx.fillText('Pick your champion', w / 2, h / 2 + 2);

      // Agent selection cards
      const bounds = getAgentCardBounds(w, h);
      const mouse = mouseRef.current;
      const picked = pickedWinnerRef.current;

      for (let i = 0; i < AGENT_CONFIGS.length; i++) {
        const cfg = AGENT_CONFIGS[i];
        const b = bounds[i];
        const isHovered = mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
        const isSelected = picked === i;

        // Card background
        if (isSelected) {
          ctx.fillStyle = cfg.color + '25';
          ctx.strokeStyle = cfg.color;
          ctx.lineWidth = 2;
        } else if (isHovered) {
          ctx.fillStyle = '#ffffff08';
          ctx.strokeStyle = '#ffffff33';
          ctx.lineWidth = 1;
        } else {
          ctx.fillStyle = '#ffffff05';
          ctx.strokeStyle = '#ffffff15';
          ctx.lineWidth = 1;
        }

        // Rounded rect
        const r = 8;
        ctx.beginPath();
        ctx.moveTo(b.x + r, b.y);
        ctx.lineTo(b.x + b.w - r, b.y);
        ctx.quadraticCurveTo(b.x + b.w, b.y, b.x + b.w, b.y + r);
        ctx.lineTo(b.x + b.w, b.y + b.h - r);
        ctx.quadraticCurveTo(b.x + b.w, b.y + b.h, b.x + b.w - r, b.y + b.h);
        ctx.lineTo(b.x + r, b.y + b.h);
        ctx.quadraticCurveTo(b.x, b.y + b.h, b.x, b.y + b.h - r);
        ctx.lineTo(b.x, b.y + r);
        ctx.quadraticCurveTo(b.x, b.y, b.x + r, b.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Agent dot
        const dotX = b.x + b.w / 2;
        const dotY = b.y + 24;
        const dotPulse = isSelected ? Math.sin(now / 300) * 3 + 12 : 10;

        if (isSelected) {
          const glow = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, dotPulse + 5);
          glow.addColorStop(0, cfg.glowColor);
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotPulse + 5, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(dotX, dotY, dotPulse, 0, Math.PI * 2);
        ctx.fillStyle = cfg.color;
        ctx.fill();

        // Agent name
        ctx.fillStyle = isSelected ? cfg.color : '#aaaaaa';
        ctx.font = `${isSelected ? 'bold ' : ''}13px "Courier New", monospace`;
        ctx.fillText(cfg.name, dotX, b.y + b.h - 12);
      }

      // Start button (only if picked)
      if (picked !== null) {
        const btnY = h / 2 + 120;
        const btnPulse = Math.sin(now / 400) * 0.15 + 0.85;
        const pickedCfg = AGENT_CONFIGS[picked];

        ctx.save();
        ctx.shadowColor = pickedCfg.color;
        ctx.shadowBlur = 15;
        ctx.fillStyle = pickedCfg.color + Math.floor(btnPulse * 255).toString(16).padStart(2, '0');
        ctx.font = 'bold 20px "Courier New", monospace';
        ctx.fillText(`[ START RACE ]`, w / 2, btnY);
        ctx.restore();

        ctx.fillStyle = '#556677';
        ctx.font = '12px "Courier New", monospace';
        ctx.fillText(`Your pick: ${pickedCfg.name}`, w / 2, btnY + 28);
      }

      // Hazard icons at the bottom
      const infoY = h - 90;

      // Enemy row
      ctx.fillStyle = '#445566';
      ctx.font = '10px "Courier New", monospace';
      ctx.fillText('ENEMIES', w / 2 - 180, infoY);
      for (let i = 0; i < ENEMY_TYPES.length; i++) {
        const et = ENEMY_TYPES[i];
        const ex = w / 2 - 130 + i * 70;
        ctx.fillStyle = et.color;
        ctx.beginPath();
        ctx.arc(ex, infoY - 1, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#778899';
        ctx.fillText(et.label, ex + 10, infoY);
      }

      // Wrap-around row
      ctx.fillStyle = '#445566';
      ctx.fillText('WRAPS', w / 2 - 180, infoY + 22);
      ctx.fillStyle = '#778899';
      ctx.fillText('Some edges wrap to the opposite side', w / 2 - 100, infoY + 22);

      // Power-up row
      ctx.fillStyle = '#445566';
      ctx.fillText('POWER-UPS', w / 2 - 180, infoY + 44);
      for (let i = 0; i < POWERUP_DEFS.length; i++) {
        const pd = POWERUP_DEFS[i];
        const bx = w / 2 - 130 + i * 90;
        ctx.fillStyle = pd.color;
        ctx.beginPath();
        ctx.arc(bx, infoY + 43, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#778899';
        ctx.fillText(pd.label, bx + 10, infoY + 44);
      }

      // Footer
      ctx.fillStyle = '#333344';
      ctx.font = '10px "Courier New", monospace';
      ctx.fillText('Touch an enemy = back to start  |  Edges can wrap around', w / 2, h - 30);
    }

    function draw() {
      if (!running) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = window.innerWidth;
      const h = window.innerHeight;
      const maze = mazeRef.current;
      const agents = agentsRef.current;
      const enemies = enemiesRef.current;
      const state = stateRef.current;
      const turn = turnRef.current;
      const winner = winnerRef.current;
      const now = performance.now();

      // ── Splash screen (fully opaque, dedicated renderer) ──
      if (state === 'ready') {
        drawSplash(w, h, now);
        requestAnimationFrame(draw);
        return;
      }

      const rawT = moveTimeRef.current > 0
        ? (now - moveTimeRef.current) / ANIM_DURATION
        : 1;
      const animT = easeOutCubic(Math.min(Math.max(rawT, 0), 1));

      // ── Background ──
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);

      // ── Layout: POV panel on right if screen is wide enough ──
      const POV_PANEL_W = 200;
      const POV_VIEW_RADIUS = 3; // cells around agent (7x7 grid)
      const showPov = w >= 900;
      const mazeAreaW = showPov ? w - POV_PANEL_W - 10 : w;

      // ── Maze dimensions ──
      const padding = 80;
      const availW = mazeAreaW - padding * 2;
      const availH = h - 130 - padding;
      const cellSize = Math.floor(Math.min(availW / MAZE_SIZE, availH / MAZE_SIZE));
      const mazeW = cellSize * MAZE_SIZE;
      const mazeH = cellSize * MAZE_SIZE;
      const ox = Math.floor((mazeAreaW - mazeW) / 2);
      const oy = Math.floor((h - mazeH) / 2) + 15;

      // ── Maze background ──
      ctx.fillStyle = '#111118';
      ctx.fillRect(ox, oy, mazeW, mazeH);

      // ── Draw walls ──
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

      // ── Wrap-around edge indicators ──
      const wraps = wrapsRef.current;
      const wrapPulse = Math.sin(now / 400) * 0.4 + 0.6;
      const wrapColor = `rgba(100,200,255,${wrapPulse.toFixed(2)})`;
      ctx.strokeStyle = wrapColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const wrap of wraps) {
        const arrowLen = cellSize * 0.3;
        if (wrap.edge === 'top') {
          const wx = ox + wrap.pos * cellSize + cellSize / 2;
          const wy = oy;
          // Gap in border + arrow pointing up
          ctx.clearRect(wx - cellSize * 0.3, wy - 2, cellSize * 0.6, 5);
          ctx.beginPath(); ctx.moveTo(wx, wy - arrowLen); ctx.lineTo(wx - 4, wy - 2); ctx.moveTo(wx, wy - arrowLen); ctx.lineTo(wx + 4, wy - 2); ctx.stroke();
        } else if (wrap.edge === 'bottom') {
          const wx = ox + wrap.pos * cellSize + cellSize / 2;
          const wy = oy + mazeH;
          ctx.clearRect(wx - cellSize * 0.3, wy - 2, cellSize * 0.6, 5);
          ctx.beginPath(); ctx.moveTo(wx, wy + arrowLen); ctx.lineTo(wx - 4, wy + 2); ctx.moveTo(wx, wy + arrowLen); ctx.lineTo(wx + 4, wy + 2); ctx.stroke();
        } else if (wrap.edge === 'left') {
          const wx = ox;
          const wy = oy + wrap.pos * cellSize + cellSize / 2;
          ctx.clearRect(wx - 2, wy - cellSize * 0.3, 5, cellSize * 0.6);
          ctx.beginPath(); ctx.moveTo(wx - arrowLen, wy); ctx.lineTo(wx - 2, wy - 4); ctx.moveTo(wx - arrowLen, wy); ctx.lineTo(wx - 2, wy + 4); ctx.stroke();
        } else if (wrap.edge === 'right') {
          const wx = ox + mazeW;
          const wy = oy + wrap.pos * cellSize + cellSize / 2;
          ctx.clearRect(wx - 2, wy - cellSize * 0.3, 5, cellSize * 0.6);
          ctx.beginPath(); ctx.moveTo(wx + arrowLen, wy); ctx.lineTo(wx + 2, wy - 4); ctx.moveTo(wx + arrowLen, wy); ctx.lineTo(wx + 2, wy + 4); ctx.stroke();
        }
      }

      // ── Center goal ──
      const gx = ox + CENTER * cellSize + cellSize / 2;
      const gy = oy + CENTER * cellSize + cellSize / 2;
      const goalPulse = Math.sin(now / 300) * 0.3 + 0.7;

      const goalGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, cellSize * 0.7);
      goalGrad.addColorStop(0, `rgba(255,255,255,${(goalPulse * 0.25).toFixed(2)})`);
      goalGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(gx, gy, cellSize * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = goalGrad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(gx, gy, cellSize * 0.2 * goalPulse, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${goalPulse.toFixed(2)})`;
      ctx.fill();

      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(Math.PI / 4);
      const ds = cellSize * 0.18;
      ctx.strokeStyle = `rgba(255,255,255,${(goalPulse * 0.6).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-ds, -ds, ds * 2, ds * 2);
      ctx.restore();

      // ── Power-ups ──
      const powerUps = powerUpsRef.current;
      for (const pu of powerUps) {
        if (pu.collected) continue;
        const px = ox + pu.position.col * cellSize + cellSize / 2;
        const py = oy + pu.position.row * cellSize + cellSize / 2;
        const puColor = POWERUP_COLORS[pu.type];
        const puPulse = Math.sin(now / 400 + pu.id * 3) * 0.3 + 0.7;
        const puSize = cellSize * 0.3;

        // Glow
        const puGrad = ctx.createRadialGradient(px, py, 0, px, py, cellSize * 0.5);
        puGrad.addColorStop(0, puColor + Math.floor(puPulse * 40).toString(16).padStart(2, '0'));
        puGrad.addColorStop(1, puColor + '00');
        ctx.beginPath();
        ctx.arc(px, py, cellSize * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = puGrad;
        ctx.fill();

        ctx.fillStyle = puColor;
        switch (pu.type) {
          case 'speed': {
            // Lightning bolt
            ctx.beginPath();
            ctx.moveTo(px + puSize * 0.1, py - puSize * 0.8);
            ctx.lineTo(px - puSize * 0.3, py + puSize * 0.05);
            ctx.lineTo(px + puSize * 0.05, py + puSize * 0.05);
            ctx.lineTo(px - puSize * 0.1, py + puSize * 0.8);
            ctx.lineTo(px + puSize * 0.3, py - puSize * 0.05);
            ctx.lineTo(px - puSize * 0.05, py - puSize * 0.05);
            ctx.closePath();
            ctx.fill();
            break;
          }
          case 'shield': {
            // Circle with cross
            ctx.beginPath();
            ctx.arc(px, py, puSize * 0.6, 0, Math.PI * 2);
            ctx.strokeStyle = puColor;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px, py - puSize * 0.4);
            ctx.lineTo(px, py + puSize * 0.4);
            ctx.moveTo(px - puSize * 0.4, py);
            ctx.lineTo(px + puSize * 0.4, py);
            ctx.stroke();
            break;
          }
          case 'magnet': {
            // 4-pointed star
            const s = puSize * 0.7;
            const si = puSize * 0.25;
            ctx.beginPath();
            ctx.moveTo(px, py - s);
            ctx.lineTo(px + si, py - si);
            ctx.lineTo(px + s, py);
            ctx.lineTo(px + si, py + si);
            ctx.lineTo(px, py + s);
            ctx.lineTo(px - si, py + si);
            ctx.lineTo(px - s, py);
            ctx.lineTo(px - si, py - si);
            ctx.closePath();
            ctx.fill();
            break;
          }
        }
      }

      // ── Pass 1: Agent trails ──
      for (const agent of agents) {
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
          const visCol = lerp(agent.prevPosition.col, agent.position.col, animT);
          const visRow = lerp(agent.prevPosition.row, agent.position.row, animT);
          ctx.lineTo(ox + visCol * cellSize + cellSize / 2, oy + visRow * cellSize + cellSize / 2);
          ctx.stroke();
        }
      }

      // ── Pass 2: Enemies ──
      for (const enemy of enemies) {
        const eVisCol = lerp(enemy.prevPosition.col, enemy.position.col, animT);
        const eVisRow = lerp(enemy.prevPosition.row, enemy.position.row, animT);
        const ex = ox + eVisCol * cellSize + cellSize / 2;
        const ey = oy + eVisRow * cellSize + cellSize / 2;
        const color = ENEMY_COLORS[enemy.type];
        const eSize = cellSize * 0.6;

        const ePulse = Math.sin(now / 400 + enemy.id * 2) * 0.3 + 0.5;
        const auraAlpha = Math.floor(ePulse * 60).toString(16).padStart(2, '0');
        const auraGrad = ctx.createRadialGradient(ex, ey, 0, ex, ey, cellSize * 0.8);
        auraGrad.addColorStop(0, color + auraAlpha);
        auraGrad.addColorStop(1, color + '00');
        ctx.beginPath();
        ctx.arc(ex, ey, cellSize * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = auraGrad;
        ctx.fill();

        ctx.fillStyle = color;
        switch (enemy.type) {
          case 'ghost':
            drawGhost(ex, ey, eSize, now);
            ctx.fill();
            break;
          case 'freezer':
            drawDiamond(ex, ey, eSize);
            ctx.fill();
            break;
          case 'scrambler':
            drawTriangle(ex, ey, eSize);
            ctx.fill();
            break;
          case 'thief':
            drawSquareShape(ex, ey, eSize);
            ctx.fill();
            break;
        }
      }

      // ── Pass 3: Agent dots ──
      for (const agent of agents) {
        const visCol = lerp(agent.prevPosition.col, agent.position.col, animT);
        const visRow = lerp(agent.prevPosition.row, agent.position.row, animT);
        const ax = ox + visCol * cellSize + cellSize / 2;
        const ay = oy + visRow * cellSize + cellSize / 2;

        const turnsSinceRespawn = turn - agent.respawnTurn;
        if (turnsSinceRespawn >= 0 && turnsSinceRespawn < 3) {
          const flashProgress = turnsSinceRespawn / 3;
          const flashRadius = cellSize * (0.5 + flashProgress * 1.5);
          const flashAlpha = 1 - flashProgress;
          ctx.beginPath();
          ctx.arc(ax, ay, flashRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,50,50,${flashAlpha.toFixed(2)})`;
          ctx.lineWidth = 3;
          ctx.stroke();

          const innerAlpha = (1 - flashProgress) * (0.5 + Math.sin(now / 80) * 0.3);
          ctx.beginPath();
          ctx.arc(ax, ay, cellSize * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,50,50,${Math.max(0, innerAlpha).toFixed(2)})`;
          ctx.fill();
        }

        const agentGlow = ctx.createRadialGradient(ax, ay, 0, ax, ay, cellSize * 0.55);
        agentGlow.addColorStop(0, agent.glowColor);
        agentGlow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.arc(ax, ay, cellSize * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = agentGlow;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ax, ay, cellSize * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = agent.color;
        ctx.fill();

        // Shield indicator: cyan bubble
        if (agent.shieldTurns > 0) {
          const shieldPulse = Math.sin(now / 250) * 0.15 + 0.5;
          ctx.beginPath();
          ctx.arc(ax, ay, cellSize * 0.45, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0,221,255,${shieldPulse.toFixed(2)})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        // Speed indicator: yellow spark trails
        if (agent.speedTurns > 0) {
          for (let s = 0; s < 3; s++) {
            const sAngle = (now / 200 + s * Math.PI * 0.67) % (Math.PI * 2);
            const sx = ax + Math.cos(sAngle) * cellSize * 0.4;
            const sy = ay + Math.sin(sAngle) * cellSize * 0.4;
            ctx.beginPath();
            ctx.arc(sx, sy, 2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffdd00';
            ctx.fill();
          }
        }

        if (state === 'racing' && !agent.finished && processingRef.current) {
          const spinAngle = (now / 600 + agent.id * 1.5) % (Math.PI * 2);
          ctx.beginPath();
          ctx.arc(ax, ay, cellSize * 0.38, spinAngle, spinAngle + Math.PI * 1.2);
          ctx.strokeStyle = agent.color + '88';
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }

      // ── Floating power-up notifications ──
      const notifs = notificationsRef.current;
      for (let ni = notifs.length - 1; ni >= 0; ni--) {
        const n = notifs[ni];
        const age = (now - n.time) / 1000; // seconds
        if (age > 2) { notifs.splice(ni, 1); continue; }
        const alpha = Math.max(0, 1 - age / 2);
        const rise = age * 30;
        const nx = ox + n.pos.col * cellSize + cellSize / 2;
        const ny = oy + n.pos.row * cellSize - rise;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = n.color;
        ctx.fillText(n.text, nx, ny);
        ctx.restore();
      }

      // ── First-Person POV viewports ──
      if (showPov && (state === 'racing' || state === 'finished')) {
        const povX = mazeAreaW + 5;
        const povGap = 6;
        const povH = Math.floor((h - 60 - povGap * 3) / 4);
        const povW = POV_PANEL_W - 10;
        const FPV_DEPTH = 8;

        // Wall mapping: for a given facing, which cell wall is left/right/forward
        const WALL_MAP: Record<Direction, { left: keyof Cell['walls']; right: keyof Cell['walls']; forward: keyof Cell['walls'] }> = {
          up:    { left: 'left',   right: 'right',  forward: 'top' },
          down:  { left: 'right',  right: 'left',   forward: 'bottom' },
          left:  { left: 'bottom', right: 'top',    forward: 'left' },
          right: { left: 'top',    right: 'bottom', forward: 'right' },
        };
        const FWD_VEC: Record<Direction, { dr: number; dc: number }> = {
          up: { dr: -1, dc: 0 }, down: { dr: 1, dc: 0 },
          left: { dr: 0, dc: -1 }, right: { dr: 0, dc: 1 },
        };
        const LEFT_VEC: Record<Direction, { dr: number; dc: number }> = {
          up: { dr: 0, dc: -1 }, down: { dr: 0, dc: 1 },
          left: { dr: 1, dc: 0 }, right: { dr: -1, dc: 0 },
        };
        const RIGHT_VEC: Record<Direction, { dr: number; dc: number }> = {
          up: { dr: 0, dc: 1 }, down: { dr: 0, dc: -1 },
          left: { dr: -1, dc: 0 }, right: { dr: 1, dc: 0 },
        };

        for (let ai = 0; ai < agents.length; ai++) {
          const agent = agents[ai];
          const vpY = 50 + ai * (povH + povGap);
          const facing: Direction = agent.history.length > 0
            ? agent.history[agent.history.length - 1]
            : (agent.startPos.row === 0 ? 'down' : 'up');
          const wm = WALL_MAP[facing];
          const fv = FWD_VEC[facing];
          const lv = LEFT_VEC[facing];
          const rv = RIGHT_VEC[facing];

          // Viewport background
          ctx.save();
          ctx.beginPath();
          ctx.rect(povX, vpY, povW, povH);
          ctx.clip();

          // Perspective helpers
          const cx = povX + povW / 2;
          const cy = vpY + povH / 2;
          const hw = povW / 2;
          const hh = povH / 2;

          function pScale(d: number): number { return 1 / (d * 0.65 + 1); }
          function sRect(d: number) {
            const s = pScale(d);
            return { lx: cx - hw * s, rx: cx + hw * s, ty: cy - hh * s, by: cy + hh * s };
          }

          // Sky gradient
          const sky = ctx.createLinearGradient(povX, vpY, povX, cy);
          sky.addColorStop(0, '#060612');
          sky.addColorStop(1, '#0e0e22');
          ctx.fillStyle = sky;
          ctx.fillRect(povX, vpY, povW, povH / 2);

          // Floor gradient — tinted with agent color
          const floor = ctx.createLinearGradient(povX, cy, povX, vpY + povH);
          floor.addColorStop(0, '#121210');
          floor.addColorStop(1, '#080808');
          ctx.fillStyle = floor;
          ctx.fillRect(povX, cy, povW, povH / 2);

          // Walk forward through corridor
          let hitEnd = false;
          for (let d = 0; d < FPV_DEPTH && !hitEnd; d++) {
            const cr = agent.position.row + fv.dr * d;
            const cc = agent.position.col + fv.dc * d;

            if (cr < 0 || cr >= MAZE_SIZE || cc < 0 || cc >= MAZE_SIZE) {
              hitEnd = true;
              break;
            }

            const cell = maze[cr][cc];
            const r0 = sRect(d);
            const r1 = sRect(d + 1);
            const brightness = Math.max(0.12, 1 - d * 0.11);

            // Left wall
            if (cell.walls[wm.left]) {
              const shade = Math.floor(40 * brightness);
              ctx.fillStyle = `rgb(${shade},${shade},${Math.floor(shade * 1.4)})`;
              ctx.beginPath();
              ctx.moveTo(r0.lx, r0.ty); ctx.lineTo(r1.lx, r1.ty);
              ctx.lineTo(r1.lx, r1.by); ctx.lineTo(r0.lx, r0.by);
              ctx.closePath(); ctx.fill();
            } else if (d > 0) {
              // Side opening — draw recessed wall edges
              const shade = Math.floor(20 * brightness);
              ctx.fillStyle = `rgb(${shade},${shade},${Math.floor(shade * 1.2)})`;
              // Back edge of opening
              const rPrev = sRect(d - 1);
              ctx.beginPath();
              ctx.moveTo(r0.lx, r0.ty); ctx.lineTo(r0.lx, r0.by);
              ctx.lineTo(rPrev.lx, rPrev.by); ctx.lineTo(rPrev.lx, rPrev.ty);
              ctx.closePath(); ctx.fill();
            }

            // Right wall
            if (cell.walls[wm.right]) {
              const shade = Math.floor(35 * brightness);
              ctx.fillStyle = `rgb(${shade},${shade},${Math.floor(shade * 1.3)})`;
              ctx.beginPath();
              ctx.moveTo(r0.rx, r0.ty); ctx.lineTo(r1.rx, r1.ty);
              ctx.lineTo(r1.rx, r1.by); ctx.lineTo(r0.rx, r0.by);
              ctx.closePath(); ctx.fill();
            } else if (d > 0) {
              const shade = Math.floor(20 * brightness);
              ctx.fillStyle = `rgb(${shade},${shade},${Math.floor(shade * 1.2)})`;
              const rPrev = sRect(d - 1);
              ctx.beginPath();
              ctx.moveTo(r0.rx, r0.ty); ctx.lineTo(r0.rx, r0.by);
              ctx.lineTo(rPrev.rx, rPrev.by); ctx.lineTo(rPrev.rx, rPrev.ty);
              ctx.closePath(); ctx.fill();
            }

            // Ceiling segment
            const ceilShade = Math.floor(18 * brightness);
            ctx.fillStyle = `rgb(${ceilShade},${ceilShade},${Math.floor(ceilShade * 1.1)})`;
            ctx.beginPath();
            ctx.moveTo(r0.lx, r0.ty); ctx.lineTo(r1.lx, r1.ty);
            ctx.lineTo(r1.rx, r1.ty); ctx.lineTo(r0.rx, r0.ty);
            ctx.closePath(); ctx.fill();

            // Floor segment
            const floorShade = Math.floor(14 * brightness);
            ctx.fillStyle = `rgb(${floorShade},${Math.floor(floorShade * 1.1)},${floorShade})`;
            ctx.beginPath();
            ctx.moveTo(r0.lx, r0.by); ctx.lineTo(r1.lx, r1.by);
            ctx.lineTo(r1.rx, r1.by); ctx.lineTo(r0.rx, r0.by);
            ctx.closePath(); ctx.fill();

            // Draw entities at this depth
            const entityR = sRect(d + 0.5);
            const entitySize = (entityR.by - entityR.ty) * 0.35;

            // Check for enemies at this cell
            for (const enemy of enemies) {
              if (enemy.position.row === cr && enemy.position.col === cc) {
                const eColor = ENEMY_COLORS[enemy.type];
                const ecx = (entityR.lx + entityR.rx) / 2;
                const ecy = (entityR.ty + entityR.by) / 2;
                const ePulse = Math.sin(now / 300 + enemy.id) * 0.2 + 0.8;
                // Glowing enemy circle
                const eGrad = ctx.createRadialGradient(ecx, ecy, 0, ecx, ecy, entitySize * ePulse);
                eGrad.addColorStop(0, eColor);
                eGrad.addColorStop(1, eColor + '00');
                ctx.beginPath();
                ctx.arc(ecx, ecy, entitySize * ePulse, 0, Math.PI * 2);
                ctx.fillStyle = eGrad;
                ctx.fill();
                ctx.beginPath();
                ctx.arc(ecx, ecy, entitySize * 0.4, 0, Math.PI * 2);
                ctx.fillStyle = eColor;
                ctx.fill();
              }
              // Also check left/right side corridors for enemies
              const leftR = cr + lv.dr;
              const leftC = cc + lv.dc;
              if (enemy.position.row === leftR && enemy.position.col === leftC && !cell.walls[wm.left]) {
                ctx.beginPath();
                ctx.arc(entityR.lx + entitySize * 0.3, (entityR.ty + entityR.by) / 2, entitySize * 0.25, 0, Math.PI * 2);
                ctx.fillStyle = ENEMY_COLORS[enemy.type] + 'aa';
                ctx.fill();
              }
              const rightR = cr + rv.dr;
              const rightC = cc + rv.dc;
              if (enemy.position.row === rightR && enemy.position.col === rightC && !cell.walls[wm.right]) {
                ctx.beginPath();
                ctx.arc(entityR.rx - entitySize * 0.3, (entityR.ty + entityR.by) / 2, entitySize * 0.25, 0, Math.PI * 2);
                ctx.fillStyle = ENEMY_COLORS[enemy.type] + 'aa';
                ctx.fill();
              }
            }

            // Check for other agents at this cell
            for (const other of agents) {
              if (other.id === agent.id || other.finished) continue;
              if (other.position.row === cr && other.position.col === cc) {
                const ocx = (entityR.lx + entityR.rx) / 2;
                const ocy = (entityR.ty + entityR.by) / 2;
                ctx.beginPath();
                ctx.arc(ocx, ocy, entitySize * 0.3, 0, Math.PI * 2);
                ctx.fillStyle = other.color;
                ctx.fill();
              }
            }

            // Goal at this cell
            if (cr === CENTER && cc === CENTER) {
              const gcx = (entityR.lx + entityR.rx) / 2;
              const gcy = (entityR.ty + entityR.by) / 2;
              const gPulse = Math.sin(now / 250) * 0.3 + 0.7;
              ctx.beginPath();
              ctx.arc(gcx, gcy, entitySize * 0.5 * gPulse, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(255,255,255,${gPulse.toFixed(2)})`;
              ctx.fill();
            }

            // Forward wall (end of corridor)
            if (cell.walls[wm.forward]) {
              const shade = Math.floor(28 * brightness);
              ctx.fillStyle = `rgb(${shade},${shade},${Math.floor(shade * 1.2)})`;
              ctx.fillRect(r1.lx, r1.ty, r1.rx - r1.lx, r1.by - r1.ty);
              hitEnd = true;
            }
          }

          ctx.restore(); // unclip

          // Viewport border
          ctx.strokeStyle = agent.color + '66';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(povX, vpY, povW, povH);

          // Agent name + status label
          ctx.fillStyle = agent.color;
          ctx.font = 'bold 10px "Courier New", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(agent.name, povX + 3, vpY + 2);

          // Distance to goal
          const dist = manhattan(agent.position, { row: CENTER, col: CENTER });
          ctx.fillStyle = '#666';
          ctx.font = '9px "Courier New", monospace';
          ctx.textAlign = 'right';
          ctx.fillText(`d:${dist}`, povX + povW - 3, vpY + 2);

          // Status badges
          if (agent.shieldTurns > 0) {
            ctx.fillStyle = '#00ddff';
            ctx.font = 'bold 9px "Courier New", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`SHIELD ${agent.shieldTurns}`, povX + 3, vpY + povH - 12);
          }
          if (agent.speedTurns > 0) {
            ctx.fillStyle = '#ffdd00';
            ctx.font = 'bold 9px "Courier New", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`SPEED ${agent.speedTurns}`, povX + 3, vpY + povH - 12);
          }
          if (agent.finished) {
            ctx.fillStyle = agent.finishOrder === 1 ? '#44ff66' : '#888';
            ctx.font = 'bold 10px "Courier New", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(agent.finishOrder === 1 ? 'WINNER!' : `#${agent.finishOrder}`, povX + povW / 2, vpY + povH / 2 - 5);
          }
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

      // ── HUD: Your pick indicator ──
      if (state === 'racing' && pickedWinnerRef.current !== null) {
        const pickCfg = AGENT_CONFIGS[pickedWinnerRef.current];
        ctx.font = '12px "Courier New", monospace';
        ctx.fillStyle = pickCfg.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`Your pick: ${pickCfg.name}`, 16, 12);
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
        const respawnAge = turn - a.respawnTurn;
        if (a.finished) {
          ctx.fillStyle = a.finishOrder === 1 ? a.color : '#555';
          ctx.fillText(a.finishOrder === 1 ? 'WINNER' : `#${a.finishOrder}`, sx + 22, barY);
        } else if (respawnAge >= 0 && respawnAge < 3) {
          ctx.fillStyle = '#ff3333';
          ctx.fillText('RESPAWN!', sx + 22, barY);
        } else if (a.shieldTurns > 0) {
          ctx.fillStyle = '#00ddff';
          ctx.fillText(`SHIELD(${a.shieldTurns})`, sx + 22, barY);
        } else if (a.speedTurns > 0) {
          ctx.fillStyle = '#ffdd00';
          ctx.fillText(`SPEED(${a.speedTurns})`, sx + 22, barY);
        } else {
          ctx.fillStyle = '#666';
          ctx.fillText(`${a.history.length} moves`, sx + 22, barY);
        }
      }

      // ── Finished overlay ──
      ctx.textBaseline = 'alphabetic';

      if (state === 'finished' && winner) {
        ctx.fillStyle = 'rgba(8,8,14,0.85)';
        ctx.fillRect(0, 0, w, h);

        ctx.textAlign = 'center';

        // Winner announcement
        ctx.save();
        ctx.shadowColor = winner.color;
        ctx.shadowBlur = 30;
        ctx.fillStyle = winner.color;
        ctx.font = 'bold 52px "Courier New", monospace';
        ctx.fillText(`${winner.name} WINS!`, w / 2, h / 2 - 50);
        ctx.restore();

        ctx.fillStyle = '#aaa';
        ctx.font = '18px "Courier New", monospace';
        ctx.fillText(
          `Reached the center in ${winner.history.length} moves (${turn} turns)`,
          w / 2,
          h / 2 - 10
        );

        // Did the user's pick win?
        if (pickedWinnerRef.current !== null) {
          const pickedCfg = AGENT_CONFIGS[pickedWinnerRef.current];
          const correct = pickedWinnerRef.current === winner.id;
          ctx.font = 'bold 18px "Courier New", monospace';
          if (correct) {
            ctx.fillStyle = '#44ff66';
            ctx.fillText('YOU CALLED IT! Great prediction!', w / 2, h / 2 + 20);
          } else {
            ctx.fillStyle = '#ff6644';
            ctx.fillText(`You picked ${pickedCfg.name} — better luck next time!`, w / 2, h / 2 + 20);
          }
        }

        const finishedAgents = [...agents]
          .filter((a) => a.finished)
          .sort((a, b) => (a.finishOrder || 99) - (b.finishOrder || 99));
        const unfinished = agents.filter((a) => !a.finished);

        let ry = h / 2 + 60;
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
        ctx.fillText('[ CLICK FOR NEW RACE ]', w / 2, ry + 25);
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

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      style={{ display: 'block', cursor: 'pointer' }}
    />
  );
}
