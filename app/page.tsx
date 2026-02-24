'use client';

import { useEffect, useRef } from 'react';
import { Cell, Position, Direction, AgentConfig, Enemy, EnemyType } from '@/lib/types';
import { generateMaze, getAvailableMoves, applyMove } from '@/lib/maze';

// ─── Constants ─────────────────────────────────────────────

const MAZE_SIZE = 25;
const CENTER = Math.floor(MAZE_SIZE / 2); // 12
const ANIM_DURATION = 224; // ~30% faster than 320ms
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
    sprite: '/char-red.png',
  },
  {
    id: 1,
    name: 'Frost',
    color: '#4499ff',
    glowColor: 'rgba(68,153,255,0.5)',
    personality:
      'You are calm and calculated. Pick fresh paths over visited ones. Move toward the goal when you can.',
    startPos: { row: 0, col: MAZE_SIZE - 1 },
    sprite: '/char-blue.png',
  },
  {
    id: 2,
    name: 'Venom',
    color: '#44ff66',
    glowColor: 'rgba(68,255,102,0.5)',
    personality:
      'You are sharp and tenacious. Pick fresh paths over visited ones. Move toward the goal when you can.',
    startPos: { row: MAZE_SIZE - 1, col: 0 },
    sprite: '/char-green.png',
  },
  {
    id: 3,
    name: 'Sol',
    color: '#ffcc00',
    glowColor: 'rgba(255,204,0,0.5)',
    personality:
      'You are quick and instinctive. Pick fresh paths over visited ones. Move toward the goal when you can.',
    sprite: '/char-yellow.png',
    startPos: { row: MAZE_SIZE - 1, col: MAZE_SIZE - 1 },
  },
];

// ─── Enemy config ─────────────────────────────────────────

const ENEMY_TYPES: { type: EnemyType; color: string; label: string }[] = [
  { type: 'ghost', color: '#aa44ff', label: '\u{1F47B} Ghost' },
  { type: 'freezer', color: '#44ffff', label: '\u{1F976} Freezer' },
  { type: 'scrambler', color: '#ff8800', label: '\u{1F479} Scrambler' },
  { type: 'thief', color: '#aa2222', label: '\u{1F9B9} Thief' },
];

const ENEMY_COLORS: Record<EnemyType, string> = {
  ghost: '#aa44ff',
  freezer: '#44ffff',
  scrambler: '#ff8800',
  thief: '#aa2222',
};

