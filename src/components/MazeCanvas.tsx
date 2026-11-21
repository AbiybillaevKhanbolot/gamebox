import React, { useEffect, useRef } from 'react';
import type {
  GamePhase,
  MazeData,
  PlayerRole,
  VisibilityMode,
} from '../../shared/types.ts';
import {
  HERO_BASE_SPEED,
  HERO_DASH_MULT,
  HERO_VISION_RADIUS,
  HUNTER_BASE_SPEED,
  HUNTER_DASH_MULT,
  HUNTER_VISION_RADIUS,
} from '../../shared/types.ts';
import { resolveMazeCollisions } from '../game/physics.ts';
import type { LiveTickData, VisualEffect } from '../hooks/useGameSocket.ts';

interface MazeCanvasProps {
  maze: MazeData;
  phase: GamePhase;
  playerId: string | null;
  myRole: PlayerRole;
  visibilityMode: VisibilityMode;
  liveTickRef: React.MutableRefObject<LiveTickData | null>;
  prevTickRef: React.MutableRefObject<LiveTickData | null>;
  effectsRef: React.MutableRefObject<VisualEffect[]>;
  localInputRef: React.MutableRefObject<{ dx: number; dy: number }>;
  onPingCell: (x: number, y: number) => void;
}

interface SmoothedPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingX: number;
  facingY: number;
  walkPhase: number;
  trail: Array<{ x: number; y: number; alpha: number }>;
}

interface FloatingBanner {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
}

function buildStaticMazeCache(
  maze: MazeData,
  viewW: number,
  viewH: number,
  dpr: number,
  offsetX: number,
  offsetY: number,
  cellSize: number
): HTMLCanvasElement {
  const cache = document.createElement('canvas');
  cache.width = Math.max(1, Math.round(viewW * dpr));
  cache.height = Math.max(1, Math.round(viewH * dpr));
  const ctx = cache.getContext('2d');
  if (!ctx) return cache;

  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#132227';
  ctx.fillRect(0, 0, viewW, viewH);

  const boardW = cellSize * maze.cols;
  const boardH = cellSize * maze.rows;

  ctx.fillStyle = '#0B1417';
  ctx.fillRect(offsetX - 4, offsetY - 4, boardW + 8, boardH + 8);

  // Warm parchment floor
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      if (maze.cells[y * maze.cols + x] !== 1) {
        const fx = offsetX + x * cellSize;
        const fy = offsetY + y * cellSize;
        const checker = (x + y) % 2 === 0;
        ctx.fillStyle = checker ? '#EFE4CE' : '#E7DAC0';
        ctx.fillRect(fx, fy, cellSize, cellSize);

        ctx.strokeStyle = 'rgba(22, 35, 40, 0.08)';
        ctx.lineWidth = 1;
        ctx.strokeRect(fx + 0.5, fy + 0.5, cellSize - 1, cellSize - 1);
      }
    }
  }

  // Cast wall shadows
  const shadowDepth = Math.max(3, Math.round(cellSize * 0.16));
  ctx.fillStyle = 'rgba(16, 30, 35, 0.22)';
  for (let y = 0; y < maze.rows - 1; y++) {
    for (let x = 0; x < maze.cols; x++) {
      if (
        maze.cells[y * maze.cols + x] === 1 &&
        maze.cells[(y + 1) * maze.cols + x] !== 1
      ) {
        ctx.fillRect(
          offsetX + x * cellSize,
          offsetY + (y + 1) * cellSize,
          cellSize,
          shadowDepth
        );
      }
    }
  }

  // Carved stone walls
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      if (maze.cells[y * maze.cols + x] === 1) {
        const wx = offsetX + x * cellSize;
        const wy = offsetY + y * cellSize;

        ctx.fillStyle = '#203B43';
        ctx.fillRect(wx, wy, cellSize, cellSize);

        ctx.strokeStyle = '#15282E';
        ctx.lineWidth = 1;
        ctx.strokeRect(wx + 0.5, wy + 0.5, cellSize - 1, cellSize - 1);

        const aboveFloor = y > 0 && maze.cells[(y - 1) * maze.cols + x] !== 1;
        if (aboveFloor) {
          ctx.fillStyle = '#315762';
          ctx.fillRect(wx, wy, cellSize, Math.max(2, cellSize * 0.12));
        }

        const belowFloor =
          y < maze.rows - 1 && maze.cells[(y + 1) * maze.cols + x] !== 1;
        if (belowFloor) {
          const lipH = Math.max(3, Math.round(cellSize * 0.22));
          ctx.fillStyle = '#13262C';
          ctx.fillRect(wx, wy + cellSize - lipH, cellSize, lipH);
          ctx.fillStyle = '#0C181C';
          ctx.fillRect(wx, wy + cellSize - 2, cellSize, 2);
        }
      }
    }
  }

  return cache;
}

