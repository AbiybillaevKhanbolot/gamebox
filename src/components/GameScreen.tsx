import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crown,
  Heart,
  LogOut,
  RotateCcw,
  Send,
  Shield,
  Swords,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import type { RoomPublicState } from '../../shared/types.ts';
import type { LiveTickData, VisualEffect } from '../hooks/useGameSocket.ts';
import { soundFX } from '../utils/sound.ts';
import { MazeCanvas } from './MazeCanvas.tsx';

interface GameScreenProps {
  roomState: RoomPublicState;
  playerId: string | null;
  liveTickRef: React.MutableRefObject<LiveTickData | null>;
  prevTickRef: React.MutableRefObject<LiveTickData | null>;
  tickBufferRef: React.MutableRefObject<LiveTickData[]>;
  effectsRef: React.MutableRefObject<VisualEffect[]>;
  localInputRef: React.MutableRefObject<{ dx: number; dy: number }>;
  hudStats: {
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
  };
  onSendInput: (
    dx: number,
    dy: number,
    dash: boolean,
    attack: boolean,
    seq: number
  ) => void;
  onPingCell: (x: number, y: number) => void;
  onSendChat: (text: string) => void;
  onNextRound: () => void;
  onReturnLobby: () => void;
  onLeaveRoom: () => void;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export const GameScreen: React.FC<GameScreenProps> = ({
  roomState,
  playerId,
  liveTickRef,
  prevTickRef,
  tickBufferRef,
  effectsRef,
  localInputRef,
  hudStats,
  onSendInput,
  onPingCell,
  onSendChat,
  onNextRound,
  onReturnLobby,
  onLeaveRoom,
}) => {
  const [muted, setMuted] = useState(soundFX.muted);
  const [chatInput, setChatInput] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);