const ENEMY_EMOJIS: Record<EnemyType, string> = {
  ghost: '\u{1F47B}',    // 👻
  freezer: '\u{1F976}',  // 🥶
  scrambler: '\u{1F479}', // 👹
  thief: '\u{1F9B9}',    // 🦹
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
  deathPos: Position | null; // where agent was eaten (for flash effect)
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
      deathPos: null,
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
    recentPositions: [],
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

    // Cycle detection: if current cell appeared 2+ times in last 8 moves, force new direction
    const curKey = posKey(enemy.position);
    const recentHits = enemy.recentPositions.slice(-8).filter((k) => k === curKey).length;
    const enemyCycling = recentHits >= 2;

    let dir: Direction;
    if (chaseDir && !enemyCycling) {
      // LOS chase — lock on and pursue (skip if cycling to break pattern)
      dir = chaseDir;
    } else if (!enemyCycling && enemy.lastDirection && available.includes(enemy.lastDirection) && Math.random() < 0.7) {
      dir = enemy.lastDirection;
    } else {
      // When cycling, avoid both reverse AND current direction to force exploration
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
    enemy.recentPositions.push(posKey(eNewPos));
    if (enemy.recentPositions.length > 12) enemy.recentPositions.shift();
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
  const gameLoopActiveRef = useRef(false);
  const moveTimeRef = useRef(0);

  // Floating notifications for power-up pickups
  const notificationsRef = useRef<{ text: string; color: string; agentColor: string; time: number; pos: Position }[]>([]);

  // Splash / pick-your-winner state
  const mouseRef = useRef({ x: 0, y: 0 });
  const pickedWinnerRef = useRef<number | null>(null); // agent id
  const particlesRef = useRef<Particle[]>(createParticles(60));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackIndexRef = useRef(0);
  const TRACKS = ['/music.mp3', '/music2.mp3'];
  const mutedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Preloaded character sprite images (keyed by agent id)
  const spritesRef = useRef<Record<number, HTMLImageElement>>({});
  if (typeof window !== 'undefined' && Object.keys(spritesRef.current).length === 0) {
    for (const cfg of AGENT_CONFIGS) {
      if (cfg.sprite) {
        const img = new Image();
        img.src = cfg.sprite;
        spritesRef.current[cfg.id] = img;
      }
    }
  }

  // ─── Global win counter ────────────────────────────────────

  const globalWinsRef = useRef<Record<string, number>>({});
  const winsFetchedRef = useRef(false);

  function fetchGlobalWins() {
    fetch('/api/wins').then((r) => r.json()).then((data) => {
      globalWinsRef.current = data;
    }).catch(() => {});
  }

  function reportWin(winnerName: string) {
    fetch('/api/wins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner: winnerName }),
    }).then((r) => r.json()).then((data) => {
      // Merge the incremented count
      Object.assign(globalWinsRef.current, data);
    }).catch(() => {});
  }

  // ─── Sound effects ─────────────────────────────────────────

  function playSfx(src: string) {
    if (mutedRef.current) return;
    const sfx = new Audio(src);
    sfx.volume = 0.6;
    sfx.play().catch(() => {});
  }

  // ─── Mute toggle ───────────────────────────────────────────

  function getMuteButtonBounds() {
    const size = 36;
    return { x: window.innerWidth - size - 8, y: 4, w: size, h: size };
  }

  function toggleMute() {
    mutedRef.current = !mutedRef.current;
    if (audioRef.current) {
      audioRef.current.muted = mutedRef.current;
    }
  }

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
            // Shield blocks the hit
          } else {
            respawnAgent(agent, currentTurn);
          }
          // Respawn enemy at the center (exit) so it can't camp the spawn
          enemy.position = { row: CENTER, col: CENTER };
          enemy.prevPosition = { row: CENTER, col: CENTER };
          enemy.lastDirection = null;
          enemy.recentPositions = [];
        }
      }
    }
  }

  function respawnAgent(agent: AnimAgent, currentTurn: number) {
    playSfx('/sfx-death.mp3');
    agent.deathPos = { ...agent.position }; // store where they died for flash
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
      playSfx('/sfx-powerup.mp3');
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

  function computeMoves(): { agentId: number; direction: Direction }[] {
    const maze = mazeRef.current;
    const agents = agentsRef.current;
    const enemies = enemiesRef.current;
    const goal: Position = { row: CENTER, col: CENTER };

    const active = agents.filter((a) => !a.finished && a.frozenTurns <= 0);
    if (active.length === 0) return [];

    return active.map((agent) => {
      const directions = getAvailableMoves(maze, agent.position);
      const lastMove = agent.history.length > 0 ? agent.history[agent.history.length - 1] : null;

      const options = directions.map((dir) => {
        let target = applyMove(agent.position, dir);
        const wrapped = checkWrap(target, dir);
        if (wrapped) target = wrapped;
        const key = posKey(target);
        return {
          direction: dir,
          distanceToGoal: manhattan(target, goal),
          timesVisited: agent.visited[key] || 0,
          isReverse: lastMove !== null && dir === OPPOSITE[lastMove],
          hasEnemy: enemies.some((e) => samePos(e.position, target)),
        };
      });

      // Cycle detection: check if agent is revisiting recent positions
      const recentTrail = agent.trail.slice(-10);
      const currentKey = posKey(agent.position);
      const recentVisits = recentTrail.filter((p) => posKey(p) === currentKey).length;
      const isCycling = recentVisits >= 2;

      // Sort: avoid enemies > unvisited > least visited > closest to goal
      // When cycling, ignore distance tiebreaker and go fully random
      const sorted = [...options].sort((a, b) => {
        if (a.hasEnemy !== b.hasEnemy) return a.hasEnemy ? 1 : -1;
        if (a.isReverse !== b.isReverse) return a.isReverse ? 1 : -1;
        if (a.timesVisited !== b.timesVisited) return a.timesVisited - b.timesVisited;
        if (isCycling) return 0; // random among same-visit-count when cycling
        return a.distanceToGoal - b.distanceToGoal;
      });

      // Random among tied-best options
      const best = sorted[0];
      const tied = sorted.filter(
        (o) =>
          o.hasEnemy === best.hasEnemy &&
          o.isReverse === best.isReverse &&
          o.timesVisited === best.timesVisited &&
          (isCycling || o.distanceToGoal === best.distanceToGoal)
      );
      const pick = tied[Math.floor(Math.random() * tied.length)];
      return { agentId: agent.id, direction: pick.direction };
    });
  }

  function applyMoves(results: { agentId: number; direction: Direction }[]) {
    const maze = mazeRef.current;
    const agents = agentsRef.current;
    const enemies = enemiesRef.current;

    // Decrement frozen/scrambled timers
    for (const agent of agents) {
      if (agent.frozenTurns > 0) agent.frozenTurns--;
    }

    // Set prevPosition for animation lerp
    for (const agent of agents.filter((a) => !a.finished)) {
      agent.prevPosition = { ...agent.position };
    }
    for (const enemy of enemies) {
      enemy.prevPosition = { ...enemy.position };
    }

    let finishCount = agents.filter((a) => a.finished).length;

    for (const move of results) {
      const agent = agents.find((a) => a.id === move.agentId);
      if (!agent || agent.finished) continue;

      const available = getAvailableMoves(maze, agent.position);
      if (available.includes(move.direction)) {
        let newPos = applyMove(agent.position, move.direction);
        const wrapped = checkWrap(newPos, move.direction);
        if (wrapped) { newPos = wrapped; playSfx('/sfx-teleport.mp3'); }
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
            playSfx('/sfx-winner.mp3');
            reportWin(agent.name);
            winnerRef.current = agent;
            stateRef.current = 'finished';
            gameLoopActiveRef.current = false;
          }
        }
      }
    }

    // Check power-up collection
    for (const move of results) {
      const agent = agents.find((a) => a.id === move.agentId);
      if (agent && !agent.finished) {
        checkPowerUpCollection(agent, maze);
      }
    }

    // Speed boost: bonus move for agents with speed
    for (const agent of agents) {
      if (agent.finished || agent.speedTurns <= 0) continue;

      const dirs = getAvailableMoves(maze, agent.position);
      const lastMove = agent.history.length > 0 ? agent.history[agent.history.length - 1] : null;
      const goal: Position = { row: CENTER, col: CENTER };

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
        let bonusPos = applyMove(agent.position, options[0].dir);
        const bw = checkWrap(bonusPos, options[0].dir);
        if (bw) { bonusPos = bw; playSfx('/sfx-teleport.mp3'); }
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
            playSfx('/sfx-winner.mp3');
            reportWin(agent.name);
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

    respawnCollectedPowerUps();
    moveEnemies(enemies, maze, agents);
    checkEnemyCollisions();

    // Periodic shuffle
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
  }

  function startRace() {
    stateRef.current = 'racing';
    moveTimeRef.current = performance.now();
    gameLoopActiveRef.current = true;

    // Set up Web Audio analyser for equalizer visualization
    if (!audioCtxRef.current) {
      const actx = new AudioContext();
      const analyser = actx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;
      audioCtxRef.current = actx;
      analyserRef.current = analyser;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    }

    // Start music — rotate between tracks with analyser connected
    function playTrack() {
      const src = TRACKS[trackIndexRef.current % TRACKS.length];
      const audio = new Audio(src);
      audio.crossOrigin = 'anonymous';
      audio.volume = 0.5;
      audio.muted = mutedRef.current;
      audio.addEventListener('ended', () => {
        trackIndexRef.current++;
        if (stateRef.current === 'racing') playTrack();
      });
      // Connect to analyser
      if (audioCtxRef.current && analyserRef.current) {
        const source = audioCtxRef.current.createMediaElementSource(audio);
        source.connect(analyserRef.current);
        analyserRef.current.connect(audioCtxRef.current.destination);
      }
      audioRef.current = audio;
      audio.play().catch(() => {});
    }
    if (audioRef.current) { audioRef.current.pause(); }
    trackIndexRef.current = Math.random() < 0.5 ? 0 : 1;
    playTrack();

    // Continuous game loop — local pathfinding, no API delay
    (async () => {
      while (gameLoopActiveRef.current) {
        const results = computeMoves();
        applyMoves(results);
        await new Promise((r) => setTimeout(r, ANIM_DURATION));
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
    moveTimeRef.current = 0;
    pickedWinnerRef.current = null;
    notificationsRef.current = [];
    stateRef.current = 'ready';
    fetchGlobalWins(); // refresh win counts

    // Stop music
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }

  // ─── Click handling with agent picking ────────────────────

  function getAgentCardBounds(w: number, h: number) {
    const mob = w < 600;
    const cardW = mob ? 130 : 180;
    const cardH = mob ? 130 : 170;
    const gap = mob ? 10 : 24;

    if (mob) {
      // 2×2 grid layout centered vertically
      const cols = 2;
      const totalW = cols * cardW + (cols - 1) * gap;
      const startX = (w - totalW) / 2;
      const startY = h * 0.24;
      return AGENT_CONFIGS.map((_, i) => ({
        x: startX + (i % cols) * (cardW + gap),
        y: startY + Math.floor(i / cols) * (cardH + gap),
        w: cardW,
        h: cardH,
      }));
    }

    // Desktop: single row
    const totalW = AGENT_CONFIGS.length * cardW + (AGENT_CONFIGS.length - 1) * gap;
    const startX = (w - totalW) / 2;
    const cardY = h * 0.3;
    return AGENT_CONFIGS.map((_, i) => ({
      x: startX + i * (cardW + gap),
      y: cardY,
      w: cardW,
      h: cardH,
    }));
  }

  function handleInteraction(mx: number, my: number, isClick: boolean) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Always update mouse position
    mouseRef.current = { x: mx, y: my };

    if (!isClick) return;

    // Check mute button (always active)
    const mb = getMuteButtonBounds();
    if (mx >= mb.x && mx <= mb.x + mb.w && my >= mb.y && my <= mb.y + mb.h) {
      toggleMute();
      return;
    }

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
        const btnY = h * 0.72;
        if (my >= btnY - 25 && my <= btnY + 25) {
          startRace();
        }
      }
    } else if (stateRef.current === 'finished') {
      newGame();
    }
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    handleInteraction(e.clientX - rect.left, e.clientY - rect.top, true);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    handleInteraction(e.clientX - rect.left, e.clientY - rect.top, false);
  }

  // Touch handlers — registered via useEffect with { passive: false } to allow preventDefault
  const handleTouchStartRef = useRef((e: TouchEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const touch = e.touches[0];
    handleInteraction(touch.clientX - rect.left, touch.clientY - rect.top, true);
  });

  const handleTouchMoveRef = useRef((e: TouchEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const touch = e.touches[0];
    handleInteraction(touch.clientX - rect.left, touch.clientY - rect.top, false);
  });

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

    // Register touch listeners as non-passive so preventDefault works
    canvas.addEventListener('touchstart', handleTouchStartRef.current, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMoveRef.current, { passive: false });

    let running = true;

    // Fetch global wins on first load
    if (!winsFetchedRef.current) {
      winsFetchedRef.current = true;
      fetchGlobalWins();
    }

    // ─── Enemy shape drawing helpers ──────────────────────

    function drawEmoji(emoji: string, cx: number, cy: number, size: number) {
      ctx.font = `${size}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, cx, cy);
    }

    // ─── Draw splash screen (fully opaque) ───────────────

    function drawSplash(w: number, h: number, now: number) {
      const mob = w < 600;

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

      // Title with glow — responsive sizing
      const titleFontSize = mob ? 28 : 52;
      const titleY = mob ? h * 0.05 : h * 0.1;
      ctx.save();
      ctx.shadowColor = '#4499ff';
      ctx.shadowBlur = mob ? 18 : 30;
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${titleFontSize}px "Courier New", monospace`;
      ctx.fillText('MAZE RACE', w / 2, titleY);
      ctx.restore();

      // Decorative line
      const lineW = mob ? w * 0.6 : 300;
      const lineGrad = ctx.createLinearGradient(w / 2 - lineW / 2, 0, w / 2 + lineW / 2, 0);
      lineGrad.addColorStop(0, 'rgba(68,153,255,0)');
      lineGrad.addColorStop(0.5, 'rgba(68,153,255,0.6)');
      lineGrad.addColorStop(1, 'rgba(68,153,255,0)');
      ctx.fillStyle = lineGrad;
      ctx.fillRect(w / 2 - lineW / 2, titleY + (mob ? 10 : 18), lineW, 1.5);

      // Subtitle — shorter on mobile
      ctx.fillStyle = '#6688aa';
      if (mob) {
        ctx.font = '10px "Courier New", monospace';
        ctx.fillText('4 bots // dodge enemies // reach the center', w / 2, titleY + 26);
      } else {
        ctx.font = '15px "Courier New", monospace';
        ctx.fillText('4 pathfinding bots  //  dodge enemies  //  grab power-ups  //  reach the center', w / 2, titleY + 48);
      }

      // "WHO WILL WIN?" prompt
      const promptY = mob ? h * 0.15 : h * 0.22;
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${mob ? 15 : 20}px "Courier New", monospace`;
      ctx.fillText('WHO WILL WIN?', w / 2, promptY);

      ctx.fillStyle = '#556677';
      ctx.font = `${mob ? 10 : 13}px "Courier New", monospace`;
      ctx.fillText('Pick your champion', w / 2, promptY + (mob ? 16 : 22));

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

        // Agent avatar (sprite or dot fallback)
        const avatarX = b.x + b.w / 2;
        const avatarY = b.y + b.h * 0.42;
        const spriteImg = spritesRef.current[cfg.id];
        const avatarSize = mob ? 80 : 120;
        const avatarPulse = isSelected ? 1 + Math.sin(now / 300) * 0.08 : 1;

        if (isSelected) {
          const glow = ctx.createRadialGradient(avatarX, avatarY, 0, avatarX, avatarY, avatarSize * 0.6);
          glow.addColorStop(0, cfg.glowColor);
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath();
          ctx.arc(avatarX, avatarY, avatarSize * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
          const drawSize = avatarSize * avatarPulse;
          ctx.drawImage(spriteImg, avatarX - drawSize / 2, avatarY - drawSize / 2, drawSize, drawSize);
        } else {
          // Fallback dot for agents without sprites
          const dotR = mob ? 14 : 20;
          const dotPulse = isSelected ? Math.sin(now / 300) * 3 + dotR + 3 : dotR;
          ctx.beginPath();
          ctx.arc(avatarX, avatarY, dotPulse, 0, Math.PI * 2);
          ctx.fillStyle = cfg.color;
          ctx.fill();
        }

        // Agent name
        ctx.fillStyle = isSelected ? cfg.color : '#aaaaaa';
        ctx.font = `${isSelected ? 'bold ' : ''}${mob ? 13 : 16}px "Courier New", monospace`;
        ctx.fillText(cfg.name, avatarX, b.y + b.h - (mob ? 22 : 30));

        // Global win count
        const wins = globalWinsRef.current[cfg.name.toLowerCase()] || 0;
        ctx.fillStyle = isSelected ? '#ffffff' : '#666666';
        ctx.font = `${mob ? 10 : 12}px "Courier New", monospace`;
        ctx.fillText(`${wins} win${wins !== 1 ? 's' : ''}`, avatarX, b.y + b.h - (mob ? 8 : 12));
      }

      // Start button (only if picked)
      if (picked !== null) {
        const btnY = h * 0.72;
        const btnPulse = Math.sin(now / 400) * 0.15 + 0.85;
        const pickedCfg = AGENT_CONFIGS[picked];

        ctx.save();
        ctx.shadowColor = pickedCfg.color;
        ctx.shadowBlur = 15;
        ctx.fillStyle = pickedCfg.color + Math.floor(btnPulse * 255).toString(16).padStart(2, '0');
        ctx.font = `bold ${mob ? 18 : 20}px "Courier New", monospace`;
        ctx.fillText(`[ START RACE ]`, w / 2, btnY);
        ctx.restore();

        ctx.fillStyle = '#556677';
        ctx.font = `${mob ? 10 : 12}px "Courier New", monospace`;
        ctx.fillText(`Your pick: ${pickedCfg.name}`, w / 2, btnY + (mob ? 22 : 28));
      }
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

      // ── Maze dimensions — responsive padding ──
      const isMobile = w < 600;
      const padding = isMobile ? 16 : 60;
      const topReserve = isMobile ? 40 : 55;
      const bottomReserve = isMobile ? 55 : 65;
      const availW = mazeAreaW - padding * 2;
      const availH = h - topReserve - bottomReserve;
      const cellSize = Math.floor(Math.min(availW / MAZE_SIZE, availH / MAZE_SIZE));
      const mazeW = cellSize * MAZE_SIZE;
      const mazeH = cellSize * MAZE_SIZE;
      const ox = Math.floor((mazeAreaW - mazeW) / 2);
      const oy = topReserve + Math.floor((availH - mazeH) / 2);

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

        // Outer glow — large, soft
        const outerR = cellSize * 1.2 * puPulse;
        const outerGrad = ctx.createRadialGradient(px, py, 0, px, py, outerR);
        outerGrad.addColorStop(0, puColor + '44');
        outerGrad.addColorStop(0.5, puColor + '18');
        outerGrad.addColorStop(1, puColor + '00');
        ctx.beginPath();
        ctx.arc(px, py, outerR, 0, Math.PI * 2);
        ctx.fillStyle = outerGrad;
        ctx.fill();

        // Inner glow — bright core
        const innerR = cellSize * 0.55;
        const innerGrad = ctx.createRadialGradient(px, py, 0, px, py, innerR);
        innerGrad.addColorStop(0, '#ffffff88');
        innerGrad.addColorStop(0.3, puColor + '99');
        innerGrad.addColorStop(1, puColor + '00');
        ctx.beginPath();
        ctx.arc(px, py, innerR, 0, Math.PI * 2);
        ctx.fillStyle = innerGrad;
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

      // ── Pass 1: Agent trails (fade after ~15s) ──
      const TRAIL_LIFESPAN = Math.round(15000 / ANIM_DURATION); // ~67 steps
      for (const agent of agents) {
        if (agent.trail.length < 2) continue;
        ctx.lineWidth = cellSize * 0.15;
        ctx.lineCap = 'round';

        const len = agent.trail.length;
        // Draw trail in segments with fading alpha
        for (let i = 1; i < len; i++) {
          const age = len - 1 - i; // 0 = newest, len-2 = oldest
          if (age >= TRAIL_LIFESPAN) continue; // fully faded, skip
          const fade = 1 - age / TRAIL_LIFESPAN; // 1.0 → 0.0
          const alpha = Math.floor(fade * 0x30).toString(16).padStart(2, '0');
          ctx.beginPath();
          ctx.strokeStyle = agent.color + alpha;
          const x0 = ox + agent.trail[i - 1].col * cellSize + cellSize / 2;
          const y0 = oy + agent.trail[i - 1].row * cellSize + cellSize / 2;
          const x1 = ox + agent.trail[i].col * cellSize + cellSize / 2;
          const y1 = oy + agent.trail[i].row * cellSize + cellSize / 2;
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        // Current animated segment at full alpha
        if (len > 0) {
          const lastT = agent.trail[len - 1];
          const visCol = lerp(agent.prevPosition.col, agent.position.col, animT);
          const visRow = lerp(agent.prevPosition.row, agent.position.row, animT);
          ctx.beginPath();
          ctx.strokeStyle = agent.color + '30';
          ctx.moveTo(ox + lastT.col * cellSize + cellSize / 2, oy + lastT.row * cellSize + cellSize / 2);
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

        drawEmoji(ENEMY_EMOJIS[enemy.type], ex, ey, eSize);
      }

      // ── Death flash at kill location ──
      for (const agent of agents) {
        if (!agent.deathPos) continue;
        const turnsSinceDeath = turn - agent.respawnTurn;
        if (turnsSinceDeath < 0 || turnsSinceDeath >= 8) {
          if (turnsSinceDeath >= 8) agent.deathPos = null; // clear after animation
          continue;
        }
        const progress = turnsSinceDeath / 8;
        const dx = ox + agent.deathPos.col * cellSize + cellSize / 2;
        const deathY = oy + agent.deathPos.row * cellSize + cellSize / 2;
        const blastRadius = cellSize * (1 + progress * 6);
        const blastAlpha = (1 - progress) * 0.7;

        const blastGrad = ctx.createRadialGradient(dx, deathY, 0, dx, deathY, blastRadius);
        blastGrad.addColorStop(0, `rgba(255,80,40,${blastAlpha.toFixed(2)})`);
        blastGrad.addColorStop(0.3, `rgba(255,200,50,${(blastAlpha * 0.6).toFixed(2)})`);
        blastGrad.addColorStop(0.7, agent.color + Math.floor(blastAlpha * 100).toString(16).padStart(2, '0'));
        blastGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.arc(dx, deathY, blastRadius, 0, Math.PI * 2);
        ctx.fillStyle = blastGrad;
        ctx.fill();

        // Shockwave ring
        const ringRadius = cellSize * (0.5 + progress * 5);
        const ringAlpha = (1 - progress) * 0.9;
        ctx.beginPath();
        ctx.arc(dx, deathY, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${ringAlpha.toFixed(2)})`;
        ctx.lineWidth = Math.max(1, 3 * (1 - progress));
        ctx.stroke();
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

        const spriteImg = spritesRef.current[agent.id];
        if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
          const sprSize = cellSize * 0.75;
          ctx.drawImage(spriteImg, ax - sprSize / 2, ay - sprSize / 2, sprSize, sprSize);
        } else {
          ctx.beginPath();
          ctx.arc(ax, ay, cellSize * 0.28, 0, Math.PI * 2);
          ctx.fillStyle = agent.color;
          ctx.fill();
        }

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

          // Agent sprite watermark in top-left
          const povSprite = spritesRef.current[agent.id];
          if (povSprite && povSprite.complete && povSprite.naturalWidth > 0) {
            const wmSize = Math.min(povW, povH) * 0.4;
            ctx.globalAlpha = 0.15;
            ctx.drawImage(povSprite, povX + 4, vpY + 4, wmSize, wmSize);
            ctx.globalAlpha = 1;
          }

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

            // Left wall — brighter, blue tint
            if (cell.walls[wm.left]) {
              const shade = Math.floor(65 * brightness);
              ctx.fillStyle = `rgb(${Math.floor(shade * 0.7)},${Math.floor(shade * 0.8)},${shade})`;
              ctx.beginPath();
              ctx.moveTo(r0.lx, r0.ty); ctx.lineTo(r1.lx, r1.ty);
              ctx.lineTo(r1.lx, r1.by); ctx.lineTo(r0.lx, r0.by);
              ctx.closePath(); ctx.fill();
              // Edge highlight
              ctx.strokeStyle = `rgba(100,140,200,${0.2 * brightness})`;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(r0.lx, r0.ty); ctx.lineTo(r1.lx, r1.ty);
              ctx.moveTo(r0.lx, r0.by); ctx.lineTo(r1.lx, r1.by);
              ctx.stroke();
            } else if (d > 0) {
              // Side opening — draw recessed wall edges
              const shade = Math.floor(30 * brightness);
              ctx.fillStyle = `rgb(${shade},${shade},${Math.floor(shade * 1.3)})`;
              const rPrev = sRect(d - 1);
              ctx.beginPath();
              ctx.moveTo(r0.lx, r0.ty); ctx.lineTo(r0.lx, r0.by);
              ctx.lineTo(rPrev.lx, rPrev.by); ctx.lineTo(rPrev.lx, rPrev.ty);
              ctx.closePath(); ctx.fill();
            }

            // Right wall — slightly darker than left for depth
            if (cell.walls[wm.right]) {
              const shade = Math.floor(50 * brightness);
              ctx.fillStyle = `rgb(${Math.floor(shade * 0.6)},${Math.floor(shade * 0.7)},${shade})`;
              ctx.beginPath();
              ctx.moveTo(r0.rx, r0.ty); ctx.lineTo(r1.rx, r1.ty);
              ctx.lineTo(r1.rx, r1.by); ctx.lineTo(r0.rx, r0.by);
              ctx.closePath(); ctx.fill();
              // Edge highlight
              ctx.strokeStyle = `rgba(80,110,160,${0.15 * brightness})`;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(r0.rx, r0.ty); ctx.lineTo(r1.rx, r1.ty);
              ctx.moveTo(r0.rx, r0.by); ctx.lineTo(r1.rx, r1.by);
              ctx.stroke();
            } else if (d > 0) {
              const shade = Math.floor(25 * brightness);
              ctx.fillStyle = `rgb(${shade},${shade},${Math.floor(shade * 1.3)})`;
              const rPrev = sRect(d - 1);
              ctx.beginPath();
              ctx.moveTo(r0.rx, r0.ty); ctx.lineTo(r0.rx, r0.by);
              ctx.lineTo(rPrev.rx, rPrev.by); ctx.lineTo(rPrev.rx, rPrev.ty);
              ctx.closePath(); ctx.fill();
            }

            // Ceiling segment — dark with subtle blue
            const ceilShade = Math.floor(22 * brightness);
            ctx.fillStyle = `rgb(${Math.floor(ceilShade * 0.8)},${Math.floor(ceilShade * 0.8)},${ceilShade})`;
            ctx.beginPath();
            ctx.moveTo(r0.lx, r0.ty); ctx.lineTo(r1.lx, r1.ty);
            ctx.lineTo(r1.rx, r1.ty); ctx.lineTo(r0.rx, r0.ty);
            ctx.closePath(); ctx.fill();

            // Floor segment — warmer tone, more visible
            const floorShade = Math.floor(25 * brightness);
            ctx.fillStyle = `rgb(${floorShade},${Math.floor(floorShade * 0.85)},${Math.floor(floorShade * 0.7)})`;
            ctx.beginPath();
            ctx.moveTo(r0.lx, r0.by); ctx.lineTo(r1.lx, r1.by);
            ctx.lineTo(r1.rx, r1.by); ctx.lineTo(r0.rx, r0.by);
            ctx.closePath(); ctx.fill();

            // Floor grid line for depth cue
            ctx.strokeStyle = `rgba(60,50,40,${0.25 * brightness})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(r1.lx, r1.by); ctx.lineTo(r1.rx, r1.by);
            ctx.stroke();

            // Draw entities at this depth — size boosted for visibility
            const entityR = sRect(d + 0.5);
            const entitySize = (entityR.by - entityR.ty) * 0.45;

            // Check for enemies at this cell
            for (const enemy of enemies) {
              if (enemy.position.row === cr && enemy.position.col === cc) {
                const ecx = (entityR.lx + entityR.rx) / 2;
                const ecy = (entityR.ty + entityR.by) / 2;
                drawEmoji(ENEMY_EMOJIS[enemy.type], ecx, ecy, entitySize * 1.6);
              }
              // Also check left/right side corridors for enemies
              const leftR = cr + lv.dr;
              const leftC = cc + lv.dc;
              if (enemy.position.row === leftR && enemy.position.col === leftC && !cell.walls[wm.left]) {
                drawEmoji(ENEMY_EMOJIS[enemy.type], entityR.lx + entitySize * 0.3, (entityR.ty + entityR.by) / 2, entitySize * 0.8);
              }
              const rightR = cr + rv.dr;
              const rightC = cc + rv.dc;
              if (enemy.position.row === rightR && enemy.position.col === rightC && !cell.walls[wm.right]) {
                drawEmoji(ENEMY_EMOJIS[enemy.type], entityR.rx - entitySize * 0.3, (entityR.ty + entityR.by) / 2, entitySize * 0.8);
              }
            }

            // Check for power-ups at this cell or adjacent side corridors
            const fpvPowerUps = powerUpsRef.current;
            for (const pu of fpvPowerUps) {
              if (pu.collected) continue;
              const puColor = POWERUP_COLORS[pu.type];
              const puCx = (entityR.lx + entityR.rx) / 2;
              const puCy = (entityR.ty + entityR.by) / 2;
              const puR = entitySize * 0.4;

              if (pu.position.row === cr && pu.position.col === cc) {
                // Power-up directly ahead — draw with glow and shape
                const puPulse = Math.sin(now / 350 + pu.id * 2) * 0.25 + 0.75;
                const puGrad = ctx.createRadialGradient(puCx, puCy, 0, puCx, puCy, puR * 2 * puPulse);
                puGrad.addColorStop(0, puColor + 'cc');
                puGrad.addColorStop(1, puColor + '00');
                ctx.beginPath();
                ctx.arc(puCx, puCy, puR * 2 * puPulse, 0, Math.PI * 2);
                ctx.fillStyle = puGrad;
                ctx.fill();

                // Distinct shape per type
                ctx.fillStyle = puColor;
                ctx.strokeStyle = puColor;
                ctx.lineWidth = 1.5;
                if (pu.type === 'speed') {
                  // Lightning bolt
                  const bz = puR * 0.8;
                  ctx.beginPath();
                  ctx.moveTo(puCx + bz * 0.1, puCy - bz);
                  ctx.lineTo(puCx - bz * 0.35, puCy + bz * 0.05);
                  ctx.lineTo(puCx + bz * 0.05, puCy + bz * 0.05);
                  ctx.lineTo(puCx - bz * 0.1, puCy + bz);
                  ctx.lineTo(puCx + bz * 0.35, puCy - bz * 0.05);
                  ctx.lineTo(puCx - bz * 0.05, puCy - bz * 0.05);
                  ctx.closePath();
                  ctx.fill();
                } else if (pu.type === 'shield') {
                  // Shield ring with cross
                  ctx.beginPath();
                  ctx.arc(puCx, puCy, puR * 0.7, 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.beginPath();
                  ctx.moveTo(puCx, puCy - puR * 0.45);
                  ctx.lineTo(puCx, puCy + puR * 0.45);
                  ctx.moveTo(puCx - puR * 0.45, puCy);
                  ctx.lineTo(puCx + puR * 0.45, puCy);
                  ctx.stroke();
                } else {
                  // Magnet — 4-pointed star
                  const ss = puR * 0.7;
                  const si = puR * 0.25;
                  ctx.beginPath();
                  ctx.moveTo(puCx, puCy - ss);
                  ctx.lineTo(puCx + si, puCy - si);
                  ctx.lineTo(puCx + ss, puCy);
                  ctx.lineTo(puCx + si, puCy + si);
                  ctx.lineTo(puCx, puCy + ss);
                  ctx.lineTo(puCx - si, puCy + si);
                  ctx.lineTo(puCx - ss, puCy);
                  ctx.lineTo(puCx - si, puCy - si);
                  ctx.closePath();
                  ctx.fill();
                }
              }

              // Power-up in left side corridor
              const puLeftR = cr + lv.dr;
              const puLeftC = cc + lv.dc;
              if (pu.position.row === puLeftR && pu.position.col === puLeftC && !cell.walls[wm.left]) {
                ctx.beginPath();
                ctx.arc(entityR.lx + entitySize * 0.3, puCy, entitySize * 0.2, 0, Math.PI * 2);
                ctx.fillStyle = puColor + 'bb';
                ctx.fill();
              }
              // Power-up in right side corridor
              const puRightR = cr + rv.dr;
              const puRightC = cc + rv.dc;
              if (pu.position.row === puRightR && pu.position.col === puRightC && !cell.walls[wm.right]) {
                ctx.beginPath();
                ctx.arc(entityR.rx - entitySize * 0.3, puCy, entitySize * 0.2, 0, Math.PI * 2);
                ctx.fillStyle = puColor + 'bb';
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

            // Forward wall (end of corridor) — distinct purple tint
            if (cell.walls[wm.forward]) {
              const shade = Math.floor(45 * brightness);
              ctx.fillStyle = `rgb(${Math.floor(shade * 0.8)},${Math.floor(shade * 0.7)},${shade})`;
              ctx.fillRect(r1.lx, r1.ty, r1.rx - r1.lx, r1.by - r1.ty);
              // Border for the wall face
              ctx.strokeStyle = `rgba(100,90,140,${0.2 * brightness})`;
              ctx.lineWidth = 1;
              ctx.strokeRect(r1.lx, r1.ty, r1.rx - r1.lx, r1.by - r1.ty);
              hitEnd = true;
            }
          }

          // ── Goal compass arrow at vanishing point ──
          const goalDr = CENTER - agent.position.row;
          const goalDc = CENTER - agent.position.col;
          if (goalDr !== 0 || goalDc !== 0) {
            // Map goal direction relative to facing
            let relX = 0, relY = 0;
            if (facing === 'up')    { relX =  goalDc; relY = -goalDr; }
            if (facing === 'down')  { relX = -goalDc; relY =  goalDr; }
            if (facing === 'left')  { relX = -goalDr; relY = -goalDc; }
            if (facing === 'right') { relX =  goalDr; relY =  goalDc; }
            const ang = Math.atan2(relX, -relY);
            const arrowR = Math.min(povW, povH) * 0.12;
            const arrowX = cx + Math.sin(ang) * arrowR * 1.8;
            const arrowY = cy + Math.cos(ang) * arrowR * 1.2;
            const goalPulse = Math.sin(now / 400) * 0.3 + 0.7;
            ctx.save();
            ctx.globalAlpha = goalPulse * 0.7;
            ctx.translate(arrowX, arrowY);
            ctx.rotate(-ang);
            ctx.beginPath();
            ctx.moveTo(0, -arrowR * 0.6);
            ctx.lineTo(-arrowR * 0.3, arrowR * 0.3);
            ctx.lineTo(arrowR * 0.3, arrowR * 0.3);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
          }

          // ── Radar: nearby entities as edge indicators ──
          const RADAR_RANGE = 5;
          for (const enemy of enemies) {
            const edist = manhattan(agent.position, enemy.position);
            if (edist > 0 && edist <= RADAR_RANGE) {
              const dr = enemy.position.row - agent.position.row;
              const dc = enemy.position.col - agent.position.col;
              let rx = 0, ry = 0;
              if (facing === 'up')    { rx =  dc; ry = -dr; }
              if (facing === 'down')  { rx = -dc; ry =  dr; }
              if (facing === 'left')  { rx = -dr; ry = -dc; }
              if (facing === 'right') { rx =  dr; ry =  dc; }
              const a = Math.atan2(rx, -ry);
              const edgeX = cx + Math.cos(a + Math.PI / 2) * (povW * 0.42);
              const edgeY = cy + Math.sin(a + Math.PI / 2) * (povH * 0.42);
              const radarSize = Math.max(8, 14 - edist * 2);
              drawEmoji(ENEMY_EMOJIS[enemy.type], edgeX, edgeY, radarSize);
            }
          }
          for (const pu of powerUpsRef.current) {
            if (pu.collected) continue;
            const pdist = manhattan(agent.position, pu.position);
            if (pdist > 0 && pdist <= RADAR_RANGE) {
              const dr = pu.position.row - agent.position.row;
              const dc = pu.position.col - agent.position.col;
              let rx = 0, ry = 0;
              if (facing === 'up')    { rx =  dc; ry = -dr; }
              if (facing === 'down')  { rx = -dc; ry =  dr; }
              if (facing === 'left')  { rx = -dr; ry = -dc; }
              if (facing === 'right') { rx =  dr; ry =  dc; }
              const a = Math.atan2(rx, -ry);
              const edgeX = cx + Math.cos(a + Math.PI / 2) * (povW * 0.42);
              const edgeY = cy + Math.sin(a + Math.PI / 2) * (povH * 0.42);
              ctx.beginPath();
              ctx.arc(edgeX, edgeY, 3, 0, Math.PI * 2);
              ctx.fillStyle = POWERUP_COLORS[pu.type] + 'cc';
              ctx.fill();
            }
          }

          // Wrap portal radar — show nearby wrap openings as cyan diamonds
          for (const wrap of wrapsRef.current) {
            let wr: number, wc: number;
            if (wrap.edge === 'top')    { wr = 0; wc = wrap.pos; }
            else if (wrap.edge === 'bottom') { wr = MAZE_SIZE - 1; wc = wrap.pos; }
            else if (wrap.edge === 'left')   { wr = wrap.pos; wc = 0; }
            else                             { wr = wrap.pos; wc = MAZE_SIZE - 1; }
            const wdist = manhattan(agent.position, { row: wr, col: wc });
            if (wdist > 0 && wdist <= RADAR_RANGE) {
              const dr = wr - agent.position.row;
              const dc = wc - agent.position.col;
              let rx2 = 0, ry2 = 0;
              if (facing === 'up')    { rx2 =  dc; ry2 = -dr; }
              if (facing === 'down')  { rx2 = -dc; ry2 =  dr; }
              if (facing === 'left')  { rx2 = -dr; ry2 = -dc; }
              if (facing === 'right') { rx2 =  dr; ry2 =  dc; }
              const wa = Math.atan2(rx2, -ry2);
              const wex = cx + Math.cos(wa + Math.PI / 2) * (povW * 0.42);
              const wey = cy + Math.sin(wa + Math.PI / 2) * (povH * 0.42);
              // Diamond shape
              ctx.beginPath();
              ctx.moveTo(wex, wey - 4); ctx.lineTo(wex + 3, wey);
              ctx.lineTo(wex, wey + 4); ctx.lineTo(wex - 3, wey);
              ctx.closePath();
              ctx.fillStyle = 'rgba(100,200,255,0.8)';
              ctx.fill();
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
      ctx.font = `bold ${isMobile ? 16 : 22}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('M A Z E   R A C E', (showPov ? mazeAreaW : w) / 2, 10);

      if (!isMobile) {
        ctx.font = '13px "Courier New", monospace';
        ctx.fillStyle = '#555';
        ctx.fillText('4 pathfinding bots race to the center  //  dodge enemies  //  grab power-ups', (showPov ? mazeAreaW : w) / 2, 36);
      }

      // ── HUD: Mute button ──
      const mBtn = getMuteButtonBounds();
      const isMuted = mutedRef.current;
      ctx.strokeStyle = isMuted ? '#ff4444' : '#666';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      // Speaker body
      ctx.beginPath();
      ctx.moveTo(mBtn.x + 8, mBtn.y + 10);
      ctx.lineTo(mBtn.x + 12, mBtn.y + 10);
      ctx.lineTo(mBtn.x + 17, mBtn.y + 6);
      ctx.lineTo(mBtn.x + 17, mBtn.y + 22);
      ctx.lineTo(mBtn.x + 12, mBtn.y + 18);
      ctx.lineTo(mBtn.x + 8, mBtn.y + 18);
      ctx.closePath();
      ctx.strokeStyle = isMuted ? '#ff4444' : '#888';
      ctx.stroke();
      if (!isMuted) {
        // Sound waves
        ctx.beginPath();
        ctx.arc(mBtn.x + 18, mBtn.y + 14, 4, -0.6, 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(mBtn.x + 18, mBtn.y + 14, 7, -0.5, 0.5);
        ctx.stroke();
      } else {
        // X mark
        ctx.beginPath();
        ctx.moveTo(mBtn.x + 20, mBtn.y + 10);
        ctx.lineTo(mBtn.x + 26, mBtn.y + 18);
        ctx.moveTo(mBtn.x + 26, mBtn.y + 10);
        ctx.lineTo(mBtn.x + 20, mBtn.y + 18);
        ctx.stroke();
      }

      // ── HUD: Turn counter ──
      if (state === 'racing' || state === 'finished') {
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`Turn ${turn}`, (showPov ? mazeAreaW : w) - 50, 12);
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
      const barY = h - (isMobile ? 40 : 50);
      if (isMobile) {
        // 2×2 compact grid
        const halfW = mazeAreaW / 2;
        for (let i = 0; i < agents.length; i++) {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const sx = col * halfW + 10;
          const sy = barY + row * 18;
          const a = agents[i];

          const hudSprite = spritesRef.current[a.id];
          if (hudSprite && hudSprite.complete && hudSprite.naturalWidth > 0) {
            ctx.drawImage(hudSprite, sx - 5, sy - 7, 14, 14);
          } else {
            ctx.beginPath();
            ctx.arc(sx, sy, 3, 0, Math.PI * 2);
            ctx.fillStyle = a.color;
            ctx.fill();
          }

          ctx.fillStyle = a.color;
          ctx.font = 'bold 10px "Courier New", monospace';
          ctx.textAlign = 'left';
          ctx.fillText(a.name, sx + 12, sy);

          ctx.font = '9px "Courier New", monospace';
          const respawnAge = turn - a.respawnTurn;
          if (a.finished) {
            ctx.fillStyle = a.finishOrder === 1 ? a.color : '#555';
            ctx.fillText(a.finishOrder === 1 ? 'WIN' : `#${a.finishOrder}`, sx + 48, sy);
          } else if (respawnAge >= 0 && respawnAge < 3) {
            ctx.fillStyle = '#ff3333';
            ctx.fillText('RSP!', sx + 48, sy);
          } else if (a.shieldTurns > 0) {
            ctx.fillStyle = '#00ddff';
            ctx.fillText(`SH${a.shieldTurns}`, sx + 48, sy);
          } else if (a.speedTurns > 0) {
            ctx.fillStyle = '#ffdd00';
            ctx.fillText(`SP${a.speedTurns}`, sx + 48, sy);
          } else {
            ctx.fillStyle = '#555';
            ctx.fillText(`${a.history.length}m`, sx + 48, sy);
          }
        }
      } else {
        // Desktop: single row
        const segW = mazeAreaW / 4;
        for (let i = 0; i < agents.length; i++) {
          const sx = segW * i + segW / 2;
          const a = agents[i];

          const hudSprite = spritesRef.current[a.id];
          if (hudSprite && hudSprite.complete && hudSprite.naturalWidth > 0) {
            ctx.drawImage(hudSprite, sx - 56, barY - 9, 18, 18);
          } else {
            ctx.beginPath();
            ctx.arc(sx - 50, barY, 5, 0, Math.PI * 2);
            ctx.fillStyle = a.color;
            ctx.fill();
          }

          ctx.fillStyle = a.color;
          ctx.font = 'bold 13px "Courier New", monospace';
          ctx.textAlign = 'left';
          ctx.fillText(a.name, sx - 34, barY);

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
      }


      // ── Equalizer visualization ──
      if ((state === 'racing' || state === 'finished') && analyserRef.current && freqDataRef.current) {
        analyserRef.current.getByteFrequencyData(freqDataRef.current);
        const fd = freqDataRef.current;
        const eqH = showPov ? 60 : (isMobile ? 24 : 40);
        // Match POV panel width when visible, otherwise fit in corner
        const eqPanelW = showPov ? (POV_PANEL_W - 10) : (isMobile ? 80 : 120);
        const eqBars = showPov ? 32 : 16;
        const eqGap = 1;
        const barW = Math.max(2, Math.floor((eqPanelW - (eqBars - 1) * eqGap) / eqBars));
        const eqTotalW = eqBars * (barW + eqGap) - eqGap;
        const eqX = showPov ? (mazeAreaW + 5 + (eqPanelW - eqTotalW) / 2) : (w - eqTotalW - 10);
        const eqY = showPov ? (h - 8) : (barY - 14);
        const step = Math.max(1, Math.floor(fd.length / eqBars));
        const eqColors = ['#ff4466', '#ff6644', '#ffaa22', '#ffdd00', '#aaff44', '#44ff88', '#44ddff', '#4488ff'];

        for (let i = 0; i < eqBars; i++) {
          const val = fd[i * step] / 255;
          const barH = Math.max(2, val * eqH);
          const colorIdx = Math.floor((i / eqBars) * eqColors.length);
          const alpha = mutedRef.current ? 0.15 : 0.4 + val * 0.5;
          ctx.fillStyle = eqColors[colorIdx] + Math.floor(alpha * 255).toString(16).padStart(2, '0');
          ctx.fillRect(eqX + i * (barW + eqGap), eqY - barH, barW, barH);
        }
      }

      // ── Finished overlay ──
      ctx.textBaseline = 'alphabetic';

      if (state === 'finished' && winner) {
        ctx.fillStyle = 'rgba(8,8,14,0.85)';
        ctx.fillRect(0, 0, w, h);

        ctx.textAlign = 'center';

        // Winner sprite + announcement
        const winSprite = spritesRef.current[winner.id];
        if (winSprite && winSprite.complete && winSprite.naturalWidth > 0) {
          const winSize = isMobile ? 64 : 100;
          ctx.drawImage(winSprite, w / 2 - winSize / 2, h / 2 - (isMobile ? 130 : 170), winSize, winSize);
        }

        ctx.save();
        ctx.shadowColor = winner.color;
        ctx.shadowBlur = isMobile ? 18 : 30;
        ctx.fillStyle = winner.color;
        ctx.font = `bold ${isMobile ? 28 : 52}px "Courier New", monospace`;
        ctx.fillText(`${winner.name} WINS!`, w / 2, h / 2 - 50);
        ctx.restore();

        ctx.fillStyle = '#aaa';
        ctx.font = `${isMobile ? 12 : 18}px "Courier New", monospace`;
        ctx.fillText(
          isMobile
            ? `${winner.history.length} moves (${turn} turns)`
            : `Reached the center in ${winner.history.length} moves (${turn} turns)`,
          w / 2,
          h / 2 - 10
        );

        // Did the user's pick win?
        if (pickedWinnerRef.current !== null) {
          const pickedCfg = AGENT_CONFIGS[pickedWinnerRef.current];
          const correct = pickedWinnerRef.current === winner.id;
          ctx.font = `bold ${isMobile ? 13 : 18}px "Courier New", monospace`;
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

        let ry = h / 2 + (isMobile ? 30 : 60);
        const lineGap = isMobile ? 18 : 22;
        ctx.font = `${isMobile ? 11 : 14}px "Courier New", monospace`;
        for (const a of finishedAgents) {
          ctx.fillStyle = a.color;
          ctx.fillText(`#${a.finishOrder} ${a.name} — ${a.history.length} moves`, w / 2, ry);
          ry += lineGap;
        }
        for (const a of unfinished) {
          ctx.fillStyle = '#555';
          ctx.fillText(`-- ${a.name} — DNF (${a.history.length} moves)`, w / 2, ry);
          ry += lineGap;
        }

        const btnP = Math.sin(now / 500) * 0.15 + 0.85;
        ctx.fillStyle = `rgba(68,153,255,${btnP.toFixed(2)})`;
        ctx.font = `bold ${isMobile ? 15 : 18}px "Courier New", monospace`;
        ctx.fillText('[ TAP FOR NEW RACE ]', w / 2, ry + 20);
      }

      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);

    return () => {
      running = false;
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('touchstart', handleTouchStartRef.current);
      canvas.removeEventListener('touchmove', handleTouchMoveRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup audio + AudioContext on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
        analyserRef.current = null;
        freqDataRef.current = null;
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      style={{ display: 'block', cursor: 'pointer', touchAction: 'none' }}
    />
  );
}
