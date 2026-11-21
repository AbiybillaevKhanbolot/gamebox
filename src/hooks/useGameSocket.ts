import Peer, { type DataConnection } from 'peerjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ClientMessage,
  GameEvent,
  PickupItem,
  PlayerTickState,
  RadarEcho,
  RoomPublicState,
  RoomSettings,
  ServerMessage,
  TacticalPing,
} from '../../shared/types.ts';
import { HostGameEngine } from '../game/hostEngine.ts';
import { soundFX } from '../utils/sound.ts';

export interface LiveTickData {
  t: number;
  timeLeft: number;
  countdown: number;
  huntersReleaseIn: number;
  players: PlayerTickState[];
  pickups: PickupItem[];
  pings: TacticalPing[];
  echoes: RadarEcho[];
}

export interface VisualEffect {
  id: string;
  type: GameEvent['type'];
  x: number;
  y: number;
  createdAt: number;
}

const PEER_PREFIX = 'maze-escape-office-';

// Include both public STUN servers AND PeerJS's default TURN relay servers
// so WebRTC works reliably across different Wi-Fi/NAT/mobile networks.
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      {
        urls: [
          'turn:eu-0.turn.peerjs.com:3478',
          'turn:us-0.turn.peerjs.com:3478',
        ],
        username: 'peerjs',
        credential: 'peerjsp',
      },
    ],
  },
};

function generateShortCode(): string {
  // 5-digit numeric code works identically on RU and EN keyboard layouts
  return String(10000 + Math.floor(Math.random() * 90000));
}

export function normalizeRoomCode(raw: string): string {
  const map: Record<string, string> = {
    А: 'A',
    В: 'B',
    Е: 'E',
    К: 'K',
    М: 'M',
    Н: 'H',
    О: 'O',
    Р: 'P',
    С: 'C',
    Т: 'T',
    Х: 'X',
  };
  return raw
    .trim()
    .toUpperCase()
    .replace(/[АВЕКМНОРСТХ]/g, (ch) => map[ch] || ch)
    .replace(/\s+/g, '');
}

