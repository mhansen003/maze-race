import { Cell, Position, Direction } from './types';

/**
 * Generate a perfect maze using recursive backtracking (DFS).
 * A perfect maze has exactly one path between any two cells.
 */
export function generateMaze(rows: number, cols: number): Cell[][] {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      walls: { top: true, right: true, bottom: true, left: true },
    }))
  );

  const visited: boolean[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(false)
  );

  function carve(row: number, col: number) {
    visited[row][col] = true;
    const directions = shuffle(['top', 'right', 'bottom', 'left'] as const);

    for (const dir of directions) {
      const [nr, nc] = getNeighbor(row, col, dir);
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc]) {
        grid[row][col].walls[dir] = false;
        grid[nr][nc].walls[opposite(dir)] = false;
        carve(nr, nc);
      }
    }
  }

  carve(0, 0);
  return grid;
}

function getNeighbor(row: number, col: number, dir: string): [number, number] {
  switch (dir) {
    case 'top':    return [row - 1, col];
    case 'bottom': return [row + 1, col];
    case 'left':   return [row, col - 1];
    case 'right':  return [row, col + 1];
    default:       return [row, col];
  }
}

function opposite(dir: string): 'top' | 'right' | 'bottom' | 'left' {
  switch (dir) {
    case 'top':    return 'bottom';
    case 'bottom': return 'top';
    case 'left':   return 'right';
    case 'right':  return 'left';
    default:       return 'top';
  }
}

function shuffle<T>(array: readonly T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Convert maze to ASCII representation for the AI agent.
 * Each cell becomes a character, with walls between cells.
 * Grid is (2*rows+1) x (2*cols+1).
 */
export function mazeToAscii(
  grid: Cell[][],
  agentPos: Position,
  goalPos: Position
): string {
  const rows = grid.length;
  const cols = grid[0].length;
  const h = rows * 2 + 1;
  const w = cols * 2 + 1;

  // Fill with walls
  const ascii: string[][] = Array.from({ length: h }, () =>
    Array(w).fill('#')
  );

  // Carve cell interiors and passages
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Cell interior
      ascii[r * 2 + 1][c * 2 + 1] = ' ';

      // Right passage
      if (!grid[r][c].walls.right && c < cols - 1) {
        ascii[r * 2 + 1][c * 2 + 2] = ' ';
      }
      // Bottom passage
      if (!grid[r][c].walls.bottom && r < rows - 1) {
        ascii[r * 2 + 2][c * 2 + 1] = ' ';
      }
    }
  }

  // Mark agent and goal
  ascii[agentPos.row * 2 + 1][agentPos.col * 2 + 1] = 'A';
  ascii[goalPos.row * 2 + 1][goalPos.col * 2 + 1] = 'G';

  return ascii.map((row) => row.join('')).join('\n');
}

/** Get available moves (directions without walls) from a position. */
export function getAvailableMoves(grid: Cell[][], pos: Position): Direction[] {
  const cell = grid[pos.row][pos.col];
  const moves: Direction[] = [];
  if (!cell.walls.top) moves.push('up');
  if (!cell.walls.right) moves.push('right');
  if (!cell.walls.bottom) moves.push('down');
  if (!cell.walls.left) moves.push('left');
  return moves;
}

/** Apply a direction to a position and return the new position. */
export function applyMove(pos: Position, dir: Direction): Position {
  switch (dir) {
    case 'up':    return { row: pos.row - 1, col: pos.col };
    case 'down':  return { row: pos.row + 1, col: pos.col };
    case 'left':  return { row: pos.row, col: pos.col - 1 };
    case 'right': return { row: pos.row, col: pos.col + 1 };
  }
}
