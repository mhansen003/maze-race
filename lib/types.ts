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

export interface MoveRequest {
  agentName: string;
  personality: string;
  position: Position;
  goal: Position;
  mazeAscii: string;
  availableMoves: Direction[];
  recentMoves: Direction[];
}
