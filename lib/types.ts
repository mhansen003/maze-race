export interface Cell {
  walls: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
}

export interface Position {
  row: number;
  col: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Agent {
  id: number;
  name: string;
  color: string;
  glowColor: string;
  position: Position;
  history: Direction[];
  personality: string;
  trail: Position[];
  finished: boolean;
  finishOrder: number | null;
}

export interface AgentConfig {
  id: number;
  name: string;
  color: string;
  glowColor: string;
  personality: string;
  startPos: Position;
}

export interface MoveOption {
  direction: Direction;
  row: number;
  col: number;
  distanceToGoal: number;
  timesVisited: number;
  isReverse: boolean;
}

export interface MoveRequest {
  agentName: string;
  personality: string;
  position: Position;
  goal: Position;
  currentDistance: number;
  moveOptions: MoveOption[];
  recentMoves: Direction[];
  nearbyEnemies: NearbyEnemy[];
  isScrambled: boolean;
}

// ─── Enemy types ──────────────────────────────────────────

export type EnemyType = 'ghost' | 'freezer' | 'scrambler' | 'thief';

export interface Enemy {
  id: number;
  type: EnemyType;
  position: Position;
  prevPosition: Position;
  lastDirection: Direction | null;
  recentPositions: string[]; // posKey history for cycle detection
}

export interface NearbyEnemy {
  type: EnemyType;
  position: Position;
  distance: number;
}
