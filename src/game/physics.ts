import type { MazeData } from '../../shared/types.ts';
import { PLAYER_RADIUS } from '../../shared/types.ts';

export function resolveMazeCollisions(
  pos: { x: number; y: number },
  maze: MazeData
): void {
  const { cols, rows, cells } = maze;
  for (let iter = 0; iter < 2; iter++) {
    const minCx = Math.max(0, Math.floor(pos.x - PLAYER_RADIUS - 0.1));
    const maxCx = Math.min(cols - 1, Math.floor(pos.x + PLAYER_RADIUS + 0.1));
    const minCy = Math.max(0, Math.floor(pos.y - PLAYER_RADIUS - 0.1));
    const maxCy = Math.min(rows - 1, Math.floor(pos.y + PLAYER_RADIUS + 0.1));

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        if (cells[cy * cols + cx] !== 1) continue;

        const closestX = Math.max(cx, Math.min(pos.x, cx + 1));
        const closestY = Math.max(cy, Math.min(pos.y, cy + 1));
        const dx = pos.x - closestX;
        const dy = pos.y - closestY;
        const distSq = dx * dx + dy * dy;

        if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
          const dist = Math.sqrt(distSq);
          if (dist > 0.0001) {
            const overlap = PLAYER_RADIUS - dist;
            pos.x += (dx / dist) * overlap;
            pos.y += (dy / dist) * overlap;
          } else {
            pos.x += PLAYER_RADIUS;
          }
        }
      }
    }
  }
}
