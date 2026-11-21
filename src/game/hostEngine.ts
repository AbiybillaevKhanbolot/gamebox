import type {
  ChatMessage,
  ClientMessage,
  GameEvent,
  GamePhase,
  MazeData,
  PickupItem,
  PickupType,
  PlayerPublicInfo,
  PlayerRole,
  PlayerTickState,
  RadarEcho,
  RoomPublicState,
  RoomSettings,
  RoundResult,
  ServerMessage,
  TacticalPing,
} from '../../shared/types.ts';
import {
  HERO_BASE_SPEED,
  HERO_DASH_MULT,
  HUNTER_BASE_SPEED,
  HUNTER_DASH_MULT,
  MAX_PLAYERS_PER_ROOM,
  PLAYER_COLORS,
} from '../../shared/types.ts';
import { generateMaze } from './mazeGenerator.ts';
import { resolveMazeCollisions } from './physics.ts';

export interface HostTransport {
  onHostMessage: (msg: ServerMessage) => void;
  onSendToClient: (clientId: string, msg: ServerMessage) => void;
  onBroadcast: (msg: ServerMessage) => void;
}

interface InternalPlayer {
  id: string;
  name: string;
  color: string;
  role: PlayerRole;
  isHost: boolean;
  connected: boolean;
  alive: boolean;
  lives: number;
  maxLives: number;
  weaponCharges: number;
  clientId: string | null;
  score: number;
  catches: number;
  escapes: number;
  kills: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  inputDx: number;
  inputDy: number;
  dashQueued: boolean;
  attackQueued: boolean;
  dashCooldown: number;
  dashActive: number;
  speedBoost: number;
  invulnTimer: number;
  stunTimer: number;
  portalCooldown: number;
  lastSeenAt: number;
}

const HERO_DASH_DURATION = 0.65;
const HUNTER_DASH_DURATION = 0.55;
const HERO_DASH_COOLDOWN = 5.0;
const HUNTER_DASH_COOLDOWN = 8.5;

