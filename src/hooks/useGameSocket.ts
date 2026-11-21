import mqtt, { type MqttClient } from 'mqtt';
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

const TOPIC_PREFIX = 'maze-escape-v2';

// Reliable public TLS WebSocket MQTT brokers that work on GitHub Pages across NAT/firewalls
const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

function generateShortCode(): string {
  // 5-digit numeric code works identically on RU and EN keyboard layouts
  return String(10000 + Math.floor(Math.random() * 90000));
}

function randomClientId(): string {
  return `mze_${Math.random().toString(36).slice(2, 10)}${Date.now()
    .toString(36)
    .slice(-4)}`;
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
  const mqttClientRef = useRef<MqttClient | null>(null);
  const hostEngineRef = useRef<HostGameEngine | null>(null);
  const guestClientIdRef = useRef<string | null>(null);
  const activeRoomCodeRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryJoinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInputSentRef = useRef<{ dx: number; dy: number; at: number }>({
    dx: 0,
    dy: 0,
    at: 0,
  });

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [roomState, setRoomState] = useState<RoomPublicState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const liveTickRef = useRef<LiveTickData | null>(null);
  const prevTickRef = useRef<LiveTickData | null>(null);
  const effectsRef = useRef<VisualEffect[]>([]);
  const localInputRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

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

  const cleanupNetwork = useCallback((notifyLeave = true) => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    if (retryJoinTimerRef.current) {
      clearTimeout(retryJoinTimerRef.current);
      retryJoinTimerRef.current = null;
    }

    const client = mqttClientRef.current;
    const roomCode = activeRoomCodeRef.current;
    const guestId = guestClientIdRef.current;

    if (hostEngineRef.current) {
      hostEngineRef.current.dispose();
      hostEngineRef.current = null;
    } else if (notifyLeave && client && client.connected && roomCode && guestId) {
      try {
        client.publish(
          `${TOPIC_PREFIX}/${roomCode}/to-host`,
          JSON.stringify({ from: guestId, msg: { type: 'leave_room' } })
        );
      } catch {
        // ignore
      }
    }

    if (client) {
      mqttClientRef.current = null;
      try {
        client.end(true);
      } catch {
        // ignore
      }
    }

    guestClientIdRef.current = null;
    activeRoomCodeRef.current = null;
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
          if (retryJoinTimerRef.current) {
            clearTimeout(retryJoinTimerRef.current);
            retryJoinTimerRef.current = null;
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

          if (msg.phase) {
            setRoomState((prev) => {
              if (!prev || prev.phase === msg.phase) return prev;
              return { ...prev, phase: msg.phase };
            });
          }

          const me = msg.players.find((p) => p.id === playerIdRef.current);
          const nextTimeLeft = Math.max(0, Math.ceil(msg.timeLeft));
          const nextCountdown = Math.max(0, Math.ceil(msg.countdown));
          const nextHuntersRelease = Math.max(0, Math.round(msg.huntersReleaseIn * 10) / 10);
          const nextLives = me ? me.lives : 0;
          const nextAlive = me ? me.alive : false;
          const nextWeaponCharges = me ? me.weaponCharges : 0;
          const nextDashCd = Math.round((me?.dashCooldown ?? 0) * 10) / 10;
          const nextSpeedBoost = Math.round((me?.speedBoost ?? 0) * 10) / 10;
          const nextStun = Math.round((me?.stunTimer ?? 0) * 10) / 10;

          setHudStats((prev) => {
            const nextMaxLives = me ? me.maxLives : prev.myMaxLives;
            const nextDashMax = me?.dashMaxCooldown ?? prev.myDashMaxCooldown;
            if (
              Math.ceil(prev.timeLeft) === nextTimeLeft &&
              Math.max(0, Math.ceil(prev.countdown)) === nextCountdown &&
              prev.huntersReleaseIn === nextHuntersRelease &&
              prev.myLives === nextLives &&
              prev.myMaxLives === nextMaxLives &&
              prev.myAlive === nextAlive &&
              prev.myWeaponCharges === nextWeaponCharges &&
              prev.myDashCooldown === nextDashCd &&
              prev.myDashMaxCooldown === nextDashMax &&
              prev.mySpeedBoost === nextSpeedBoost &&
              prev.myStunTimer === nextStun
            ) {
              return prev;
            }
            return {
              timeLeft: nextTimeLeft,
              countdown: nextCountdown,
              huntersReleaseIn: nextHuntersRelease,
              myLives: nextLives,
              myMaxLives: nextMaxLives,
              myAlive: nextAlive,
              myWeaponCharges: nextWeaponCharges,
              myDashCooldown: nextDashCd,
              myDashMaxCooldown: nextDashMax,
              mySpeedBoost: nextSpeedBoost,
              myStunTimer: nextStun,
            };
          });

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
          cleanupNetwork(false);
          setRoomState(null);
          setPlayerId(null);
          setError(msg.message);
          break;
        }

        case 'error': {
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
          }
          if (retryJoinTimerRef.current) {
            clearTimeout(retryJoinTimerRef.current);
            retryJoinTimerRef.current = null;
          }
          setConnecting(false);
          setError(msg.message);
          break;
        }
      }
    },
    [cleanupNetwork]
  );

  const sendAction = useCallback((msg: ClientMessage) => {
    if (msg.type === 'input') {
      const len = Math.hypot(msg.dx, msg.dy);
      localInputRef.current =
        len > 0.01
          ? { dx: msg.dx / Math.max(1, len), dy: msg.dy / Math.max(1, len) }
          : { dx: 0, dy: 0 };
    }

    if (hostEngineRef.current) {
      hostEngineRef.current.handleHostAction(msg);
      return;
    }

    const client = mqttClientRef.current;
    const roomCode = activeRoomCodeRef.current;
    const guestId = guestClientIdRef.current;
    if (!client || !client.connected || !roomCode || !guestId) return;

    if (msg.type === 'input') {
      const now = performance.now();
      const prev = lastInputSentRef.current;
      const isZero = msg.dx === 0 && msg.dy === 0;
      const prevZero = prev.dx === 0 && prev.dy === 0;
      if (!msg.dash && !msg.attack) {
        if (isZero && prevZero) return;
        // Host preserves inputDx/inputDy until changed; refresh at 4 Hz while holding
        if (msg.dx === prev.dx && msg.dy === prev.dy && now - prev.at < 240) {
          return;
        }
      }
      lastInputSentRef.current = { dx: msg.dx, dy: msg.dy, at: now };
    }

    client.publish(
      `${TOPIC_PREFIX}/${roomCode}/to-host`,
      JSON.stringify({ from: guestId, msg }),
      { qos: 0 }
    );
  }, []);

  const createRoom = useCallback(
    (name: string) => {
      const cleanName = name.trim().slice(0, 18);
      if (!cleanName) {
        setError('Введите ваше имя');
        return;
      }

      cleanupNetwork(false);
      setError(null);
      setConnecting(true);

      const code = generateShortCode();
      activeRoomCodeRef.current = code;

      const connectWithBroker = (brokerIdx: number) => {
        if (activeRoomCodeRef.current !== code) return;
        const brokerUrl = MQTT_BROKERS[brokerIdx];
        const clientId = randomClientId();

        const client = mqtt.connect(brokerUrl, {
          clientId,
          clean: true,
          connectTimeout: 6000,
          reconnectPeriod: 2500,
          keepalive: 25,
        });
        mqttClientRef.current = client;

        let opened = false;
        const failTimer = setTimeout(() => {
          if (opened || activeRoomCodeRef.current !== code) return;
          try {
            client.end(true);
          } catch {
            // ignore
          }
          if (brokerIdx + 1 < MQTT_BROKERS.length) {
            connectWithBroker(brokerIdx + 1);
          } else {
            cleanupNetwork(false);
            setError(
              'Не удалось подключиться к игровому ретранслятору. Проверьте интернет и попробуйте снова.'
            );
          }
        }, 5500);
        connectTimeoutRef.current = failTimer;

        const toHostTopic = `${TOPIC_PREFIX}/${code}/to-host`;
        const toAllTopic = `${TOPIC_PREFIX}/${code}/to-all`;

        client.on('connect', () => {
          opened = true;
          clearTimeout(failTimer);
          if (connectTimeoutRef.current === failTimer) {
            connectTimeoutRef.current = null;
          }

          if (brokerIdx > 0) {
            const url = new URL(window.location.href);
            url.searchParams.set('s', String(brokerIdx));
            window.history.replaceState({}, '', url.toString());
          }

          client.subscribe(toHostTopic, { qos: 0 }, (subErr) => {
            if (subErr) {
              cleanupNetwork(false);
              setError('Не удалось открыть канал комнаты. Попробуйте ещё раз.');
              return;
            }

            setConnecting(false);
            setConnected(true);

            if (!hostEngineRef.current) {
              const engine = new HostGameEngine(code, cleanName, {
                onHostMessage: handleServerMessage,
                onSendToClient: (targetClientId, serverMsg) => {
                  const activeClient = mqttClientRef.current;
                  if (activeClient && activeClient.connected) {
                    activeClient.publish(
                      `${TOPIC_PREFIX}/${code}/to/${targetClientId}`,
                      JSON.stringify(serverMsg),
                      { qos: 0 }
                    );
                  }
                },
                onBroadcast: (serverMsg) => {
                  const activeClient = mqttClientRef.current;
                  if (activeClient && activeClient.connected) {
                    activeClient.publish(
                      toAllTopic,
                      JSON.stringify(serverMsg),
                      { qos: 0 }
                    );
                  }
                },
              });
              hostEngineRef.current = engine;
            }
          });
        });

        client.on('message', (topic, rawPayload) => {
          if (topic !== toHostTopic || !hostEngineRef.current) return;
          try {
            const parsed = JSON.parse(rawPayload.toString()) as {
              from?: string;
              msg?: ClientMessage;
            };
            if (parsed.from && parsed.msg) {
              hostEngineRef.current.handleRemoteMessage(parsed.from, parsed.msg);
            }
          } catch {
            // ignore malformed message
          }
        });

        client.on('error', () => {
          if (!opened && brokerIdx + 1 < MQTT_BROKERS.length) {
            clearTimeout(failTimer);
            try {
              client.end(true);
            } catch {
              // ignore
            }
            connectWithBroker(brokerIdx + 1);
          }
        });
      };

      connectWithBroker(0);
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

      cleanupNetwork(false);
      setError(null);
      setConnecting(true);

      const urlParams = new URLSearchParams(window.location.search);
      const preferredBroker = Number(urlParams.get('s') || '0');
      const brokerOrder =
        preferredBroker > 0 && preferredBroker < MQTT_BROKERS.length
          ? [preferredBroker, ...MQTT_BROKERS.map((_, i) => i).filter((i) => i !== preferredBroker)]
          : MQTT_BROKERS.map((_, i) => i);

      activeRoomCodeRef.current = code;
      const myClientId = randomClientId();
      guestClientIdRef.current = myClientId;

      const attemptJoinOnBroker = (orderIdx: number) => {
        if (activeRoomCodeRef.current !== code || guestClientIdRef.current !== myClientId) {
          return;
        }
        const brokerUrl = MQTT_BROKERS[brokerOrder[orderIdx]];
        let gotReply = false;

        const client = mqtt.connect(brokerUrl, {
          clientId: myClientId,
          clean: true,
          connectTimeout: 5500,
          reconnectPeriod: 2500,
          keepalive: 25,
        });
        mqttClientRef.current = client;

        const toHostTopic = `${TOPIC_PREFIX}/${code}/to-host`;
        const toAllTopic = `${TOPIC_PREFIX}/${code}/to-all`;
        const toMeTopic = `${TOPIC_PREFIX}/${code}/to/${myClientId}`;

        const waitTimer = setTimeout(() => {
          if (gotReply || activeRoomCodeRef.current !== code) return;
          try {
            client.end(true);
          } catch {
            // ignore
          }
          if (orderIdx + 1 < brokerOrder.length) {
            attemptJoinOnBroker(orderIdx + 1);
          } else {
            cleanupNetwork(false);
            setError(
              `Комната «${code}» не найдена. Проверьте код или убедитесь, что ведущий не закрыл вкладку.`
            );
          }
        }, 6500);
        connectTimeoutRef.current = waitTimer;

        client.on('connect', () => {
          client.subscribe([toAllTopic, toMeTopic], { qos: 0 }, (subErr) => {
            if (subErr) return;

            const publishJoin = () => {
              if (!client.connected) return;
              client.publish(
                toHostTopic,
                JSON.stringify({
                  from: myClientId,
                  msg: {
                    type: 'join_room',
                    roomCode: code,
                    name: cleanName,
                    playerId: playerIdRef.current ?? undefined,
                  } satisfies ClientMessage,
                }),
                { qos: 0 }
              );
            };

            publishJoin();

            if (!gotReply) {
              if (retryJoinTimerRef.current) clearTimeout(retryJoinTimerRef.current);
              retryJoinTimerRef.current = setTimeout(() => {
                if (!gotReply && client.connected) {
                  publishJoin();
                }
              }, 1600);
            }

            if (!heartbeatRef.current) {
              heartbeatRef.current = setInterval(() => {
                if (client.connected) {
                  client.publish(
                    toHostTopic,
                    JSON.stringify({
                      from: myClientId,
                      msg: { type: 'heartbeat' } satisfies ClientMessage,
                    }),
                    { qos: 0 }
                  );
                }
              }, 3000);
            }
          });
        });

        client.on('message', (_topic, rawPayload) => {
          try {
            const msg = JSON.parse(rawPayload.toString()) as ServerMessage;
            if (msg.type === 'joined' || msg.type === 'error') {
              gotReply = true;
              clearTimeout(waitTimer);
            }
            handleServerMessage(msg);
          } catch {
            // ignore
          }
        });

        client.on('error', () => {
          if (!gotReply && orderIdx + 1 < brokerOrder.length) {
            clearTimeout(waitTimer);
            try {
              client.end(true);
            } catch {
              // ignore
            }
            attemptJoinOnBroker(orderIdx + 1);
          }
        });
      };

      attemptJoinOnBroker(0);
    },
    [cleanupNetwork, handleServerMessage]
  );

  const leaveRoom = useCallback(() => {
    cleanupNetwork(true);
    setRoomState(null);
    setPlayerId(null);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('s');
    window.history.replaceState({}, '', url.toString());
  }, [cleanupNetwork]);

  useEffect(() => {
    const onBeforeUnload = () => {
      cleanupNetwork(true);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      cleanupNetwork(true);
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
    localInputRef,
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