  const keysRef = useRef<Set<string>>(new Set());
  const touchDirRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dashPendingRef = useRef(false);
  const attackPendingRef = useRef(false);
  const seqRef = useRef(0);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const me = roomState.players.find((p) => p.id === playerId);
  const myRole = me?.role ?? 'hunter';
  const isHost = Boolean(me?.isHost);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [roomState.chat.length]);

  useEffect(() => {
    const computeVector = () => {
      const keys = keysRef.current;
      let dx = touchDirRef.current.dx;
      let dy = touchDirRef.current.dy;
      if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
      return { dx: Math.max(-1, Math.min(1, dx)), dy: Math.max(-1, Math.min(1, dy)) };
    };

    const emitCurrentInput = () => {
      if (roomState.phase !== 'PLAYING' && roomState.phase !== 'COUNTDOWN') return;
      const { dx, dy } = computeVector();
      const dash = dashPendingRef.current;
      const attack = attackPendingRef.current;
      dashPendingRef.current = false;
      attackPendingRef.current = false;
      seqRef.current += 1;
      onSendInput(dx, dy, dash, attack, seqRef.current);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (
        e.code === 'KeyW' ||
        e.code === 'KeyA' ||
        e.code === 'KeyS' ||
        e.code === 'KeyD' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight'
      ) {
        e.preventDefault();
        if (!keysRef.current.has(e.code)) {
          keysRef.current.add(e.code);
          emitCurrentInput();
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          dashPendingRef.current = true;
          emitCurrentInput();
        }
      } else if (e.code === 'KeyE' || e.code === 'KeyF') {
        e.preventDefault();
        if (!e.repeat) {
          attackPendingRef.current = true;
          emitCurrentInput();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (keysRef.current.has(e.code)) {
        keysRef.current.delete(e.code);
        emitCurrentInput();
      }
    };

    const onBlur = () => {
      keysRef.current.clear();
      touchDirRef.current = { dx: 0, dy: 0 };
      emitCurrentInput();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    const interval = setInterval(() => {
      const { dx, dy } = computeVector();
      if (dx !== 0 || dy !== 0) {
        emitCurrentInput();
      }
    }, 220);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      clearInterval(interval);
    };
  }, [roomState.phase, onSendInput]);

  const toggleMute = () => {
    soundFX.muted = !soundFX.muted;
    setMuted(soundFX.muted);
  };

  const handleTouchMove = (dx: number, dy: number) => {
    touchDirRef.current = { dx, dy };
    seqRef.current += 1;
    onSendInput(dx, dy, false, false, seqRef.current);
  };

  const handleTouchDash = () => {
    dashPendingRef.current = true;
    seqRef.current += 1;
    onSendInput(touchDirRef.current.dx, touchDirRef.current.dy, true, false, seqRef.current);
  };

  const handleTouchAttack = () => {
    attackPendingRef.current = true;
    seqRef.current += 1;
    onSendInput(touchDirRef.current.dx, touchDirRef.current.dy, false, true, seqRef.current);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  const sortedPlayers = [...roomState.players].sort((a, b) => b.score - a.score);
  const heroPlayers = roomState.players.filter((p) => p.role === 'hero');
  const heroNamesLabel = heroPlayers.map((h) => h.name).join(' и ');
  const dashReady = hudStats.myDashCooldown <= 0.05;

  return (
    <div className="h-[100dvh] w-screen bg-[#132227] text-[#FAF6EE] flex flex-col overflow-hidden">
      {/* Carved Stone Top HUD */}
      <header className="w-full border-b-2 border-[#0B1417] bg-[#1B3139] px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
            {myRole === 'hero' ? (
              <Crown className="w-5 h-5 text-[#FBBF24]" />
            ) : (
              <Shield className="w-5 h-5 text-[#FB7185]" />
            )}
            <span
              className={`font-display text-lg font-bold tracking-wide uppercase ${
                myRole === 'hero' ? 'text-[#FBBF24]' : 'text-[#FB7185]'
              }`}
            >
              {!hudStats.myAlive
                ? 'Наблюдатель'
                : myRole === 'hero'
                ? 'Вы: Герой'
                : 'Вы: Страж'}
            </span>
          </div>

          {myRole === 'hero' && hudStats.myAlive && (
            <>
              <span aria-hidden="true" className="text-[#4E6E7A] hidden sm:inline">
                ·
              </span>
              <div
                className="flex items-center gap-1.5 text-sm text-[#E5DAC6] whitespace-nowrap shrink-0"
                title="Ваши жизни"
              >
                <span className="text-[#CBD5E1] text-xs font-semibold hidden md:inline">
                  Жизни:
                </span>
                {Array.from({ length: hudStats.myMaxLives }).map((_, idx) => (
                  <Heart
                    key={idx}
                    className={`w-4 h-4 ${
                      idx < hudStats.myLives
                        ? 'text-[#FBBF24] fill-[#FBBF24]'
                        : 'text-[#0E1B20]'
                    }`}
                  />
                ))}
              </div>
            </>
          )}

          {myRole === 'hero' && hudStats.myWeaponCharges > 0 && hudStats.myAlive && (
            <>
              <span aria-hidden="true" className="text-[#4E6E7A] hidden sm:inline">
                ·
              </span>
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#FCA5A5] whitespace-nowrap shrink-0">
                <Swords className="w-4 h-4 text-[#F87171]" />
                <span>Меч: {hudStats.myWeaponCharges} (E / касание)</span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-5 shrink-0">
          <div className="font-mono text-2xl sm:text-3xl font-bold leading-none text-[#FAF6EE] tabular-nums">
            {formatTime(hudStats.timeLeft)}
          </div>

          {hudStats.myAlive && (
            <div className="hidden sm:flex items-center gap-2 text-xs font-bold whitespace-nowrap">
              <Zap
                className={`w-4 h-4 ${
                  dashReady ? 'text-[#38BDF8]' : 'text-[#64748B]'
                }`}
              />
              <span className={dashReady ? 'text-[#BAE6FD]' : 'text-[#94A3B8]'}>
                {dashReady
                  ? 'Пробел: Рывок готов'
                  : `Рывок: ${hudStats.myDashCooldown.toFixed(1)}с`}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowSidebar((v) => !v)}
            className="hidden lg:inline-flex px-3 py-1.5 rounded-lg bg-[#132227] hover:bg-[#0B1417] border border-[#315762] text-[#FAF6EE] text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
          >
            {showSidebar ? 'Скрыть панель' : 'Чат и счёт'}
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Включить звук' : 'Выключить звук'}
            className="p-2 rounded-lg bg-[#132227] hover:bg-[#0B1417] border border-[#315762] text-[#FAF6EE] transition-colors cursor-pointer"
          >
            {muted ? (
              <VolumeX className="w-4 h-4 text-[#94A3B8]" />
            ) : (
              <Volume2 className="w-4 h-4 text-[#FAF6EE]" />
            )}
          </button>
          {isHost && (
            <button
              type="button"
              onClick={onReturnLobby}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#132227] hover:bg-[#0B1417] border border-[#315762] text-[#FAF6EE] text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>В лобби</span>
            </button>
          )}
          <button
            type="button"
            onClick={onLeaveRoom}
            aria-label="Выйти из комнаты"
            className="p-2 rounded-lg bg-[#132227] hover:bg-[#3B1822] border border-[#315762] text-[#FAF6EE] transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Play Area */}
      <div className="flex-1 flex min-h-0 relative">
        <main className="flex-1 relative min-w-0 min-h-0 bg-[#132227]">
          {roomState.maze && (
            <MazeCanvas
              maze={roomState.maze}
              phase={roomState.phase}
              playerId={playerId}
              myRole={myRole}
              isHost={isHost}
              visibilityMode={roomState.settings.visibilityMode}
              liveTickRef={liveTickRef}
              prevTickRef={prevTickRef}
              tickBufferRef={tickBufferRef}
              effectsRef={effectsRef}
              localInputRef={localInputRef}
              onPingCell={onPingCell}
            />
          )}

          {/* Countdown Overlay */}
          {roomState.phase === 'COUNTDOWN' && hudStats.countdown > 0 && (
            <div className="absolute inset-0 bg-[#0B1417]/65 flex items-center justify-center pointer-events-none p-4">
              <div className="game-card rounded-xl px-8 py-6 text-center max-w-md text-[#162328]">
                <div className="text-xs font-bold text-[#475569] mb-1">
                  Раунд {roomState.roundNumber} ·{' '}
                  {heroPlayers.length > 1 ? 'Герои' : 'Герой'}: {heroNamesLabel}
                </div>
                <div className="font-mono text-6xl font-bold text-[#D97706] my-2 tabular-nums">
                  {Math.max(1, Math.ceil(hudStats.countdown))}
                </div>
                <p className="text-sm font-semibold text-[#334155]">
                  {myRole === 'hero'
                    ? 'Доберитесь до зелёного ВЫХОДА! Собирайте редкие монеты ⚔ чтобы устранять стражей.'
                    : 'Перекройте путь Героям! Вы видите их в радиусе фонаря и по эху раз в 10с. Клик по карте ставит маячок.'}
                </p>
              </div>
            </div>
          )}

          {/* Hunters Release Banner */}
          {roomState.phase === 'PLAYING' && hudStats.huntersReleaseIn > 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none bg-[#FAF6EE] border-2 border-[#162328] shadow-[3px_3px_0px_#162328] rounded-lg px-4 py-2 text-sm font-bold text-[#162328] whitespace-nowrap">
              {myRole === 'hero' ? (
                <span>
                  Фора Героев! Стражи выйдут через{' '}
                  <strong className="font-mono text-[#D97706] tabular-nums">
                    {hudStats.huntersReleaseIn.toFixed(1)}с
                  </strong>
                </span>
              ) : (
                <span>
                  Старт стражей через{' '}
                  <strong className="font-mono text-[#BE123C] tabular-nums">
                    {hudStats.huntersReleaseIn.toFixed(1)}с
                  </strong>
                </span>
              )}
            </div>
          )}

          {roomState.phase === 'PLAYING' && !hudStats.myAlive && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none bg-[#FAF6EE] border-2 border-[#162328] shadow-[3px_3px_0px_#162328] rounded-lg px-4 py-2 text-sm font-bold text-[#162328] whitespace-nowrap">
              Вы выбыли из этого раунда — режим наблюдателя
            </div>
          )}

          {roomState.phase === 'PLAYING' && hudStats.myStunTimer > 0 && hudStats.myAlive && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none bg-[#EEF2FF] border-2 border-[#162328] shadow-[3px_3px_0px_#162328] rounded-lg px-4 py-2 text-sm font-bold text-[#3730A3] whitespace-nowrap">
              Заморозка: {hudStats.myStunTimer.toFixed(1)}с
            </div>
          )}

          {/* Touch Controls for Mobile / Tablet */}
          {roomState.phase === 'PLAYING' && hudStats.myAlive && (
            <div className="lg:hidden absolute bottom-3 inset-x-3 flex items-end justify-between pointer-events-none touch-none select-none">
              <div className="grid grid-cols-3 gap-1.5 pointer-events-auto bg-[#FAF6EE]/95 p-1.5 rounded-xl border-2 border-[#162328] touch-none">
                <div />
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleTouchMove(0, -1);
                  }}
                  onPointerUp={() => handleTouchMove(0, 0)}
                  onPointerCancel={() => handleTouchMove(0, 0)}
                  onPointerLeave={() => handleTouchMove(0, 0)}
                  className="w-12 h-12 rounded-lg bg-[#E5DAC6] active:bg-[#F59E0B] text-[#162328] border border-[#162328] flex items-center justify-center touch-none"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
                <div />
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleTouchMove(-1, 0);
                  }}
                  onPointerUp={() => handleTouchMove(0, 0)}
                  onPointerCancel={() => handleTouchMove(0, 0)}
                  onPointerLeave={() => handleTouchMove(0, 0)}
                  className="w-12 h-12 rounded-lg bg-[#E5DAC6] active:bg-[#F59E0B] text-[#162328] border border-[#162328] flex items-center justify-center touch-none"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleTouchMove(0, 1);
                  }}
                  onPointerUp={() => handleTouchMove(0, 0)}
                  onPointerCancel={() => handleTouchMove(0, 0)}
                  onPointerLeave={() => handleTouchMove(0, 0)}
                  className="w-12 h-12 rounded-lg bg-[#E5DAC6] active:bg-[#F59E0B] text-[#162328] border border-[#162328] flex items-center justify-center touch-none"
                >
                  <ArrowDown className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleTouchMove(1, 0);
                  }}
                  onPointerUp={() => handleTouchMove(0, 0)}
                  onPointerCancel={() => handleTouchMove(0, 0)}
                  onPointerLeave={() => handleTouchMove(0, 0)}
                  className="w-12 h-12 rounded-lg bg-[#E5DAC6] active:bg-[#F59E0B] text-[#162328] border border-[#162328] flex items-center justify-center touch-none"
                >
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>

              <div className="flex flex-col gap-2 pointer-events-auto touch-none">
                {myRole === 'hero' && hudStats.myWeaponCharges > 0 && (
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      handleTouchAttack();
                    }}
                    className="game-btn h-12 px-4 rounded-xl font-extrabold text-sm bg-[#EF4444] text-white touch-none"
                  >
                    ⚔ Удар
                  </button>
                )}
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleTouchDash();
                  }}
                  className={`game-btn h-14 px-5 rounded-xl font-extrabold text-sm touch-none ${
                    dashReady
                      ? 'bg-[#F59E0B] text-[#162328]'
                      : 'bg-[#E5DAC6] text-[#64748B]'
                  }`}
                >
                  {dashReady ? 'Рывок' : `${hudStats.myDashCooldown.toFixed(1)}с`}
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Desktop Side Panel */}
        {showSidebar && (
          <aside className="hidden lg:flex w-72 border-l-2 border-[#0B1417] bg-[#1B3139] flex-col shrink-0 text-[#FAF6EE]">
            <div className="p-4 border-b border-[#315762] space-y-2 text-xs">
              <div className="font-bold text-[#94A3B8]">Бонусы на карте</div>
              <div className="flex items-center justify-between">
                <span>⚔ Монета-оружие</span>
                <span className="text-[#F87171] font-semibold">Герой (убить)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>⚡ Ускорение</span>
                <span className="text-[#CBD5E1]">Для всех</span>
              </div>
              <div className="flex items-center justify-between">
                <span>🛡 +1 Жизнь</span>
                <span className="text-[#FBBF24] font-semibold">Герой</span>
              </div>
              <div className="flex items-center justify-between">
                <span>❄ Заморозка</span>
                <span className="text-[#FBBF24] font-semibold">Герой</span>
              </div>
              {myRole === 'hunter' && (
                <div className="pt-1 text-[#CBD5E1]">
                  Клик по лабиринту — маячок «!» для других стражей.
                </div>
              )}
            </div>

            <div className="p-4 border-b border-[#315762] overflow-y-auto max-h-60">
              <div className="text-xs font-bold text-[#94A3B8] mb-2.5 flex items-center justify-between">
                <span>Счёт · Раунд {roomState.roundNumber}</span>
                <span>{roomState.players.length} игр.</span>
              </div>
              <div className="space-y-1.5">
                {sortedPlayers.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between text-xs py-1"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-3 h-3 rounded-sm border border-[#0B1417] shrink-0"
                        style={{
                          backgroundColor:
                            p.role === 'hero' ? '#FBBF24' : p.color,
                        }}
                      />
                      <span
                        className={`truncate ${
                          p.id === playerId
                            ? 'text-white font-bold'
                            : 'text-[#E2E8F0]'
                        }`}
                      >
                        {p.name}
                      </span>
                      {p.role === 'hero' && (
                        <span className="text-[#FBBF24] font-semibold shrink-0">
                          Герой
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[#FAF6EE] font-bold tabular-nums shrink-0">
                      {p.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 p-4">
              <div className="text-xs font-bold text-[#94A3B8] mb-2">Чат</div>
              <div className="flex-1 overflow-y-auto space-y-1.5 text-xs pr-1">
                {roomState.chat.map((c) => (
                  <div key={c.id} className="leading-snug">
                    {c.system ? (
                      <span className="text-[#94A3B8]">{c.text}</span>
                    ) : (
                      <>
                        <span
                          className="font-bold mr-1"
                          style={{ color: c.senderColor }}
                        >
                          {c.senderName}:
                        </span>
                        <span className="text-[#FAF6EE] break-words">
                          {c.text}
                        </span>
                      </>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <form onSubmit={handleChatSubmit} className="mt-2 flex gap-1.5">
                <input
                  type="text"
                  maxLength={140}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Сообщение…"
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#132227] border border-[#315762] text-xs text-white placeholder-[#64748B] focus:outline-none focus:border-[#FBBF24]"
                />
                <button
                  type="submit"
                  aria-label="Отправить"
                  className="px-2.5 py-1.5 rounded-lg bg-[#F59E0B] text-[#162328] font-bold cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </aside>
        )}
      </div>

      {/* Round Summary Modal */}
      {roomState.phase === 'ROUND_SUMMARY' && roomState.lastResult && (
        <div className="fixed inset-0 z-50 bg-[#0B1417]/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg game-card rounded-xl p-6 sm:p-7 space-y-5 text-[#162328]">
            <div>
              <div className="text-xs font-bold text-[#475569] mb-1">
                Раунд {roomState.roundNumber} завершён ·{' '}
                <span className="font-mono tabular-nums">
                  {roomState.lastResult.elapsedSeconds} сек
                </span>
              </div>
              <h2
                className={`font-display text-3xl font-bold uppercase ${
                  roomState.lastResult.winner === 'hero'
                    ? 'text-[#B45309]'
                    : 'text-[#BE123C]'
                }`}
              >
                {roomState.lastResult.winner === 'hero'
                  ? 'Герои победили!'
                  : 'Стражи победили!'}
              </h2>
              <p className="text-sm font-medium text-[#334155] mt-1">
                {roomState.lastResult.reason === 'escaped' &&
                  `${roomState.lastResult.escapedHeroName} успешно добрался до выхода из лабиринта.`}
                {roomState.lastResult.reason === 'hunters_eliminated' &&
                  `Герои устранили всех стражей в лабиринте!`}
                {roomState.lastResult.reason === 'caught' &&
                  `${roomState.lastResult.catcherName || 'Стражи'} перехватили всех Героев.`}
                {roomState.lastResult.reason === 'timeout' &&
                  `Время вышло — Стражи удержали лабиринт.`}
                {roomState.lastResult.reason === 'hero_left' &&
                  `Герой покинул игру.`}
              </p>
            </div>

            <div className="border-t-2 border-b-2 border-[#162328]/15 py-3 max-h-60 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-bold text-[#475569] text-left">
                    <th className="pb-2">Игрок</th>
                    <th className="pb-2">Роль</th>
                    <th className="pb-2 text-right">+Очки</th>
                    <th className="pb-2 text-right">Всего</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#162328]/10">
                  {roomState.lastResult.pointsAwarded.map((row) => (
                    <tr key={row.playerId}>
                      <td className="py-2 font-bold text-[#162328]">
                        {row.name}
                      </td>
                      <td
                        className={`py-2 text-xs font-bold ${
                          row.role === 'hero'
                            ? 'text-[#B45309]'
                            : 'text-[#BE123C]'
                        }`}
                      >
                        {row.role === 'hero' ? 'Герой' : 'Страж'}
                      </td>
                      <td className="py-2 text-right font-mono font-bold text-[#047857] tabular-nums">
                        +{row.delta}
                      </td>
                      <td className="py-2 text-right font-mono font-extrabold text-[#162328] tabular-nums">
                        {row.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {isHost ? (
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={onNextRound}
                  className="game-btn flex-1 py-3 px-5 rounded-lg bg-[#F59E0B] hover:bg-[#FBBF24] text-[#162328] font-extrabold text-sm cursor-pointer whitespace-nowrap"
                >
                  Следующий раунд
                </button>
                <button
                  type="button"
                  onClick={onReturnLobby}
                  className="game-btn py-3 px-5 rounded-lg bg-[#E5DAC6] hover:bg-[#DDD0B8] text-[#162328] font-bold text-sm cursor-pointer whitespace-nowrap"
                >
                  В лобби
                </button>
              </div>
            ) : (
              <div className="text-center text-sm font-semibold text-[#475569] py-2">
                Ожидаем решения ведущего…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