export const MazeCanvas: React.FC<MazeCanvasProps> = ({
  maze,
  phase,
  playerId,
  myRole,
  visibilityMode,
  liveTickRef,
  effectsRef,
  localInputRef,
  onPingCell,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mazeCacheRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedRef = useRef<Map<string, SmoothedPlayer>>(new Map());
  const floatingRef = useRef<FloatingBanner[]>([]);
  const seenEffectsRef = useRef<Set<string>>(new Set());
  const shakeRef = useRef<number>(0);

  const propsRef = useRef({ phase, playerId, myRole, visibilityMode });
  propsRef.current = { phase, playerId, myRole, visibilityMode };

  const layoutRef = useRef<{
    offsetX: number;
    offsetY: number;
    cellSize: number;
    viewW: number;
    viewH: number;
    dpr: number;
  }>({ offsetX: 0, offsetY: 0, cellSize: 32, viewW: 800, viewH: 600, dpr: 1 });

  useEffect(() => {
    smoothedRef.current.clear();
    floatingRef.current = [];
    seenEffectsRef.current.clear();
    shakeRef.current = 0;
  }, [maze]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let animId = 0;
    let lastTime = performance.now();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(200, Math.floor(rect.width));
      const h = Math.max(200, Math.floor(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const pad = 16;
      const cellSize = Math.max(
        10,
        Math.floor(
          Math.min((w - pad * 2) / maze.cols, (h - pad * 2) / maze.rows)
        )
      );
      const boardW = cellSize * maze.cols;
      const boardH = cellSize * maze.rows;
      const offsetX = Math.floor((w - boardW) / 2);
      const offsetY = Math.floor((h - boardH) / 2);

      layoutRef.current = {
        cellSize,
        offsetX,
        offsetY,
        viewW: w,
        viewH: h,
        dpr,
      };
      mazeCacheRef.current = buildStaticMazeCache(
        maze,
        w,
        h,
        dpr,
        offsetX,
        offsetY,
        cellSize
      );
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const render = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animId = requestAnimationFrame(render);
        return;
      }

      const {
        phase: curPhase,
        playerId: curPlayerId,
        myRole: curMyRole,
        visibilityMode: curVisMode,
      } = propsRef.current;
      const { offsetX, offsetY, cellSize, viewW, viewH, dpr } = layoutRef.current;

      for (const ef of effectsRef.current) {
        if (!seenEffectsRef.current.has(ef.id)) {
          seenEffectsRef.current.add(ef.id);
          if (ef.type === 'hero_hit') {
            shakeRef.current = 0.28;
            floatingRef.current.push({
              id: ef.id,
              text: 'УДАР!',
              x: ef.x,
              y: ef.y - 0.5,
              color: '#F59E0B',
              createdAt: now,
            });
          } else if (ef.type === 'pickup_speed') {
            floatingRef.current.push({
              id: ef.id,
              text: 'УСКОРЕНИЕ!',
              x: ef.x,
              y: ef.y - 0.4,
              color: '#0284C7',
              createdAt: now,
            });
          } else if (ef.type === 'pickup_shield') {
            floatingRef.current.push({
              id: ef.id,
              text: '+1 ЖИЗНЬ!',
              x: ef.x,
              y: ef.y - 0.4,
              color: '#D97706',
              createdAt: now,
            });
          } else if (ef.type === 'pickup_freeze') {
            shakeRef.current = 0.16;
            floatingRef.current.push({
              id: ef.id,
              text: 'ЗАМОРОЗКА!',
              x: ef.x,
              y: ef.y - 0.4,
              color: '#4F46E5',
              createdAt: now,
            });
          } else if (ef.type === 'pickup_weapon') {
            floatingRef.current.push({
              id: ef.id,
              text: 'ОРУЖИЕ +1!',
              x: ef.x,
              y: ef.y - 0.4,
              color: '#FBBF24',
              createdAt: now,
            });
          } else if (ef.type === 'guard_killed') {
            shakeRef.current = 0.32;
            floatingRef.current.push({
              id: ef.id,
              text: 'СТРАЖ ПОВЕРЖЕН!',
              x: ef.x,
              y: ef.y - 0.5,
              color: '#EF4444',
              createdAt: now,
            });
          }
        }
      }

      let shakeX = 0;
      let shakeY = 0;
      if (shakeRef.current > 0) {
        shakeRef.current = Math.max(0, shakeRef.current - dt);
        const mag = shakeRef.current * 18;
        shakeX = (Math.random() - 0.5) * mag;
        shakeY = (Math.random() - 0.5) * mag;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      if (shakeX !== 0 || shakeY !== 0) {
        ctx.fillStyle = '#132227';
        ctx.fillRect(0, 0, viewW, viewH);
        ctx.translate(shakeX, shakeY);
      }

      // Draw pre-rendered static maze in 1 draw call
      if (mazeCacheRef.current) {
        ctx.drawImage(mazeCacheRef.current, 0, 0, viewW, viewH);
      }

      const boardW = cellSize * maze.cols;
      const boardH = cellSize * maze.rows;

      // Portals
      if (maze.portals) {
        const drawPortal = (gx: number, gy: number) => {
          const px = offsetX + gx * cellSize;
          const py = offsetY + gy * cellSize;
          const pulse = 0.88 + 0.12 * Math.sin(now * 0.005);
          const r = cellSize * 0.36 * pulse;

          ctx.save();
          ctx.translate(px, py);
          ctx.fillStyle = '#312E81';
          ctx.strokeStyle = '#162328';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.rotate(now * 0.003);
          ctx.strokeStyle = '#C4B5FD';
          ctx.lineWidth = Math.max(2, cellSize * 0.08);
          ctx.setLineDash([cellSize * 0.2, cellSize * 0.14]);
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        };
        drawPortal(maze.portals.ax, maze.portals.ay);
        drawPortal(maze.portals.bx, maze.portals.by);
      }

      // Emerald Exit
      {
        const ex = offsetX + maze.exitPos.x * cellSize;
        const ey = offsetY + maze.exitPos.y * cellSize;
        const pulse = 0.92 + 0.08 * Math.sin(now * 0.006);
        const r = cellSize * 0.44;

        const grad = ctx.createRadialGradient(ex, ey, r * 0.15, ex, ey, r * 2.1);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.45)');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(ex, ey, r * 2.1, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#065F46';
        ctx.strokeStyle = '#162328';
        ctx.lineWidth = Math.max(2, cellSize * 0.07);
        ctx.beginPath();
        ctx.arc(ex, ey, r * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(-now * 0.0022);
        ctx.strokeStyle = '#6EE7B7';
        ctx.lineWidth = Math.max(2, cellSize * 0.06);
        ctx.setLineDash([cellSize * 0.2, cellSize * 0.14]);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.64, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        const labelFont = Math.max(10, Math.round(cellSize * 0.29));
        ctx.font = `800 ${labelFont}px "Manrope", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#162328';
        ctx.strokeText('ВЫХОД', ex, ey - r - 3);
        ctx.fillStyle = '#6EE7B7';
        ctx.fillText('ВЫХОД', ex, ey - r - 3);
      }

      const tick = liveTickRef.current;

      // Pickups (including rare golden weapon coin)
      const pickups = tick?.pickups ?? [];
      for (const item of pickups) {
        const ix = offsetX + item.x * cellSize;
        const bob = Math.sin(now * 0.0055 + item.x * 2) * (cellSize * 0.07);
        const iy = offsetY + item.y * cellSize + bob;
        const isWeapon = item.type === 'weapon';
        const r = cellSize * (isWeapon ? 0.36 : 0.3);

        if (isWeapon) {
          const halo = cellSize * (0.55 + 0.12 * Math.sin(now * 0.008));
          const wGrad = ctx.createRadialGradient(ix, iy, r * 0.2, ix, iy, halo * 1.4);
          wGrad.addColorStop(0, 'rgba(245, 158, 11, 0.55)');
          wGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
          ctx.fillStyle = wGrad;
          ctx.beginPath();
          ctx.arc(ix, iy, halo * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = 'rgba(22, 35, 40, 0.25)';
        ctx.beginPath();
        ctx.ellipse(
          ix,
          offsetY + item.y * cellSize + r * 0.9,
          r * 0.75,
          r * 0.3,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        const bg = isWeapon
          ? '#F59E0B'
          : item.type === 'speed'
          ? '#38BDF8'
          : item.type === 'shield'
          ? '#FDE047'
          : '#818CF8';
        const symbol = isWeapon
          ? '⚔'
          : item.type === 'speed'
          ? '⚡'
          : item.type === 'shield'
          ? '🛡'
          : '❄';

        ctx.fillStyle = bg;
        ctx.strokeStyle = isWeapon ? '#78350F' : '#162328';
        ctx.lineWidth = Math.max(2, cellSize * 0.07);
        ctx.beginPath();
        ctx.arc(ix, iy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = `bold ${Math.max(11, Math.round(cellSize * (isWeapon ? 0.42 : 0.36)))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#162328';
        ctx.fillText(symbol, ix, iy + 1);
      }

      // Visual shockwave effects
      effectsRef.current = effectsRef.current.filter(
        (ef) => now - ef.createdAt < 650
      );
      for (const ef of effectsRef.current) {
        const age = (now - ef.createdAt) / 650;
        const ex = offsetX + ef.x * cellSize;
        const ey = offsetY + ef.y * cellSize;
        const maxR =
          ef.type === 'hero_hit' ||
          ef.type === 'pickup_freeze' ||
          ef.type === 'guard_killed'
            ? cellSize * 3.0
            : cellSize * 1.1;
        const color =
          ef.type === 'guard_killed'
            ? '225, 29, 72'
            : ef.type === 'hero_hit' || ef.type === 'pickup_weapon'
            ? '245, 158, 11'
            : ef.type === 'pickup_freeze'
            ? '79, 70, 229'
            : ef.type === 'portal_warp'
            ? '124, 58, 237'
            : '2, 132, 199';

        ctx.strokeStyle = `rgba(${color}, ${1 - age})`;
        ctx.lineWidth = Math.max(2, cellSize * 0.11 * (1 - age));
        ctx.beginPath();
        ctx.arc(ex, ey, cellSize * 0.25 + maxR * age, 0, Math.PI * 2);
        ctx.stroke();
      }

      const rawPlayers = (tick?.players ?? []).filter((p) => p.alive);
      const meRaw = rawPlayers.find((p) => p.id === curPlayerId);
      const amIAlive = Boolean(meRaw);

      // Radar Echoes (periodic hero clues in fog/asymmetric modes)
      if (
        tick?.echoes &&
        (curMyRole === 'hunter' || curVisMode === 'fog_both' || !amIAlive)
      ) {
        for (const ec of tick.echoes) {
          const ex = offsetX + ec.x * cellSize;
          const ey = offsetY + ec.y * cellSize;
          const wave = (now % 900) / 900;
          ctx.save();
          ctx.strokeStyle = '#D97706';
          ctx.globalAlpha = 0.85 * (1 - wave * 0.6);
          ctx.lineWidth = 2.5;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.arc(ex, ey, cellSize * (0.35 + wave * 1.1), 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.globalAlpha = 0.9;
          ctx.font = `800 ${Math.max(10, Math.round(cellSize * 0.3))}px "Manrope", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#162328';
          ctx.strokeText(`След: ${ec.name}`, ex, ey - cellSize * 0.55);
          ctx.fillStyle = '#FBBF24';
          ctx.fillText(`След: ${ec.name}`, ex, ey - cellSize * 0.55);
          ctx.restore();
        }
      }

      // Tactical Hunter Pings (visible only to Guards and eliminated spectators)
      if (tick?.pings && (curMyRole === 'hunter' || !amIAlive)) {
        for (const pg of tick.pings) {
          const px = offsetX + pg.x * cellSize;
          const py = offsetY + pg.y * cellSize;
          const pulse = (now % 850) / 850;
          ctx.strokeStyle = '#BE123C';
          ctx.globalAlpha = 1 - pulse * 0.65;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(px, py, cellSize * (0.28 + pulse * 0.65), 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;

          ctx.fillStyle = '#BE123C';
          ctx.strokeStyle = '#FAF6EE';
          ctx.lineWidth = 3;
          ctx.font = `800 ${Math.max(12, Math.round(cellSize * 0.42))}px "Manrope", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.strokeText('!', px, py);
          ctx.fillText('!', px, py);
        }
      }

      // Asymmetric visibility filtering
      const players = rawPlayers.filter((p) => {
        if (!amIAlive || !meRaw) return true;
        if (curPhase === 'COUNTDOWN') return true;
        if (p.id === curPlayerId || p.role === curMyRole) return true;
        if (curVisMode === 'all_visible') return true;
        if (curVisMode === 'heroes_see_all' && curMyRole === 'hero') return true;
        const radius =
          curMyRole === 'hero' ? HERO_VISION_RADIUS : HUNTER_VISION_RADIUS;
        return Math.hypot(p.x - meRaw.x, p.y - meRaw.y) <= radius;
      });

      const activeIds = new Set(players.map((p) => p.id));
      for (const id of smoothedRef.current.keys()) {
        if (!activeIds.has(id)) smoothedRef.current.delete(id);
      }

      const sortedPlayers = [...players].sort((a, b) => {
        if (a.role === 'hero' && b.role !== 'hero') return 1;
        if (b.role === 'hero' && a.role !== 'hero') return -1;
        return 0;
      });

      const elapsedSinceTick = tick
        ? Math.min(0.14, Math.max(0, (now - tick.t) / 1000))
        : 0;
      const huntersLocked = (tick?.huntersReleaseIn ?? 0) > 0;
      let mySmoothedPos: { x: number; y: number } | null = null;

      for (const p of sortedPlayers) {
        const isMe = p.id === curPlayerId;
        let sm = smoothedRef.current.get(p.id);
        if (!sm) {
          sm = {
            x: p.x,
            y: p.y,
            vx: p.vx,
            vy: p.vy,
            facingX: 1,
            facingY: 0,
            walkPhase: Math.random() * Math.PI * 2,
            trail: [],
          };
          smoothedRef.current.set(p.id, sm);
        } else if (isMe && curPhase === 'PLAYING') {
          // Local client-side prediction + gentle server reconciliation
          const jump = Math.hypot(p.x - sm.x, p.y - sm.y);
          if (jump > 2.2) {
            // Portal warp or respawn
            sm.x = p.x;
            sm.y = p.y;
            sm.trail = [];
          } else {
            const inp = localInputRef.current;
            const canMoveLocally =
              p.stunTimer <= 0 && !(p.role === 'hunter' && huntersLocked);

            if (canMoveLocally && (Math.abs(inp.dx) > 0.01 || Math.abs(inp.dy) > 0.01)) {
              let speed = p.role === 'hero' ? HERO_BASE_SPEED : HUNTER_BASE_SPEED;
              if (p.dashActive > 0) {
                speed *= p.role === 'hero' ? HERO_DASH_MULT : HUNTER_DASH_MULT;
              }
              if (p.speedBoost > 0) speed *= 1.35;

              sm.vx = inp.dx * speed;
              sm.vy = inp.dy * speed;
              sm.x += sm.vx * dt;
              sm.y += sm.vy * dt;
              resolveMazeCollisions(sm, maze);

              // Gentle drift correction toward host-predicted point
              const serverPred = {
                x: p.x + p.vx * elapsedSinceTick,
                y: p.y + p.vy * elapsedSinceTick,
              };
              resolveMazeCollisions(serverPred, maze);
              const err = Math.hypot(serverPred.x - sm.x, serverPred.y - sm.y);
              if (err > 0.14) {
                const corr = 1 - Math.exp(-6.0 * dt);
                sm.x += (serverPred.x - sm.x) * corr;
                sm.y += (serverPred.y - sm.y) * corr;
              }
            } else {
              sm.vx = p.vx;
              sm.vy = p.vy;
              const blend = 1 - Math.exp(-16 * dt);
              sm.x += (p.x - sm.x) * blend;
              sm.y += (p.y - sm.y) * blend;
            }
          }

          const spd = Math.hypot(sm.vx, sm.vy);
          if (spd > 0.2) {
            sm.facingX = sm.vx / spd;
            sm.facingY = sm.vy / spd;
            sm.walkPhase += dt * spd * 3.4;
          }
        } else {
          // Remote player: wall-aware velocity extrapolation + smooth blending
          const jump = Math.hypot(p.x - sm.x, p.y - sm.y);
          if (jump > 2.5) {
            sm.x = p.x;
            sm.y = p.y;
            sm.trail = [];
          } else {
            const targetPos = {
              x: p.x + p.vx * elapsedSinceTick,
              y: p.y + p.vy * elapsedSinceTick,
            };
            if (Math.abs(p.vx) > 0.01 || Math.abs(p.vy) > 0.01) {
              resolveMazeCollisions(targetPos, maze);
            }
            const blend = 1 - Math.exp(-15 * dt);
            sm.x += (targetPos.x - sm.x) * blend;
            sm.y += (targetPos.y - sm.y) * blend;
          }
          sm.vx = p.vx;
          sm.vy = p.vy;
          const spd = Math.hypot(p.vx, p.vy);
          if (spd > 0.2) {
            sm.facingX = p.vx / spd;
            sm.facingY = p.vy / spd;
            sm.walkPhase += dt * spd * 3.4;
          }
        }

        if (isMe) {
          mySmoothedPos = { x: sm.x, y: sm.y };
        }

        if (p.dashActive > 0 || p.speedBoost > 0) {
          sm.trail.push({ x: sm.x, y: sm.y, alpha: 0.7 });
          if (sm.trail.length > 8) sm.trail.shift();
        }
        for (const t of sm.trail) {
          t.alpha = Math.max(0, t.alpha - dt * 2.5);
        }
        sm.trail = sm.trail.filter((t) => t.alpha > 0.05);

        const moving = Math.hypot(sm.vx, sm.vy) > 0.25;
        const bobY = moving ? Math.abs(Math.sin(sm.walkPhase)) * (cellSize * 0.09) : 0;

        const basePx = offsetX + sm.x * cellSize;
        const basePy = offsetY + sm.y * cellSize;
        const px = basePx;
        const py = basePy - bobY;
        const r = cellSize * 0.31;
        const isHero = p.role === 'hero';

        for (const tr of sm.trail) {
          ctx.fillStyle = isHero ? '#F59E0B' : '#E11D48';
          ctx.globalAlpha = tr.alpha * 0.35;
          ctx.beginPath();
          ctx.arc(
            offsetX + tr.x * cellSize,
            offsetY + tr.y * cellSize,
            r * 0.75,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        ctx.fillStyle = 'rgba(22, 35, 40, 0.28)';
        ctx.beginPath();
        ctx.ellipse(basePx, basePy + r * 0.88, r * 0.85, r * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();

        if (p.invulnTimer > 0 && Math.floor(now / 85) % 2 === 0) {
          ctx.globalAlpha = 0.45;
        }

        if (isHero && p.weaponCharges > 0) {
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(now * 0.005);
          ctx.strokeStyle = '#DC2626';
          ctx.lineWidth = Math.max(2, cellSize * 0.08);
          ctx.setLineDash([cellSize * 0.26, cellSize * 0.14]);
          ctx.beginPath();
          ctx.arc(0, 0, r * 1.48, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        if (isMe) {
          ctx.strokeStyle = '#162328';
          ctx.lineWidth = Math.max(2, cellSize * 0.065);
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(basePx, basePy, r * 1.32, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (isHero) {
          const capeX = px - sm.facingX * r * 0.9;
          const capeY = py - sm.facingY * r * 0.9;
          const perpX = -sm.facingY * r * 0.55;
          const perpY = sm.facingX * r * 0.55;
          ctx.fillStyle = p.weaponCharges > 0 ? '#DC2626' : '#F59E0B';
          ctx.strokeStyle = '#162328';
          ctx.lineWidth = Math.max(1.5, cellSize * 0.05);
          ctx.beginPath();
          ctx.moveTo(px + perpX * 0.6, py + perpY * 0.6);
          ctx.lineTo(capeX + perpX, capeY + perpY);
          ctx.lineTo(capeX - perpX, capeY - perpY);
          ctx.lineTo(px - perpX * 0.6, py - perpY * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        ctx.fillStyle = isHero ? '#FBBF24' : p.color;
        ctx.strokeStyle = '#162328';
        ctx.lineWidth = Math.max(2, cellSize * 0.075);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (!isHero) {
          ctx.strokeStyle = '#E11D48';
          ctx.lineWidth = Math.max(2, cellSize * 0.07);
          ctx.beginPath();
          ctx.arc(px, py, r * 0.78, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (p.stunTimer > 0) {
          ctx.strokeStyle = '#4F46E5';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(px, py, r * 1.35, now * 0.006, now * 0.006 + Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const eyeDist = r * 0.34;
        const ex = px + sm.facingX * eyeDist;
        const ey = py + sm.facingY * eyeDist;
        const perpX = -sm.facingY * (r * 0.23);
        const perpY = sm.facingX * (r * 0.23);
        ctx.fillStyle = '#162328';
        ctx.beginPath();
        ctx.arc(ex + perpX, ey + perpY, Math.max(1.7, r * 0.16), 0, Math.PI * 2);
        ctx.arc(ex - perpX, ey - perpY, Math.max(1.7, r * 0.16), 0, Math.PI * 2);
        ctx.fill();

        if (isHero) {
          const cw = r * 0.9;
          const ch = r * 0.58;
          const cy = py - r - 2;
          ctx.fillStyle = p.weaponCharges > 0 ? '#EF4444' : '#F59E0B';
          ctx.strokeStyle = '#162328';
          ctx.lineWidth = Math.max(1.5, cellSize * 0.05);
          ctx.beginPath();
          ctx.moveTo(px - cw * 0.5, cy);
          ctx.lineTo(px - cw * 0.5, cy - ch);
          ctx.lineTo(px - cw * 0.18, cy - ch * 0.45);
          ctx.lineTo(px, cy - ch * 1.1);
          ctx.lineTo(px + cw * 0.18, cy - ch * 0.45);
          ctx.lineTo(px + cw * 0.5, cy - ch);
          ctx.lineTo(px + cw * 0.5, cy);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        ctx.globalAlpha = 1;

        const fontSize = Math.max(10, Math.min(13, Math.round(cellSize * 0.32)));
        ctx.font = `700 ${fontSize}px "Manrope", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const labelY = isHero ? py - r - r * 0.65 - 5 : py - r - 5;
        const displayName = p.weaponCharges > 0 ? `⚔ ${p.name}` : p.name;
        const textW = ctx.measureText(displayName).width;
        ctx.fillStyle = isMe ? '#162328' : 'rgba(22, 35, 40, 0.85)';
        ctx.fillRect(px - textW / 2 - 5, labelY - fontSize - 2, textW + 10, fontSize + 4);
        ctx.fillStyle = p.weaponCharges > 0 ? '#FCA5A5' : isHero ? '#FDE68A' : '#FAF6EE';
        ctx.fillText(displayName, px, labelY);
      }

      // Soft Lantern Vision Veil when fog applies to local player
      const hasFog =
        amIAlive &&
        mySmoothedPos &&
        ((curVisMode === 'heroes_see_all' && curMyRole === 'hunter') ||
          curVisMode === 'fog_both');

      if (hasFog && mySmoothedPos) {
        const vx = offsetX + mySmoothedPos.x * cellSize;
        const vy = offsetY + mySmoothedPos.y * cellSize;
        const radCells =
          curMyRole === 'hero' ? HERO_VISION_RADIUS : HUNTER_VISION_RADIUS;
        const vr = radCells * cellSize;

        ctx.save();
        ctx.beginPath();
        ctx.rect(offsetX, offsetY, boardW, boardH);
        ctx.arc(vx, vy, vr, 0, Math.PI * 2, true);
        ctx.fillStyle = 'rgba(13, 24, 28, 0.44)';
        ctx.fill('evenodd');

        ctx.strokeStyle = 'rgba(251, 191, 36, 0.38)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(vx, vy, vr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Floating Pop-ups
      floatingRef.current = floatingRef.current.filter(
        (fb) => now - fb.createdAt < 1100
      );
      for (const fb of floatingRef.current) {
        const age = (now - fb.createdAt) / 1100;
        const fx = offsetX + fb.x * cellSize;
        const fy = offsetY + fb.y * cellSize - age * cellSize * 1.1;
        ctx.save();
        ctx.globalAlpha = 1 - Math.pow(age, 1.8);
        ctx.font = `800 ${Math.max(11, Math.round(cellSize * 0.34))}px "Manrope", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#162328';
        ctx.strokeText(fb.text, fx, fy);
        ctx.fillStyle = fb.color;
        ctx.fillText(fb.text, fx, fy);
        ctx.restore();
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, [maze, liveTickRef, effectsRef, localInputRef]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (myRole !== 'hunter') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { offsetX, offsetY, cellSize } = layoutRef.current;
    const gx = (cx - offsetX) / cellSize;
    const gy = (cy - offsetY) / cellSize;
    if (gx >= 0 && gx < maze.cols && gy >= 0 && gy < maze.rows) {
      onPingCell(gx, gy);
    }
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative select-none overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className={`block w-full h-full ${
          myRole === 'hunter' ? 'cursor-crosshair' : 'cursor-default'
        }`}
      />
    </div>
  );
};