function randomId(len = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export class HostGameEngine {
  public readonly roomCode: string;
  public readonly hostPlayerId: string;

  private phase: GamePhase = 'LOBBY';
  private roundNumber = 0;
  private heroRotationIndex = 0;
  private selectedHeroIds: string[] = [];
  private settings: RoomSettings = {
    mazeSize: 'large',
    roundDuration: 90,
    heroCount: 'auto',
    heroSelection: 'rotate',
    heroLives: 'auto',
    visibilityMode: 'heroes_see_all',
  };
  private players: InternalPlayer[] = [];
  private maze: MazeData | null = null;
  private heroIds: string[] = [];
  private timeLeft = 90;
  private countdown = 3;
  private lastCountdownWhole = 3;
  private huntersReleaseIn = 2;
  private huntersWereReleased = false;
  private pickups: PickupItem[] = [];
  private pickupSpawnTimer = 8;
  private weaponSpawnTimer = 12;
  private echoTimer = 10;
  private pings: TacticalPing[] = [];
  private echoes: RadarEcho[] = [];
  private lastResult: RoundResult | null = null;
  private chat: ChatMessage[] = [];

  private clientToPlayerId = new Map<string, string>();
  private transport: HostTransport;
  private tickInterval: ReturnType<typeof setInterval>;
  private pruneInterval: ReturnType<typeof setInterval>;
  private lastStepTime = performance.now();
  private simClockMs = 0;
  private stepCounter = 0;
  private pendingEvents: GameEvent[] = [];

  constructor(
    roomCode: string,
    hostName: string,
    transport: HostTransport
  ) {
    this.roomCode = roomCode;
    this.hostPlayerId = randomId(10);
    this.transport = transport;

    const hostPlayer: InternalPlayer = {
      id: this.hostPlayerId,
      name: hostName.trim().slice(0, 18) || 'Ведущий',
      color: PLAYER_COLORS[0],
      role: 'hunter',
      isHost: true,
      connected: true,
      alive: true,
      lives: 2,
      maxLives: 2,
      weaponCharges: 0,
      clientId: null,
      score: 0,
      catches: 0,
      escapes: 0,
      kills: 0,
      x: 1.5,
      y: 1.5,
      vx: 0,
      vy: 0,
      inputDx: 0,
      inputDy: 0,
      dashQueued: false,
      attackQueued: false,
      dashCooldown: 0,
      dashActive: 0,
      speedBoost: 0,
      invulnTimer: 0,
      stunTimer: 0,
      portalCooldown: 0,
      lastSeenAt: Date.now(),
    };
    this.players.push(hostPlayer);

    this.transport.onHostMessage({
      type: 'joined',
      roomCode: this.roomCode,
      playerId: this.hostPlayerId,
      state: this.toPublicState(),
    });

    this.lastStepTime = performance.now();
    this.tickInterval = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.08, Math.max(0.005, (now - this.lastStepTime) / 1000));
      this.lastStepTime = now;
      if (this.phase === 'COUNTDOWN' || this.phase === 'PLAYING') {
        this.simClockMs += dt * 1000;
        this.step(dt);
      }
    }, 25);

    this.pruneInterval = setInterval(() => {
      const now = Date.now();
      for (const p of [...this.players]) {
        if (!p.isHost && p.connected && now - p.lastSeenAt > 12000) {
          this.handlePlayerDisconnect(p.id);
        }
      }
    }, 3000);
  }

  public dispose(): void {
    clearInterval(this.tickInterval);
    clearInterval(this.pruneInterval);
    this.broadcast({
      type: 'room_closed',
      message: 'Ведущий закрыл комнату',
    });
    this.clientToPlayerId.clear();
  }

  public handleHostAction(msg: ClientMessage): void {
    this.processPlayerAction(this.hostPlayerId, msg);
  }

  public handleRemoteMessage(clientId: string, msg: ClientMessage): void {
    if (msg.type === 'join_room') {
      this.handleRemoteJoin(clientId, msg);
      return;
    }

    const pid = this.clientToPlayerId.get(clientId);
    if (!pid) return;
    const player = this.players.find((p) => p.id === pid);
    if (!player) return;

    if (msg.type === 'leave_room') {
      this.handleClientDisconnect(clientId);
      return;
    }

    player.lastSeenAt = Date.now();
    if (msg.type === 'heartbeat') return;

    this.processPlayerAction(pid, msg);
  }

  public handleClientDisconnect(clientId: string): void {
    const pid = this.clientToPlayerId.get(clientId);
    this.clientToPlayerId.delete(clientId);
    if (pid) {
      this.handlePlayerDisconnect(pid);
    }
  }

  private handleRemoteJoin(
    clientId: string,
    msg: Extract<ClientMessage, { type: 'join_room' }>
  ): void {
    const cleanName = String(msg.name || '').trim().slice(0, 18);
    if (!cleanName) {
      this.transport.onSendToClient(clientId, {
        type: 'error',
        message: 'Введите ваше имя',
      });
      return;
    }

    // Reconnect by existing playerId or same clientId
    const existingByClientId = this.clientToPlayerId.get(clientId);
    const reconnectTargetId = msg.playerId || existingByClientId;
    if (reconnectTargetId) {
      const existing = this.players.find((p) => p.id === reconnectTargetId);
      if (existing && !existing.isHost) {
        if (existing.clientId && existing.clientId !== clientId) {
          this.clientToPlayerId.delete(existing.clientId);
        }
        existing.clientId = clientId;
        existing.connected = true;
        existing.name = cleanName;
        existing.lastSeenAt = Date.now();
        this.clientToPlayerId.set(clientId, existing.id);
        this.transport.onSendToClient(clientId, {
          type: 'joined',
          roomCode: this.roomCode,
          playerId: existing.id,
          state: this.toPublicState(),
        });
        this.broadcastRoomState();
        return;
      }
    }

    const activeCount = this.players.filter((p) => p.connected).length;
    if (activeCount >= MAX_PLAYERS_PER_ROOM) {
      this.transport.onSendToClient(clientId, {
        type: 'error',
        message: `Комната заполнена (максимум ${MAX_PLAYERS_PER_ROOM} игроков)`,
      });
      return;
    }

    const usedColors = new Set(this.players.map((p) => p.color));
    const availableColor =
      PLAYER_COLORS.find((c) => !usedColors.has(c)) ||
      PLAYER_COLORS[this.players.length % PLAYER_COLORS.length];

    const spawnPos =
      this.maze && this.phase !== 'LOBBY'
        ? this.maze.hunterSpawns[this.players.length % this.maze.hunterSpawns.length]
        : { x: 1.5, y: 1.5 };

    const newPlayer: InternalPlayer = {
      id: randomId(10),
      name: cleanName,
      color: availableColor,
      role: 'hunter',
      isHost: false,
      connected: true,
      alive: this.phase === 'LOBBY',
      lives: 1,
      maxLives: 1,
      weaponCharges: 0,
      clientId,
      score: 0,
      catches: 0,
      escapes: 0,
      kills: 0,
      x: spawnPos.x,
      y: spawnPos.y,
      vx: 0,
      vy: 0,
      inputDx: 0,
      inputDy: 0,
      dashQueued: false,
      attackQueued: false,
      dashCooldown: 0,
      dashActive: 0,
      speedBoost: 0,
      invulnTimer: 0,
      stunTimer: 0,
      portalCooldown: 0,
      lastSeenAt: Date.now(),
    };

    this.players.push(newPlayer);
    this.clientToPlayerId.set(clientId, newPlayer.id);

    this.transport.onSendToClient(clientId, {
      type: 'joined',
      roomCode: this.roomCode,
      playerId: newPlayer.id,
      state: this.toPublicState(),
    });

    this.addSystemChat(`${cleanName} присоединился к игре`);
    this.broadcastRoomState();
  }

  private handlePlayerDisconnect(playerId: string): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || !player.connected) return;

    if (player.clientId) {
      this.clientToPlayerId.delete(player.clientId);
      player.clientId = null;
    }
    player.connected = false;
    player.alive = false;
    player.inputDx = 0;
    player.inputDy = 0;

    this.addSystemChat(`${player.name} отключился`);

    if (this.phase === 'LOBBY' || this.phase === 'ROUND_SUMMARY') {
      this.players = this.players.filter((p) => p.connected);
      this.selectedHeroIds = this.selectedHeroIds.filter((id) =>
        this.players.some((p) => p.id === id)
      );
      this.broadcastRoomState();
      return;
    }

    const aliveHeroes = this.players.filter(
      (p) => p.connected && p.role === 'hero' && p.alive
    );
    if (aliveHeroes.length === 0) {
      this.finishRound('hunters', 'hero_left');
      return;
    }

    const aliveHunters = this.players.filter(
      (p) => p.connected && p.role === 'hunter' && p.alive
    );
    if (aliveHunters.length === 0) {
      this.finishRound('hero', 'hunters_eliminated');
      return;
    }

    this.broadcastRoomState();
  }

  private processPlayerAction(playerId: string, msg: ClientMessage): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;

    switch (msg.type) {
      case 'update_settings': {
        if (!player.isHost || this.phase !== 'LOBBY') return;
        if (msg.settings) {
          if (msg.settings.mazeSize) this.settings.mazeSize = msg.settings.mazeSize;
          if (msg.settings.roundDuration)
            this.settings.roundDuration = msg.settings.roundDuration;
          if (msg.settings.heroCount !== undefined)
            this.settings.heroCount = msg.settings.heroCount;
          if (msg.settings.heroSelection)
            this.settings.heroSelection = msg.settings.heroSelection;
          if (msg.settings.heroLives !== undefined)
            this.settings.heroLives = msg.settings.heroLives;
          if (msg.settings.visibilityMode)
            this.settings.visibilityMode = msg.settings.visibilityMode;
        }
        if (msg.toggleHeroId) {
          if (this.selectedHeroIds.includes(msg.toggleHeroId)) {
            this.selectedHeroIds = this.selectedHeroIds.filter(
              (id) => id !== msg.toggleHeroId
            );
          } else {
            this.selectedHeroIds = [...this.selectedHeroIds, msg.toggleHeroId].slice(
              -2
            );
          }
        }
        this.broadcastRoomState();
        break;
      }

      case 'start_game':
      case 'next_round': {
        if (!player.isHost) return;
        if (this.phase !== 'LOBBY' && this.phase !== 'ROUND_SUMMARY') return;
        const connectedPlayers = this.players.filter((p) => p.connected);
        if (connectedPlayers.length < 2) {
          this.transport.onHostMessage({
            type: 'error',
            message: 'Для начала нужно минимум 2 игрока',
          });
          return;
        }
        this.startRound();
        break;
      }

      case 'return_lobby': {
        if (!player.isHost) return;
        this.phase = 'LOBBY';
        this.maze = null;
        this.pickups = [];
        this.pings = [];
        this.echoes = [];
        this.players = this.players.filter((p) => p.connected);
        for (const p of this.players) p.alive = true;
        this.broadcastRoomState();
        break;
      }

      case 'input': {
        if (this.phase !== 'PLAYING' && this.phase !== 'COUNTDOWN') return;
        if (!player.alive) return;
        const len = Math.hypot(msg.dx, msg.dy);
        if (len > 0.01) {
          player.inputDx = msg.dx / Math.max(1, len);
          player.inputDy = msg.dy / Math.max(1, len);
        } else {
          player.inputDx = 0;
          player.inputDy = 0;
        }
        if (msg.dash && this.phase === 'PLAYING') {
          player.dashQueued = true;
        }
        if (msg.attack && this.phase === 'PLAYING') {
          player.attackQueued = true;
        }
        break;
      }

      case 'ping_cell': {
        if (this.phase !== 'PLAYING' && this.phase !== 'COUNTDOWN') return;
        if (player.role !== 'hunter' || !this.maze) return;
        const cx =
          Math.max(1, Math.min(this.maze.cols - 2, Math.floor(msg.x))) + 0.5;
        const cy =
          Math.max(1, Math.min(this.maze.rows - 2, Math.floor(msg.y))) + 0.5;
        this.pings = this.pings.filter((pg) => pg.playerName !== player.name);
        this.pings.push({
          id: randomId(6),
          x: cx,
          y: cy,
          playerName: player.name,
          color: player.color,
          expiresAt: Date.now() + 4500,
        });
        break;
      }

      case 'chat': {
        const cleanText = String(msg.text || '').trim().slice(0, 160);
        if (!cleanText) return;
        const chatMsg: ChatMessage = {
          id: randomId(8),
          senderName: player.name,
          senderColor: player.color,
          text: cleanText,
          timestamp: Date.now(),
        };
        this.chat.push(chatMsg);
        if (this.chat.length > 60) this.chat.shift();
        this.broadcast({ type: 'chat_message', msg: chatMsg });
        break;
      }
    }
  }

  private getTargetHeroCount(totalPlayers: number): number {
    if (totalPlayers <= 2) return 1;
    if (this.settings.heroCount === 1) return 1;
    if (this.settings.heroCount === 2) return Math.min(2, totalPlayers - 1);
    return totalPlayers >= 4 ? 2 : 1;
  }

  private startRound(): void {
    this.players = this.players.filter((p) => p.connected);
    const connected = this.players;
    this.roundNumber += 1;

    const desiredHeroes = this.getTargetHeroCount(connected.length);
    let chosenHeroes: InternalPlayer[] = [];

    if (this.settings.heroSelection === 'host_pick') {
      const validPicked = this.selectedHeroIds
        .map((id) => connected.find((p) => p.id === id))
        .filter((p): p is InternalPlayer => Boolean(p));
      chosenHeroes = validPicked.slice(0, desiredHeroes);
    } else if (this.settings.heroSelection === 'random') {
      const pool = [...connected].sort(() => Math.random() - 0.5);
      chosenHeroes = pool.slice(0, desiredHeroes);
    } else {
      for (let i = 0; i < desiredHeroes; i++) {
        const candidate =
          connected[(this.heroRotationIndex + i) % connected.length];
        if (!chosenHeroes.some((h) => h.id === candidate.id)) {
          chosenHeroes.push(candidate);
        }
      }
      this.heroRotationIndex = (this.heroRotationIndex + desiredHeroes) % connected.length;
    }

    while (chosenHeroes.length < desiredHeroes) {
      const next = connected.find(
        (p) => !chosenHeroes.some((h) => h.id === p.id)
      );
      if (!next) break;
      chosenHeroes.push(next);
    }

    this.heroIds = chosenHeroes.map((h) => h.id);
    const maze = generateMaze(this.settings.mazeSize);
    this.maze = maze;

    const hunterCount = connected.length - chosenHeroes.length;
    let lives = 2;
    if (this.settings.heroLives === 'auto') {
      if (hunterCount <= 2) lives = 1;
      else if (hunterCount <= 5) lives = 2;
      else lives = 3;
    } else {
      lives = this.settings.heroLives;
    }

    let heroIdx = 0;
    let hunterIdx = 0;
    for (const p of connected) {
      p.alive = true;
      p.weaponCharges = 0;
      p.vx = 0;
      p.vy = 0;
      p.inputDx = 0;
      p.inputDy = 0;
      p.dashQueued = false;
      p.attackQueued = false;
      p.dashCooldown = 0;
      p.dashActive = 0;
      p.speedBoost = 0;
      p.invulnTimer = 0;
      p.stunTimer = 0;
      p.portalCooldown = 0;

      if (this.heroIds.includes(p.id)) {
        p.role = 'hero';
        p.lives = lives;
        p.maxLives = lives;
        const sp = maze.heroSpawns[heroIdx % maze.heroSpawns.length];
        p.x = sp.x;
        p.y = sp.y;
        heroIdx++;
      } else {
        p.role = 'hunter';
        p.lives = 1;
        p.maxLives = 1;
        const sp = maze.hunterSpawns[hunterIdx % maze.hunterSpawns.length];
        p.x = sp.x;
        p.y = sp.y;
        hunterIdx++;
      }
    }

    this.phase = 'COUNTDOWN';
    this.countdown = 3.0;
    this.lastCountdownWhole = 3;
    this.timeLeft = this.settings.roundDuration;
    this.huntersReleaseIn = 2.0;
    this.huntersWereReleased = false;
    this.pings = [];
    this.echoes = [];
    this.lastResult = null;
    this.pickupSpawnTimer = 6.5;
    this.weaponSpawnTimer = 11.0;
    this.echoTimer = 9.0;
    this.pendingEvents = [];
    this.stepCounter = 0;
    this.pickups = this.spawnInitialPickups(maze);
    this.lastStepTime = performance.now();

    const heroNames = chosenHeroes.map((h) => h.name).join(' и ');
    this.addSystemChat(
      `Раунд ${this.roundNumber}: ${
        chosenHeroes.length > 1 ? 'Герои' : 'Герой'
      } — ${heroNames}!`
    );
    this.broadcastRoomState();
  }

  private spawnInitialPickups(maze: MazeData): PickupItem[] {
    const types: PickupType[] = ['speed', 'freeze', 'speed', 'shield'];
    const items: PickupItem[] = [];
    for (let i = 0; i < 4; i++) {
      const pos = this.findRandomFloorPos(maze, items);
      if (pos) {
        items.push({
          id: randomId(6),
          type: types[i % types.length],
          x: pos.x,
          y: pos.y,
        });
      }
    }
    return items;
  }

  private findRandomFloorPos(
    maze: MazeData,
    existingPickups: PickupItem[]
  ): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 80; attempt++) {
      const cx = 1 + Math.floor(Math.random() * (maze.cols - 2));
      const cy = 1 + Math.floor(Math.random() * (maze.rows - 2));
      const cell = maze.cells[cy * maze.cols + cx];
      if (cell !== 0) continue;
      const x = cx + 0.5;
      const y = cy + 0.5;
      if (
        maze.heroSpawns.some((hs) => Math.hypot(x - hs.x, y - hs.y) < 3.5)
      ) {
        continue;
      }
      if (Math.hypot(x - maze.exitPos.x, y - maze.exitPos.y) < 2.8) continue;
      if (existingPickups.some((p) => Math.hypot(p.x - x, p.y - y) < 3.5)) {
        continue;
      }
      return { x, y };
    }
    return null;
  }

  private step(dt: number): void {
    const maze = this.maze;
    if (!maze) return;

    const events: GameEvent[] = [];

    if (this.phase === 'COUNTDOWN') {
      this.countdown -= dt;
      const whole = Math.ceil(this.countdown);
      if (whole < this.lastCountdownWhole && whole >= 1) {
        this.lastCountdownWhole = whole;
        events.push({ type: 'countdown_tick', label: String(whole) });
      }
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = 'PLAYING';
        events.push({ type: 'round_start' });
        this.broadcastRoomState();
      }
      this.emitTick(events);
      return;
    }

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.huntersReleaseIn > 0) {
      this.huntersReleaseIn = Math.max(0, this.huntersReleaseIn - dt);
      if (this.huntersReleaseIn === 0 && !this.huntersWereReleased) {
        this.huntersWereReleased = true;
        events.push({ type: 'hunters_released' });
      }
    }

    const now = Date.now();
    this.pings = this.pings.filter((pg) => pg.expiresAt > now);
    this.echoes = this.echoes.filter((ec) => ec.expiresAt > now);

    if (this.settings.visibilityMode !== 'all_visible') {
      this.echoTimer -= dt;
      if (this.echoTimer <= 0) {
        this.echoTimer = 10.0;
        for (const h of this.players) {
          if (h.connected && h.role === 'hero' && h.alive) {
            this.echoes.push({
              id: randomId(6),
              x: h.x,
              y: h.y,
              name: h.name,
              expiresAt: now + 2200,
            });
          }
        }
      }
    }

    this.pickupSpawnTimer -= dt;
    if (this.pickupSpawnTimer <= 0) {
      this.pickupSpawnTimer = 10.5;
      const normalCount = this.pickups.filter((p) => p.type !== 'weapon').length;
      if (normalCount < 4) {
        const pool: PickupType[] = ['speed', 'freeze', 'shield'];
        const chosenType = pool[Math.floor(Math.random() * pool.length)];
        const pos = this.findRandomFloorPos(maze, this.pickups);
        if (pos) {
          this.pickups.push({
            id: randomId(6),
            type: chosenType,
            x: pos.x,
            y: pos.y,
          });
        }
      }
    }

    const hasWeaponCoin = this.pickups.some((p) => p.type === 'weapon');
    if (!hasWeaponCoin) {
      this.weaponSpawnTimer -= dt;
      if (this.weaponSpawnTimer <= 0) {
        this.weaponSpawnTimer = 22.0;
        const pos = this.findRandomFloorPos(maze, this.pickups);
        if (pos) {
          this.pickups.push({
            id: randomId(6),
            type: 'weapon',
            x: pos.x,
            y: pos.y,
          });
        }
      }
    }

    for (const p of this.players) {
      if (!p.connected || !p.alive) continue;

      if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);
      if (p.dashActive > 0) p.dashActive = Math.max(0, p.dashActive - dt);
      if (p.speedBoost > 0) p.speedBoost = Math.max(0, p.speedBoost - dt);
      if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
      if (p.stunTimer > 0) p.stunTimer = Math.max(0, p.stunTimer - dt);
      if (p.portalCooldown > 0) p.portalCooldown = Math.max(0, p.portalCooldown - dt);

      if (p.role === 'hunter' && this.huntersReleaseIn > 0) {
        p.vx = 0;
        p.vy = 0;
        p.dashQueued = false;
        p.attackQueued = false;
        continue;
      }

      if (p.stunTimer > 0) {
        p.vx = 0;
        p.vy = 0;
        p.dashQueued = false;
        p.attackQueued = false;
        continue;
      }

      if (p.dashQueued) {
        p.dashQueued = false;
        if (p.dashCooldown <= 0) {
          p.dashActive = p.role === 'hero' ? HERO_DASH_DURATION : HUNTER_DASH_DURATION;
          p.dashCooldown = p.role === 'hero' ? HERO_DASH_COOLDOWN : HUNTER_DASH_COOLDOWN;
          events.push({ type: 'dash', x: p.x, y: p.y, playerId: p.id });
        }
      }

      if (p.attackQueued) {
        p.attackQueued = false;
        if (p.role === 'hero' && p.weaponCharges > 0) {
          let closestGuard: InternalPlayer | null = null;
          let bestDist = 1.65;
          for (const g of this.players) {
            if (!g.connected || !g.alive || g.role !== 'hunter') continue;
            const d = Math.hypot(g.x - p.x, g.y - p.y);
            if (d < bestDist) {
              bestDist = d;
              closestGuard = g;
            }
          }
          if (closestGuard) {
            this.slayGuard(p, closestGuard, events);
          }
        }
      }

      let speed = p.role === 'hero' ? HERO_BASE_SPEED : HUNTER_BASE_SPEED;
      if (p.dashActive > 0) {
        speed *= p.role === 'hero' ? HERO_DASH_MULT : HUNTER_DASH_MULT;
      }
      if (p.speedBoost > 0) {
        speed *= 1.35;
      }

      const targetVx = p.inputDx * speed;
      const targetVy = p.inputDy * speed;
      p.vx = targetVx;
      p.vy = targetVy;

      if (Math.abs(targetVx) > 0.001 || Math.abs(targetVy) > 0.001) {
        p.x += targetVx * dt;
        p.y += targetVy * dt;
        resolveMazeCollisions(p, maze);
      }

      if (maze.portals && p.portalCooldown <= 0) {
        const dA = Math.hypot(p.x - maze.portals.ax, p.y - maze.portals.ay);
        const dB = Math.hypot(p.x - maze.portals.bx, p.y - maze.portals.by);
        if (dA < 0.42) {
          p.x = maze.portals.bx;
          p.y = maze.portals.by;
          p.portalCooldown = 3.5;
          events.push({ type: 'portal_warp', x: p.x, y: p.y, playerId: p.id });
        } else if (dB < 0.42) {
          p.x = maze.portals.ax;
          p.y = maze.portals.ay;
          p.portalCooldown = 3.5;
          events.push({ type: 'portal_warp', x: p.x, y: p.y, playerId: p.id });
        }
      }
    }

    const aliveHeroes = this.players.filter(
      (p) => p.connected && p.role === 'hero' && p.alive
    );
    if (aliveHeroes.length === 0) {
      this.finishRound('hunters', 'caught');
      return;
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const item = this.pickups[i];
      for (const p of this.players) {
        if (!p.connected || !p.alive) continue;
        if (item.type !== 'speed' && p.role !== 'hero') continue;
        if (item.type === 'shield' && p.lives >= 3) continue;
        if (item.type === 'weapon' && p.weaponCharges >= 2) continue;

        if (Math.hypot(p.x - item.x, p.y - item.y) < 0.56) {
          if (item.type === 'speed') {
            p.speedBoost = 4.5;
            events.push({ type: 'pickup_speed', x: item.x, y: item.y, playerId: p.id });
          } else if (item.type === 'shield') {
            p.lives = Math.min(3, p.lives + 1);
            p.maxLives = Math.max(p.maxLives, p.lives);
            events.push({ type: 'pickup_shield', x: item.x, y: item.y, playerId: p.id });
          } else if (item.type === 'freeze') {
            for (const other of this.players) {
              if (other.role === 'hunter' && other.alive) {
                other.stunTimer = Math.max(other.stunTimer, 2.2);
              }
            }
            events.push({ type: 'pickup_freeze', x: item.x, y: item.y, playerId: p.id });
          } else if (item.type === 'weapon') {
            p.weaponCharges += 1;
            events.push({ type: 'pickup_weapon', x: item.x, y: item.y, playerId: p.id });
            this.addSystemChat(`${p.name} подобрал монету-оружие!`);
          }
          this.pickups.splice(i, 1);
          break;
        }
      }
    }

    for (const hero of aliveHeroes) {
      if (Math.hypot(hero.x - maze.exitPos.x, hero.y - maze.exitPos.y) < 0.52) {
        this.finishRound('hero', 'escaped', undefined, hero);
        return;
      }
    }

    if (this.huntersReleaseIn <= 0) {
      for (const hero of aliveHeroes) {
        for (const hunter of this.players) {
          if (!hunter.connected || !hunter.alive || hunter.role !== 'hunter') {
            continue;
          }
          const dist = Math.hypot(hunter.x - hero.x, hunter.y - hero.y);

          if (hero.weaponCharges > 0 && dist < 0.62) {
            this.slayGuard(hero, hunter, events);
            const remainingGuards = this.players.filter(
              (p) => p.connected && p.alive && p.role === 'hunter'
            );
            if (remainingGuards.length === 0) {
              this.finishRound('hero', 'hunters_eliminated', undefined, hero);
              return;
            }
            continue;
          }

          if (hunter.stunTimer <= 0 && hero.invulnTimer <= 0 && dist < 0.52) {
            hero.lives -= 1;
            if (hero.lives <= 0) {
              hero.alive = false;
              hunter.catches += 1;
              hunter.score += 40;
              this.addSystemChat(`${hunter.name} поймал Героя ${hero.name}!`);
              events.push({ type: 'hero_hit', x: hero.x, y: hero.y, playerId: hero.id });

              const stillAliveHeroes = this.players.filter(
                (p) => p.connected && p.role === 'hero' && p.alive
              );
              if (stillAliveHeroes.length === 0) {
                this.finishRound('hunters', 'caught', hunter);
                return;
              }
            } else {
              hero.invulnTimer = 2.2;
              hero.speedBoost = Math.max(hero.speedBoost, 1.8);
              for (const h of this.players) {
                if (h.role === 'hunter' && h.alive && Math.hypot(h.x - hero.x, h.y - hero.y) < 3.6) {
                  h.stunTimer = 1.5;
                }
              }
              events.push({ type: 'hero_hit', x: hero.x, y: hero.y, playerId: hero.id });
            }
            break;
          }
        }
      }
    }

    if (this.timeLeft <= 0) {
      this.finishRound('hunters', 'timeout');
      return;
    }

    this.emitTick(events);
  }

  private slayGuard(
    hero: InternalPlayer,
    guard: InternalPlayer,
    events: GameEvent[]
  ): void {
    guard.alive = false;
    guard.vx = 0;
    guard.vy = 0;
    hero.weaponCharges = Math.max(0, hero.weaponCharges - 1);
    hero.kills += 1;
    hero.score += 80;
    events.push({
      type: 'guard_killed',
      x: guard.x,
      y: guard.y,
      playerId: guard.id,
    });
    this.addSystemChat(`Герой ${hero.name} поверг стража ${guard.name}!`);
  }

  private toTickState(p: InternalPlayer): PlayerTickState {
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      role: p.role,
      alive: p.alive,
      lives: p.lives,
      maxLives: p.maxLives,
      weaponCharges: p.weaponCharges,
      x: Math.round(p.x * 1000) / 1000,
      y: Math.round(p.y * 1000) / 1000,
      vx: Math.round(p.vx * 100) / 100,
      vy: Math.round(p.vy * 100) / 100,
      dashCooldown: Math.round(p.dashCooldown * 10) / 10,
      dashMaxCooldown: p.role === 'hero' ? HERO_DASH_COOLDOWN : HUNTER_DASH_COOLDOWN,
      dashActive: Math.round(p.dashActive * 10) / 10,
      speedBoost: Math.round(p.speedBoost * 10) / 10,
      invulnTimer: Math.round(p.invulnTimer * 10) / 10,
      stunTimer: Math.round(p.stunTimer * 10) / 10,
      score: p.score,
    };
  }

  private emitTick(events: GameEvent[]): void {
    const connectedAlive = this.players.filter((p) => p.connected && p.alive);
    const tickPlayers = connectedAlive.map((p) => this.toTickState(p));
    const baseTick = {
      type: 'tick' as const,
      t: Math.round(this.simClockMs),
      phase: this.phase,
      timeLeft: Math.round(this.timeLeft * 10) / 10,
      countdown: Math.round(this.countdown * 10) / 10,
      huntersReleaseIn: Math.round(this.huntersReleaseIn * 10) / 10,
      players: tickPlayers,
      pickups: this.pickups,
      pings: this.pings,
      echoes: this.echoes,
    };

    // Host receives full 40 Hz ticks locally
    this.transport.onHostMessage({ ...baseTick, events });

    // Guests receive steady 20 Hz over MQTT (every 2nd step, or immediately on events)
    if (events.length > 0) {
      this.pendingEvents.push(...events);
    }
    this.stepCounter += 1;
    if (this.pendingEvents.length === 0 && this.stepCounter % 2 !== 0) {
      return;
    }
    const flushedEvents = this.pendingEvents;
    this.pendingEvents = [];

    this.transport.onBroadcast({ ...baseTick, events: flushedEvents });
  }

  private finishRound(
    winner: 'hero' | 'hunters',
    reason: RoundResult['reason'],
    catcher?: InternalPlayer,
    escapedHero?: InternalPlayer
  ): void {
    this.phase = 'ROUND_SUMMARY';
    const elapsed = Math.max(
      1,
      Math.round(this.settings.roundDuration - this.timeLeft)
    );
    const heroes = this.players.filter((p) => this.heroIds.includes(p.id));
    const pointsAwarded: RoundResult['pointsAwarded'] = [];

    for (const p of this.players) {
      let delta = 0;
      if (this.heroIds.includes(p.id)) {
        if (winner === 'hero') {
          delta =
            (escapedHero && escapedHero.id === p.id ? 130 : 95) +
            Math.round(this.timeLeft * 1.2);
          p.escapes += 1;
        } else {
          delta = Math.min(45, Math.floor(elapsed * 0.5));
        }
      } else {
        if (winner === 'hunters') {
          delta = catcher && catcher.id === p.id ? 110 : 65;
        } else {
          delta = 15;
        }
      }
      p.score += delta;
      pointsAwarded.push({
        playerId: p.id,
        name: p.name,
        role: p.role,
        delta,
        total: p.score,
      });
    }

    pointsAwarded.sort((a, b) => b.total - a.total);

    const heroNames = heroes.map((h) => h.name);
    this.lastResult = {
      winner,
      reason,
      heroNames,
      escapedHeroName: escapedHero?.name,
      catcherName: catcher?.name,
      elapsedSeconds: elapsed,
      pointsAwarded,
    };

    const summaryText =
      winner === 'hero'
        ? reason === 'hunters_eliminated'
          ? `Герои победили, устранив всех стражей!`
          : `Герой ${escapedHero?.name || ''} добрался до выхода за ${elapsed}с!`
        : reason === 'timeout'
        ? `Время вышло! Стражи удержали лабиринт.`
        : catcher
        ? `Страж ${catcher.name} поймал последнего Героя!`
        : `Раунд завершён.`;

    this.addSystemChat(summaryText);
    this.broadcastRoomState();
  }

  private addSystemChat(text: string): void {
    const msg: ChatMessage = {
      id: randomId(8),
      senderName: 'Система',
      senderColor: '#94A3B8',
      text,
      timestamp: Date.now(),
      system: true,
    };
    this.chat.push(msg);
    if (this.chat.length > 60) this.chat.shift();
    this.broadcast({ type: 'chat_message', msg });
  }

  private broadcast(payload: ServerMessage): void {
    this.transport.onHostMessage(payload);
    this.transport.onBroadcast(payload);
  }

  private broadcastRoomState(): void {
    this.broadcast({ type: 'room_state', state: this.toPublicState() });
  }

  private toPublicState(): RoomPublicState {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      roundNumber: this.roundNumber,
      settings: { ...this.settings },
      selectedHeroIds: [...this.selectedHeroIds],
      players: this.players.map((p): PlayerPublicInfo => ({
        id: p.id,
        name: p.name,
        color: p.color,
        role: p.role,
        isHost: p.isHost,
        connected: p.connected,
        alive: p.alive,
        lives: p.lives,
        maxLives: p.maxLives,
        score: p.score,
        catches: p.catches,
        escapes: p.escapes,
        kills: p.kills,
      })),
      maze: this.maze,
      timeLeft: this.timeLeft,
      countdown: this.countdown,
      huntersReleaseIn: this.huntersReleaseIn,
      pickups: this.pickups,
      lastResult: this.lastResult,
      chat: this.chat.slice(-40),
    };
  }
}