export function useGameSocket() {
  const peerRef = useRef<Peer | null>(null);
  const hostEngineRef = useRef<HostGameEngine | null>(null);
  const clientConnRef = useRef<DataConnection | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [roomState, setRoomState] = useState<RoomPublicState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const liveTickRef = useRef<LiveTickData | null>(null);
  const prevTickRef = useRef<LiveTickData | null>(null);
  const effectsRef = useRef<VisualEffect[]>([]);

  const [hudStats, setHudStats] = useState<{
    timeLeft: number;
    countdown: number;
    huntersReleaseIn: number;
    myLives: number;
    myMaxLives: number;
    myAlive: boolean;
    myWeaponCharges: number;
    myDashCooldown: number;
    myDashMaxCooldown: number;
    mySpeedBoost: number;
    myStunTimer: number;
  }>({
    timeLeft: 90,
    countdown: 0,
    huntersReleaseIn: 0,
    myLives: 2,
    myMaxLives: 2,
    myAlive: true,
    myWeaponCharges: 0,
    myDashCooldown: 0,
    myDashMaxCooldown: 5,
    mySpeedBoost: 0,
    myStunTimer: 0,
  });

  const playerIdRef = useRef<string | null>(null);
  playerIdRef.current = playerId;

  const cleanupNetwork = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    if (hostEngineRef.current) {
      hostEngineRef.current.dispose();
      hostEngineRef.current = null;
    }
    if (clientConnRef.current) {
      try {
        clientConnRef.current.close();
      } catch {
        // ignore
      }
      clientConnRef.current = null;
    }
    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch {
        // ignore
      }
      peerRef.current = null;
    }
    setConnected(false);
    setConnecting(false);
  }, []);

  const handleServerMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'joined': {
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
          }
          setConnecting(false);
          setConnected(true);
          setPlayerId(msg.playerId);
          playerIdRef.current = msg.playerId;
          setRoomState(msg.state);
          setError(null);

          const url = new URL(window.location.href);
          if (url.searchParams.get('room') !== msg.roomCode) {
            url.searchParams.set('room', msg.roomCode);
            window.history.replaceState({}, '', url.toString());
          }
          break;
        }

        case 'room_state': {
          setRoomState((prev) => {
            if (
              prev &&
              prev.phase !== 'ROUND_SUMMARY' &&
              msg.state.phase === 'ROUND_SUMMARY' &&
              msg.state.lastResult
            ) {
              const me = msg.state.players.find((p) => p.id === playerIdRef.current);
              const didWin =
                (me?.role === 'hero' && msg.state.lastResult.winner === 'hero') ||
                (me?.role === 'hunter' && msg.state.lastResult.winner === 'hunters');
              if (didWin) soundFX.victory();
              else soundFX.defeat();
            }
            return msg.state;
          });

          if (msg.state.phase === 'COUNTDOWN' || msg.state.phase === 'LOBBY') {
            prevTickRef.current = null;
            liveTickRef.current = null;
            effectsRef.current = [];
          }
          const meInState = msg.state.players.find(
            (p) => p.id === playerIdRef.current
          );
          setHudStats((prev) => ({
            ...prev,
            timeLeft: msg.state.timeLeft,
            countdown: msg.state.countdown,
            huntersReleaseIn: msg.state.huntersReleaseIn,
            myLives: meInState?.lives ?? prev.myLives,
            myMaxLives: meInState?.maxLives ?? prev.myMaxLives,
            myAlive: meInState?.alive ?? true,
          }));
          break;
        }

        case 'tick': {
          prevTickRef.current = liveTickRef.current;
          liveTickRef.current = {
            t: performance.now(),
            timeLeft: msg.timeLeft,
            countdown: msg.countdown,
            huntersReleaseIn: msg.huntersReleaseIn,
            players: msg.players,
            pickups: msg.pickups,
            pings: msg.pings,
            echoes: msg.echoes,
          };

          const me = msg.players.find((p) => p.id === playerIdRef.current);
          setHudStats((prev) => ({
            timeLeft: msg.timeLeft,
            countdown: msg.countdown,
            huntersReleaseIn: msg.huntersReleaseIn,
            myLives: me ? me.lives : 0,
            myMaxLives: me ? me.maxLives : prev.myMaxLives,
            myAlive: me ? me.alive : false,
            myWeaponCharges: me ? me.weaponCharges : 0,
            myDashCooldown: me?.dashCooldown ?? 0,
            myDashMaxCooldown: me?.dashMaxCooldown ?? 5,
            mySpeedBoost: me?.speedBoost ?? 0,
            myStunTimer: me?.stunTimer ?? 0,
          }));

          if (msg.events.length > 0) {
            const now = performance.now();
            for (const evt of msg.events) {
              if (evt.type === 'countdown_tick') soundFX.countdown();
              else if (evt.type === 'round_start') soundFX.start();
              else if (evt.type === 'hunters_released') soundFX.huntersReleased();
              else if (evt.type === 'dash') soundFX.dash();
              else if (
                evt.type === 'pickup_speed' ||
                evt.type === 'pickup_shield' ||
                evt.type === 'pickup_freeze'
              ) {
                soundFX.pickup();
              } else if (evt.type === 'pickup_weapon') soundFX.weaponPickup();
              else if (evt.type === 'guard_killed') soundFX.guardKilled();
              else if (evt.type === 'portal_warp') soundFX.portal();
              else if (evt.type === 'hero_hit') soundFX.hit();

              if (evt.x !== undefined && evt.y !== undefined) {
                effectsRef.current.push({
                  id: `${now}-${Math.random()}`,
                  type: evt.type,
                  x: evt.x,
                  y: evt.y,
                  createdAt: now,
                });
              }
            }
            if (effectsRef.current.length > 30) {
              effectsRef.current = effectsRef.current.slice(-30);
            }
          }
          break;
        }

        case 'chat_message': {
          setRoomState((prev) => {
            if (!prev) return prev;
            if (prev.chat.some((c) => c.id === msg.msg.id)) return prev;
            const nextChat: ChatMessage[] = [...prev.chat, msg.msg].slice(-50);
            return { ...prev, chat: nextChat };
          });
          break;
        }

        case 'room_closed': {
          cleanupNetwork();
          setRoomState(null);
          setPlayerId(null);
          setError(msg.message);
          break;
        }

        case 'error': {
          setConnecting(false);
          setError(msg.message);
          break;
        }
      }
    },
    [cleanupNetwork]
  );

  const sendAction = useCallback((msg: ClientMessage) => {
    if (hostEngineRef.current) {
      hostEngineRef.current.handleHostAction(msg);
      return;
    }
    const conn = clientConnRef.current;
    if (conn && conn.open) {
      conn.send(msg);
    }
  }, []);

  const createRoom = useCallback(
    (name: string) => {
      const cleanName = name.trim().slice(0, 18);
      if (!cleanName) {
        setError('Введите ваше имя');
        return;
      }

      cleanupNetwork();
      setError(null);
      setConnecting(true);

      let attempts = 0;

      const tryCreate = () => {
        const code = generateShortCode();
        const peer = new Peer(`${PEER_PREFIX}${code}`, PEER_CONFIG);
        peerRef.current = peer;

        peer.on('open', () => {
          setConnecting(false);
          setConnected(true);
          if (!hostEngineRef.current) {
            const engine = new HostGameEngine(code, cleanName, handleServerMessage);
            hostEngineRef.current = engine;
          }
        });

        peer.on('disconnected', () => {
          // Keep host registered on signaling server so new players can still join
          if (!peer.destroyed) {
            try {
              peer.reconnect();
            } catch {
              // ignore
            }
          }
        });

        peer.on('connection', (conn) => {
          if (hostEngineRef.current) {
            hostEngineRef.current.attachConnection(conn);
          } else {
            conn.close();
          }
        });

        peer.on('error', (err) => {
          if (err.type === 'unavailable-id' && attempts < 5) {
            attempts++;
            try {
              peer.destroy();
            } catch {
              // ignore
            }
            tryCreate();
            return;
          }
          // Ignore transient signaling errors after room is already active
          if (hostEngineRef.current) return;
          setConnecting(false);
          setError('Не удалось создать комнату. Проверьте доступ к сети и попробуйте ещё раз.');
        });
      };

      tryCreate();
    },
    [cleanupNetwork, handleServerMessage]
  );

  const joinRoom = useCallback(
    (rawCode: string, name: string) => {
      const cleanName = name.trim().slice(0, 18);
      const code = normalizeRoomCode(rawCode);
      if (!cleanName) {
        setError('Введите ваше имя');
        return;
      }
      if (!code) {
        setError('Введите код комнаты');
        return;
      }

      cleanupNetwork();
      setError(null);
      setConnecting(true);

      const peer = new Peer(PEER_CONFIG);
      peerRef.current = peer;

      connectTimeoutRef.current = setTimeout(() => {
        cleanupNetwork();
        setError(
          `Не удалось установить P2P-соединение с комнатой «${code}». Если вы в корпоративном VPN/файрволе, попробуйте открыть игру без VPN или с одной сети.`
        );
      }, 18000);

      peer.on('open', () => {
        const conn = peer.connect(`${PEER_PREFIX}${code}`, {
          reliable: true,
          serialization: 'json',
        });
        clientConnRef.current = conn;

        const sendJoin = () => {
          conn.send({
            type: 'join_room',
            roomCode: code,
            name: cleanName,
          } satisfies ClientMessage);

          if (!heartbeatRef.current) {
            heartbeatRef.current = setInterval(() => {
              if (conn.open) {
                conn.send({ type: 'heartbeat' } satisfies ClientMessage);
              }
            }, 2500);
          }
        };

        if (conn.open) {
          sendJoin();
        } else {
          conn.on('open', sendJoin);
        }

        conn.on('data', (raw) => {
          try {
            const msg = (
              typeof raw === 'string' ? JSON.parse(raw) : raw
            ) as ServerMessage;
            handleServerMessage(msg);
          } catch {
            // ignore
          }
        });

        conn.on('close', () => {
          cleanupNetwork();
          setRoomState((prev) => {
            if (prev) {
              setError('Соединение с комнатой потеряно');
            }
            return null;
          });
          setPlayerId(null);
        });

        conn.on('error', () => {
          cleanupNetwork();
          setError(`Не удалось подключиться к комнате «${code}»`);
        });
      });

      peer.on('error', (err) => {
        cleanupNetwork();
        if (err.type === 'peer-unavailable') {
          setError(`Комната «${code}» не найдена. Проверьте код или убедитесь, что ведущий не закрыл вкладку.`);
        } else {
          setError('Ошибка WebRTC-подключения. Попробуйте ещё раз.');
        }
      });
    },
    [cleanupNetwork, handleServerMessage]
  );

  const leaveRoom = useCallback(() => {
    cleanupNetwork();
    setRoomState(null);
    setPlayerId(null);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
  }, [cleanupNetwork]);

  useEffect(() => {
    const onBeforeUnload = () => {
      cleanupNetwork();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      cleanupNetwork();
    };
  }, [cleanupNetwork]);

  const updateSettings = useCallback(
    (settings?: Partial<RoomSettings>, toggleHeroId?: string) => {
      sendAction({ type: 'update_settings', settings, toggleHeroId });
    },
    [sendAction]
  );

  const startGame = useCallback(() => {
    sendAction({ type: 'start_game' });
  }, [sendAction]);

  const nextRound = useCallback(() => {
    sendAction({ type: 'next_round' });
  }, [sendAction]);

  const returnLobby = useCallback(() => {
    sendAction({ type: 'return_lobby' });
  }, [sendAction]);

  const sendInput = useCallback(
    (dx: number, dy: number, dash: boolean, attack: boolean, seq: number) => {
      sendAction({ type: 'input', dx, dy, dash, attack, seq });
    },
    [sendAction]
  );

  const sendChat = useCallback(
    (text: string) => {
      sendAction({ type: 'chat', text });
    },
    [sendAction]
  );

  const sendPing = useCallback(
    (x: number, y: number) => {
      sendAction({ type: 'ping_cell', x, y });
    },
    [sendAction]
  );

  return {
    connected,
    connecting,
    roomState,
    playerId,
    error,
    clearError: () => setError(null),
    liveTickRef,
    prevTickRef,
    effectsRef,
    hudStats,
    createRoom,
    joinRoom,
    leaveRoom,
    updateSettings,
    startGame,
    nextRound,
    returnLobby,
    sendInput,
    sendChat,
    sendPing,
  };
}
