export type GamePhase = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'ROUND_SUMMARY';

export type PlayerRole = 'hero' | 'hunter';

export type MazeSizeOption = 'medium' | 'large' | 'huge';
export type HeroSelectionMode = 'rotate' | 'random' | 'host_pick';
export type HeroLivesOption = 'auto' | 1 | 2 | 3;
export type HeroCountOption = 'auto' | 1 | 2;
export type VisibilityMode = 'heroes_see_all' | 'fog_both' | 'all_visible';

export interface RoomSettings {
  mazeSize: MazeSizeOption;
  roundDuration: 60 | 90 | 120;
  heroCount: HeroCountOption;
  heroSelection: HeroSelectionMode;
  heroLives: HeroLivesOption;
  visibilityMode: VisibilityMode;
}

export interface MazePortalPair {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface MazeData {
  cols: number;
  rows: number;
  /** Flat row-major grid: 0 = floor, 1 = wall, 2 = exit, 3 = portalA, 4 = portalB */
  cells: number[];
  heroSpawns: { x: number; y: number }[];
  exitPos: { x: number; y: number };
  hunterSpawns: { x: number; y: number }[];
  portals: MazePortalPair | null;
}

export type PickupType = 'speed' | 'shield' | 'freeze' | 'weapon';

export interface PickupItem {
  id: string;
  type: PickupType;
  x: number;
  y: number;
}

export interface TacticalPing {
  id: string;
  x: number;
  y: number;
  playerName: string;
  color: string;
  expiresAt: number;
}

export interface RadarEcho {
  id: string;
  x: number;
  y: number;
  name: string;
  expiresAt: number;
}

export interface PlayerPublicInfo {
  id: string;
  name: string;
  color: string;
  role: PlayerRole;
  isHost: boolean;
  connected: boolean;
  alive: boolean;
  lives: number;
  maxLives: number;
  score: number;
  catches: number;
  escapes: number;
  kills: number;
}

export interface PlayerTickState {
  id: string;
  name: string;
  color: string;
  role: PlayerRole;
  alive: boolean;
  lives: number;
  maxLives: number;
  weaponCharges: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dashCooldown: number;
  dashMaxCooldown: number;
  dashActive: number;
  speedBoost: number;
  invulnTimer: number;
  stunTimer: number;
  score: number;
}

export interface ChatMessage {
  id: string;
  senderName: string;
  senderColor: string;
  text: string;
  timestamp: number;
  system?: boolean;
}

export interface RoundResult {
  winner: 'hero' | 'hunters';
  reason: 'escaped' | 'hunters_eliminated' | 'caught' | 'timeout' | 'hero_left';
  heroNames: string[];
  escapedHeroName?: string;
  catcherName?: string;
  elapsedSeconds: number;
  pointsAwarded: {
    playerId: string;
    name: string;
    role: PlayerRole;
    delta: number;
    total: number;
  }[];
}

export interface RoomPublicState {
  roomCode: string;
  phase: GamePhase;
  roundNumber: number;
  settings: RoomSettings;
  selectedHeroIds: string[];
  players: PlayerPublicInfo[];
  maze: MazeData | null;
  timeLeft: number;
  countdown: number;
  huntersReleaseIn: number;
  pickups: PickupItem[];
  lastResult: RoundResult | null;
  chat: ChatMessage[];
}

export type GameEventType =
  | 'countdown_tick'
  | 'round_start'
  | 'hunters_released'
  | 'dash'
  | 'pickup_speed'
  | 'pickup_shield'
  | 'pickup_freeze'
  | 'pickup_weapon'
  | 'guard_killed'
  | 'portal_warp'
  | 'hero_hit'
  | 'round_end';

export interface GameEvent {
  type: GameEventType;
  x?: number;
  y?: number;
  playerId?: string;
  label?: string;
}

export type ClientMessage =
  | {
      type: 'join_room';
      roomCode?: string;
      name: string;
      create?: boolean;
      playerId?: string;
    }
  | {
      type: 'update_settings';
      settings?: Partial<RoomSettings>;
      toggleHeroId?: string;
    }
  | { type: 'start_game' }
  | { type: 'next_round' }
  | { type: 'return_lobby' }
  | { type: 'input'; dx: number; dy: number; dash: boolean; attack?: boolean; seq: number }
  | { type: 'chat'; text: string }
  | { type: 'ping_cell'; x: number; y: number }
  | { type: 'heartbeat' };

export type ServerMessage =
  | {
      type: 'joined';
      roomCode: string;
      playerId: string;
      state: RoomPublicState;
    }
  | {
      type: 'room_state';
      state: RoomPublicState;
    }
  | {
      type: 'tick';
      t: number;
      timeLeft: number;
      countdown: number;
      huntersReleaseIn: number;
      players: PlayerTickState[];
      pickups: PickupItem[];
      pings: TacticalPing[];
      echoes: RadarEcho[];
      events: GameEvent[];
    }
  | {
      type: 'chat_message';
      msg: ChatMessage;
    }
  | {
      type: 'room_closed';
      message: string;
    }
  | {
      type: 'error';
      message: string;
    };

export const MAX_PLAYERS_PER_ROOM = 10;
export const HERO_VISION_RADIUS = 6.8;
export const HUNTER_VISION_RADIUS = 6.2;

export const PLAYER_COLORS = [
  '#38BDF8', // sky
  '#F472B6', // pink
  '#A78BFA', // violet
  '#34D399', // emerald
  '#FB7185', // rose
  '#60A5FA', // blue
  '#2DD4BF', // teal
  '#FBBF24', // amber
  '#C084FC', // purple
  '#F97316', // orange
];
