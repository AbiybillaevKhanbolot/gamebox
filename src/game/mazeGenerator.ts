import type { MazeData, MazePortalPair, MazeSizeOption } from '../../shared/types.ts';

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function getMazeDimensions(
  sizeOption: MazeSizeOption
): { cols: number; rows: number } {
  if (sizeOption === 'medium') return { cols: 27, rows: 17 };
  if (sizeOption === 'huge') return { cols: 39, rows: 25 };
  return { cols: 33, rows: 21 }; // default 'large'
}

export function generateMaze(sizeOption: MazeSizeOption): MazeData {
  const { cols, rows } = getMazeDimensions(sizeOption);
  const cells = new Array<number>(cols * rows).fill(1);
  const idx = (x: number, y: number) => y * cols + x;

  const startX = 1;
  const startY = 1;
  cells[idx(startX, startY)] = 0;

  const stack: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  const dirs = [
    { dx: 0, dy: -2 },
    { dx: 2, dy: 0 },
    { dx: 0, dy: 2 },
    { dx: -2, dy: 0 },
  ];

  while (stack.length > 0) {
    const curr = stack[stack.length - 1];
    const neighbors = shuffle([...dirs]).filter((d) => {
      const nx = curr.x + d.dx;
      const ny = curr.y + d.dy;
      return nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && cells[idx(nx, ny)] === 1;
    });

    if (neighbors.length === 0) {
      stack.pop();
    } else {
      const chosen = neighbors[0];
      const mx = curr.x + chosen.dx / 2;
      const my = curr.y + chosen.dy / 2;
      const nx = curr.x + chosen.dx;
      const ny = curr.y + chosen.dy;
      cells[idx(mx, my)] = 0;
      cells[idx(nx, ny)] = 0;
      stack.push({ x: nx, y: ny });
    }
  }

  // Braid dead ends so large labyrinths have tactical flanking routes
  for (let y = 1; y < rows - 1; y += 2) {
    for (let x = 1; x < cols - 1; x += 2) {
      let openNeighbors = 0;
      const closedWalls: Array<{ wx: number; wy: number }> = [];
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        const wx = x + dx;
        const wy = y + dy;
        if (cells[idx(wx, wy)] === 0) {
          openNeighbors++;
        } else if (wx > 0 && wx < cols - 1 && wy > 0 && wy < rows - 1) {
          const oppositeX = x + dx * 2;
          const oppositeY = y + dy * 2;
          if (
            oppositeX > 0 &&
            oppositeX < cols - 1 &&
            oppositeY > 0 &&
            oppositeY < rows - 1 &&
            cells[idx(oppositeX, oppositeY)] === 0
          ) {
            closedWalls.push({ wx, wy });
          }
        }
      }

      if (openNeighbors === 1 && closedWalls.length > 0 && Math.random() < 0.52) {
        const pick = closedWalls[Math.floor(Math.random() * closedWalls.length)];
        cells[idx(pick.wx, pick.wy)] = 0;
      }
    }
  }

  const extraLoops = Math.floor((cols * rows) / 42);
  for (let i = 0; i < extraLoops; i++) {
    const x = 2 + Math.floor(Math.random() * (cols - 4));
    const y = 2 + Math.floor(Math.random() * (rows - 4));
    if (cells[idx(x, y)] === 1) {
      const horizOpen = cells[idx(x - 1, y)] === 0 && cells[idx(x + 1, y)] === 0;
      const vertOpen = cells[idx(x, y - 1)] === 0 && cells[idx(x, y + 1)] === 0;
      const horizWalls = cells[idx(x - 1, y)] === 1 && cells[idx(x + 1, y)] === 1;
      const vertWalls = cells[idx(x, y - 1)] === 1 && cells[idx(x, y + 1)] === 1;
      if ((horizOpen && vertWalls) || (vertOpen && horizWalls)) {
        cells[idx(x, y)] = 0;
      }
    }
  }

  // Hero 1 spawns at a random corner; Hero 2 spawns nearby (within 2-3 open steps) or opposite flank
  const cornerOptions = [
    { x: 1, y: 1 },
    { x: cols - 2, y: 1 },
    { x: 1, y: rows - 2 },
    { x: cols - 2, y: rows - 2 },
  ];
  const heroCell1 = cornerOptions[Math.floor(Math.random() * cornerOptions.length)];

  // BFS from heroCell1
  const dist = new Int32Array(cols * rows).fill(-1);
  const queue: Array<{ x: number; y: number }> = [heroCell1];
  dist[idx(heroCell1.x, heroCell1.y)] = 0;
  let head = 0;
  let maxDist = 0;
  let farthestCell = { x: cols - 2, y: rows - 2 };

  while (head < queue.length) {
    const curr = queue[head++];
    const d = dist[idx(curr.x, curr.y)];
    if (d > maxDist) {
      maxDist = d;
      farthestCell = curr;
    }
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const nx = curr.x + dx;
      const ny = curr.y + dy;
      if (nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && cells[idx(nx, ny)] === 0 && dist[idx(nx, ny)] === -1) {
        dist[idx(nx, ny)] = d + 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }

  cells[idx(farthestCell.x, farthestCell.y)] = 2;

  // Find Hero 2 spawn near Hero 1 (distance 2..4 cells) so 2 heroes can coordinate
  let heroCell2 = heroCell1;
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (cells[idx(x, y)] === 0 && dist[idx(x, y)] >= 2 && dist[idx(x, y)] <= 4) {
        heroCell2 = { x, y };
        break;
      }
    }
    if (heroCell2 !== heroCell1) break;
  }

  // Hunter spawns across mid-to-far zone (away from hero spawns and exit)
  const minHunterDist = Math.max(10, Math.floor(maxDist * 0.42));
  const candidateSpawns: Array<{ x: number; y: number; d: number }> = [];
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (cells[idx(x, y)] === 0) {
        const d = dist[idx(x, y)];
        const distToExit = Math.abs(x - farthestCell.x) + Math.abs(y - farthestCell.y);
        if (d >= minHunterDist && distToExit >= 3) {
          candidateSpawns.push({ x, y, d });
        }
      }
    }
  }

  shuffle(candidateSpawns);

  const hunterSpawns: { x: number; y: number }[] = [];
  for (const cand of candidateSpawns) {
    if (hunterSpawns.length >= 9) break;
    const tooClose = hunterSpawns.some((s) => Math.hypot(s.x - cand.x, s.y - cand.y) < 3.5);
    if (!tooClose) {
      hunterSpawns.push({ x: cand.x + 0.5, y: cand.y + 0.5 });
    }
  }
  for (const cand of candidateSpawns) {
    if (hunterSpawns.length >= 9) break;
    if (!hunterSpawns.some((s) => Math.floor(s.x) === cand.x && Math.floor(s.y) === cand.y)) {
      hunterSpawns.push({ x: cand.x + 0.5, y: cand.y + 0.5 });
    }
  }
  if (hunterSpawns.length === 0) {
    hunterSpawns.push({ x: Math.floor(cols / 2) + 0.5, y: Math.floor(rows / 2) + 0.5 });
  }

  // Linked portals on opposing flanks
  let portals: MazePortalPair | null = null;
  const midLow = Math.floor(maxDist * 0.25);
  const midHigh = Math.floor(maxDist * 0.78);
  const portalCands: Array<{ x: number; y: number }> = [];
  for (let y = 2; y < rows - 2; y++) {
    for (let x = 2; x < cols - 2; x++) {
      if (cells[idx(x, y)] === 0) {
        const d = dist[idx(x, y)];
        const nearSpawn = hunterSpawns.some((s) => Math.hypot(s.x - (x + 0.5), s.y - (y + 0.5)) < 2);
        if (d >= midLow && d <= midHigh && !nearSpawn) {
          portalCands.push({ x, y });
        }
      }
    }
  }
  shuffle(portalCands);
  if (portalCands.length >= 2) {
    const a = portalCands[0];
    const b = portalCands.find((p) => Math.hypot(p.x - a.x, p.y - a.y) >= cols * 0.44);
    if (b) {
      cells[idx(a.x, a.y)] = 3;
      cells[idx(b.x, b.y)] = 4;
      portals = {
        ax: a.x + 0.5,
        ay: a.y + 0.5,
        bx: b.x + 0.5,
        by: b.y + 0.5,
      };
    }
  }

  return {
    cols,
    rows,
    cells,
    heroSpawns: [
      { x: heroCell1.x + 0.5, y: heroCell1.y + 0.5 },
      { x: heroCell2.x + 0.5, y: heroCell2.y + 0.5 },
    ],
    exitPos: { x: farthestCell.x + 0.5, y: farthestCell.y + 0.5 },
    hunterSpawns,
    portals,
  };
}
