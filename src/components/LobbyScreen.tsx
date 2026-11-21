import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Compass,
  Copy,
  LogOut,
  Play,
  Send,
  Users,
} from 'lucide-react';
import heroArtworkUrl from '../assets/images/maze_chase_artwork_1795274589585.jpg';
import type {
  HeroCountOption,
  HeroLivesOption,
  HeroSelectionMode,
  MazeSizeOption,
  RoomPublicState,
  RoomSettings,
  VisibilityMode,
} from '../../shared/types.ts';
import { MAX_PLAYERS_PER_ROOM } from '../../shared/types.ts';

interface LobbyScreenProps {
  roomState: RoomPublicState | null;
  playerId: string | null;
  connecting?: boolean;
  error: string | null;
  onClearError: () => void;
  onCreateRoom: (name: string) => void;
  onJoinRoom: (code: string, name: string) => void;
  onLeaveRoom: () => void;
  onUpdateSettings: (
    settings?: Partial<RoomSettings>,
    toggleHeroId?: string
  ) => void;
  onStartGame: () => void;
  onSendChat: (text: string) => void;
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  roomState,
  playerId,
  connecting = false,
  error,
  onClearError,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onUpdateSettings,
  onStartGame,
  onSendChat,
}) => {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('maze_player_name') || '';
    } catch {
      return '';
    }
  });
  const [joinCode, setJoinCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').toUpperCase();
  });
  const [copied, setCopied] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [roomState?.chat.length]);

  const saveName = (val: string) => {
    setName(val);
    onClearError();
    try {
      localStorage.setItem('maze_player_name', val);
    } catch {
      // ignore
    }
  };

  const handleCopyInvite = async () => {
    if (!roomState) return;
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomState.roomCode);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  if (!roomState) {
    const hasInviteCode = joinCode.trim().length > 0;
    return (
      <div className="min-h-screen bg-parchment-grid text-[#162328] flex flex-col">
        <header className="w-full border-b-2 border-[#162328] bg-[#FAF6EE] px-6 py-3.5">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-8">
            <span className="font-display text-2xl font-bold tracking-wide uppercase text-[#162328] whitespace-nowrap shrink-0">
              Лабиринт: Побег
            </span>
            <span className="text-sm font-medium text-[#475569] hidden sm:inline whitespace-nowrap">
              Настольный онлайн-экшен для компании от 2 до 10 человек
            </span>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8">
          <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-7 items-stretch">
            {/* Left: Entry Box */}
            <section className="lg:col-span-5 game-card rounded-xl p-6 sm:p-8 flex flex-col justify-between">
              <div>
                <h1 className="font-display text-4xl sm:text-5xl font-bold uppercase tracking-tight text-[#162328] leading-[1.05] mb-3 text-balance">
                  Побег из лабиринта
                </h1>
                <p className="text-[#475569] text-sm sm:text-base mb-6 leading-relaxed">
                  До 2 героев пробираются к выходу через большой лабиринт, а команда стражей выслеживает их по фонарю и маячкам.
                </p>

                {error && (
                  <div className="mb-5 px-4 py-3 rounded-lg bg-[#FEE2E2] border-2 border-[#162328] text-[#991B1B] text-sm font-semibold">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="player-name"
                      className="block text-sm font-bold text-[#162328] mb-1.5"
                    >
                      Как вас подписать в игре
                    </label>
                    <input
                      id="player-name"
                      type="text"
                      maxLength={18}
                      value={name}
                      onChange={(e) => saveName(e.target.value)}
                      placeholder="Например, Алексей"
                      className="w-full px-4 py-3 rounded-lg bg-white border-2 border-[#162328] text-[#162328] placeholder-[#94A3B8] font-medium focus:outline-none focus:bg-[#FFFBEB]"
                    />
                  </div>

                  {hasInviteCode ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        onJoinRoom(joinCode, name);
                      }}
                      className="space-y-3.5"
                    >
                      <div>
                        <label
                          htmlFor="room-code"
                          className="block text-sm font-bold text-[#162328] mb-1.5"
                        >
                          Код комнаты
                        </label>
                        <input
                          id="room-code"
                          type="text"
                          maxLength={6}
                          value={joinCode}
                          onChange={(e) => {
                            setJoinCode(e.target.value.toUpperCase());
                            onClearError();
                          }}
                          placeholder="48291"
                          className="w-full px-4 py-3 rounded-lg bg-white border-2 border-[#162328] text-[#162328] font-mono text-lg font-bold tracking-widest uppercase placeholder-[#94A3B8] focus:outline-none focus:bg-[#FFFBEB]"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={connecting}
                        className="game-btn w-full py-3.5 px-5 rounded-lg bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-65 text-[#162328] font-extrabold text-base cursor-pointer whitespace-nowrap"
                      >
                        {connecting ? 'Подключаемся…' : 'Войти в комнату'}
                      </button>
                      <button
                        type="button"
                        disabled={connecting}
                        onClick={() => onCreateRoom(name)}
                        className="game-btn w-full py-2.5 px-5 rounded-lg bg-[#E5DAC6] hover:bg-[#DDD0B8] disabled:opacity-65 text-[#162328] font-bold text-sm cursor-pointer whitespace-nowrap"
                      >
                        Или создать свою комнату
                      </button>
                    </form>
                  ) : (
                    <div className="space-y-4">
                      <button
                        type="button"
                        disabled={connecting}
                        onClick={() => onCreateRoom(name)}
                        className="game-btn w-full py-3.5 px-5 rounded-lg bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-65 text-[#162328] font-extrabold text-base cursor-pointer whitespace-nowrap"
                      >
                        {connecting ? 'Создаём комнату…' : 'Создать комнату'}
                      </button>

                      <div className="pt-4 border-t-2 border-dashed border-[#162328]/20">
                        <label
                          htmlFor="room-code-inline"
                          className="block text-sm font-bold text-[#162328] mb-1.5"
                        >
                          Зайти по коду от коллеги
                        </label>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            onJoinRoom(joinCode, name);
                          }}
                          className="flex gap-2.5"
                        >
                          <input
                            id="room-code-inline"
                            type="text"
                            maxLength={6}
                            value={joinCode}
                            onChange={(e) => {
                              setJoinCode(e.target.value.toUpperCase());
                              onClearError();
                            }}
                            placeholder="48291"
                            className="flex-1 min-w-0 px-4 py-2.5 rounded-lg bg-white border-2 border-[#162328] text-[#162328] font-mono font-bold tracking-wider uppercase placeholder-[#94A3B8] focus:outline-none focus:bg-[#FFFBEB]"
                          />
                          <button
                            type="submit"
                            disabled={connecting}
                            className="game-btn px-5 py-2.5 rounded-lg bg-[#1B3139] hover:bg-[#24414B] disabled:opacity-65 text-[#FAF6EE] font-bold text-sm cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {connecting ? 'Вход…' : 'Войти'}
                          </button>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t-2 border-[#162328]/10 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-[#475569]">
                <span>2–10 игроков</span>
                <span aria-hidden="true">·</span>
                <span>1–2 героя</span>
                <span aria-hidden="true">·</span>
                <span>Большой лабиринт</span>
              </div>
            </section>

            {/* Right: Artwork Showcase + Tabletop Rules */}
            <section className="lg:col-span-7 game-card rounded-xl overflow-hidden flex flex-col">
              <div className="relative aspect-[16/9] w-full bg-[#1B3139] border-b-2 border-[#162328] overflow-hidden">
                {!imgError ? (
                  <img
                    src={heroArtworkUrl}
                    alt="Лабиринт: Герой бежит к изумрудному выходу мимо стражей"
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-[#FAF6EE]">
                    <Compass className="w-12 h-12 text-amber-400 mb-2" />
                    <span className="font-display text-2xl uppercase">
                      Лабиринт: Побег
                    </span>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#162328]/85 to-transparent flex items-end p-4 sm:p-5">
                  <div className="text-[#FAF6EE] text-sm font-semibold">
                    Герои видят весь отряд стражей, но стражи видят героев только вблизи и по эху радара
                  </div>
                </div>
              </div>

              <div className="p-6 flex-1 flex flex-col justify-between bg-[#FAF6EE] gap-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 text-sm">
                  <div>
                    <div className="font-display text-lg font-bold uppercase text-[#B45309] mb-1">
                      01. Герои (1–2)
                    </div>
                    <p className="text-[#334155] leading-snug">
                      Видят стражей на карте. Достаточно одному дойти до зелёного выхода или повергнуть всех стражей.
                    </p>
                  </div>
                  <div>
                    <div className="font-display text-lg font-bold uppercase text-[#BE123C] mb-1">
                      02. Стражи
                    </div>
                    <p className="text-[#334155] leading-snug">
                      Видят героев в радиусе фонаря и по эху каждые 10с. Кликайте по карте, чтобы позвать команду!
                    </p>
                  </div>
                  <div>
                    <div className="font-display text-lg font-bold uppercase text-[#047857] mb-1">
                      03. Монета-меч
                    </div>
                    <p className="text-[#334155] leading-snug">
                      Редко на карте появляется золотая монета-оружие: с ней Герой может убить стража при встрече.
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t-2 border-dashed border-[#162328]/15 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-[#334155]">
                  <div>
                    Ходьба:{' '}
                    <span className="font-mono px-2 py-0.5 bg-[#E5DAC6] border border-[#162328] rounded text-[#162328]">
                      WASD / Стрелки
                    </span>
                  </div>
                  <div>
                    Рывок:{' '}
                    <span className="font-mono px-2 py-0.5 bg-[#E5DAC6] border border-[#162328] rounded text-[#162328]">
                      Пробел
                    </span>
                  </div>
                  <div>
                    Удар мечом:{' '}
                    <span className="font-mono px-2 py-0.5 bg-[#E5DAC6] border border-[#162328] rounded text-[#162328]">
                      E или касание
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }

  // Room Lobby view
  const me = roomState.players.find((p) => p.id === playerId);
  const isHost = Boolean(me?.isHost);
  const connectedCount = roomState.players.filter((p) => p.connected).length;
  const canStart = isHost && connectedCount >= 2;

  return (
    <div className="min-h-screen bg-parchment-grid text-[#162328] flex flex-col">
      <header className="w-full border-b-2 border-[#162328] bg-[#FAF6EE] px-6 py-3.5">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <span className="font-display text-2xl font-bold tracking-wide uppercase text-[#162328] whitespace-nowrap shrink-0">
            Лабиринт: Побег
          </span>

          <div className="flex items-center gap-4 text-sm font-semibold text-[#334155]">
            <span>
              Комната{' '}
              <strong className="font-mono text-base px-2 py-0.5 rounded bg-[#F59E0B]/25 border border-[#162328] text-[#162328] tracking-wider">
                {roomState.roomCode}
              </strong>
            </span>
            <span aria-hidden="true" className="text-[#94A3B8]">
              ·
            </span>
            <span className="tabular-nums">
              {connectedCount} / {MAX_PLAYERS_PER_ROOM} игроков
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleCopyInvite}
              className="game-btn flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#E5DAC6] hover:bg-[#DDD0B8] text-[#162328] text-sm font-bold cursor-pointer whitespace-nowrap shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-[#047857]" />
                  <span>Ссылка скопирована</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Копировать ссылку</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onLeaveRoom}
              className="game-btn flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white hover:bg-[#FEE2E2] text-[#162328] text-sm font-bold cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span>Выйти</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-7 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Player Roster */}
        <section className="lg:col-span-7 game-card rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 mb-5 pb-3 border-b-2 border-[#162328]/10">
            <div className="flex items-center gap-2.5">
              <Users className="w-5 h-5 text-[#1B3139]" />
              <h2 className="font-display text-2xl font-bold uppercase text-[#162328]">
                Участники
              </h2>
            </div>
            <span className="text-sm font-semibold text-[#475569] tabular-nums">
              Раунд {roomState.roundNumber + 1}
            </span>
          </div>

          {error && (
            <div className="mb-4 px-4 py-2.5 rounded-lg bg-[#FEE2E2] border-2 border-[#162328] text-[#991B1B] text-sm font-semibold">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {roomState.players.map((p) => {
              const isMe = p.id === playerId;
              const isSelectedHero =
                roomState.settings.heroSelection === 'host_pick' &&
                roomState.selectedHeroIds.includes(p.id);

              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border-2 border-[#162328] ${
                    isMe ? 'bg-[#FEF3C7]' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-md border-2 border-[#162328] flex items-center justify-center font-bold text-[#162328] text-sm shrink-0"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[#162328] text-sm truncate flex items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        {isMe && (
                          <span className="text-xs text-[#B45309] font-bold shrink-0">
                            (вы)
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-medium text-[#475569] flex items-center gap-1.5">
                        <span>{p.isHost ? 'Ведущий' : 'Игрок'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {p.score} очк.
                        </span>
                      </div>
                    </div>
                  </div>

                  {isHost && roomState.settings.heroSelection === 'host_pick' && (
                    <button
                      type="button"
                      onClick={() => onUpdateSettings(undefined, p.id)}
                      className={`px-2.5 py-1.5 rounded-md border-2 border-[#162328] text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        isSelectedHero
                          ? 'bg-[#F59E0B] text-[#162328]'
                          : 'bg-[#E5DAC6] text-[#162328] hover:bg-[#DDD0B8]'
                      }`}
                    >
                      {isSelectedHero ? 'Герой' : 'Выбрать'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {connectedCount < 2 ? (
            <div className="mt-5 px-4 py-3 rounded-lg bg-[#E5DAC6]/60 border-2 border-dashed border-[#162328]/35 text-sm font-medium text-[#334155]">
              Отправьте ссылку коллегам — для старта нужно минимум 2 игрока.
            </div>
          ) : (
            <div className="mt-5 text-xs font-medium text-[#475569]">
              Ведущий держит комнату в своей вкладке браузера — не закрывайте её во время игры.
            </div>
          )}
        </section>

        {/* Right: Settings + Start + Chat */}
        <section className="lg:col-span-5 space-y-6">
          <div className="game-card rounded-xl p-6 space-y-4">
            <h2 className="font-display text-2xl font-bold uppercase text-[#162328] pb-2 border-b-2 border-[#162328]/10">
              Правила раунда
            </h2>

            {/* Maze Size */}
            <div>
              <div className="text-xs font-bold text-[#475569] mb-1.5">
                Размер лабиринта
              </div>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#E5DAC6] border-2 border-[#162328] rounded-lg">
                {(
                  [
                    ['medium', 'Средний'],
                    ['large', 'Большой'],
                    ['huge', 'Огромный'],
                  ] as [MazeSizeOption, string][]
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    disabled={!isHost}
                    onClick={() => onUpdateSettings({ mazeSize: val })}
                    className={`py-1.5 px-2 text-xs font-bold rounded-md transition-colors whitespace-nowrap ${
                      roomState.settings.mazeSize === val
                        ? 'bg-[#1B3139] text-[#FAF6EE]'
                        : 'text-[#162328] hover:bg-white/60'
                    } ${isHost ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Visibility Mode */}
            <div>
              <div className="text-xs font-bold text-[#475569] mb-1.5">
                Видимость игроков
              </div>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#E5DAC6] border-2 border-[#162328] rounded-lg">
                {(
                  [
                    ['heroes_see_all', 'Герои видят'],
                    ['fog_both', 'Туман обоим'],
                    ['all_visible', 'Видно всех'],
                  ] as [VisibilityMode, string][]
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    disabled={!isHost}
                    onClick={() => onUpdateSettings({ visibilityMode: val })}
                    className={`py-1.5 px-2 text-xs font-bold rounded-md transition-colors whitespace-nowrap ${
                      roomState.settings.visibilityMode === val
                        ? 'bg-[#1B3139] text-[#FAF6EE]'
                        : 'text-[#162328] hover:bg-white/60'
                    } ${isHost ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 text-[11px] font-medium text-[#475569]">
                {roomState.settings.visibilityMode === 'heroes_see_all' &&
                  'Рекомендуем: Герои видят всех стражей; стражи видят героев только вблизи и по эху раз в 10с.'}
                {roomState.settings.visibilityMode === 'fog_both' &&
                  'Хардкор: обе стороны видят противников только в радиусе фонаря и по эху.'}
                {roomState.settings.visibilityMode === 'all_visible' &&
                  'Классика: все игроки всегда видят друг друга на карте.'}
              </div>
            </div>

            {/* Hero Count + Duration */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-bold text-[#475569] mb-1.5">
                  Героев (макс. 2)
                </div>
                <div className="grid grid-cols-3 gap-1 p-1 bg-[#E5DAC6] border-2 border-[#162328] rounded-lg">
                  {(
                    [
                      ['auto', 'Авто'],
                      [1, '1'],
                      [2, '2'],
                    ] as [HeroCountOption, string][]
                  ).map(([val, label]) => (
                    <button
                      key={String(val)}
                      type="button"
                      disabled={!isHost}
                      onClick={() => onUpdateSettings({ heroCount: val })}
                      className={`py-1.5 px-1 text-xs font-bold rounded-md transition-colors whitespace-nowrap ${
                        roomState.settings.heroCount === val
                          ? 'bg-[#1B3139] text-[#FAF6EE]'
                          : 'text-[#162328] hover:bg-white/60'
                      } ${isHost ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold text-[#475569] mb-1.5">
                  Таймер раунда
                </div>
                <div className="grid grid-cols-3 gap-1 p-1 bg-[#E5DAC6] border-2 border-[#162328] rounded-lg">
                  {([60, 90, 120] as const).map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      disabled={!isHost}
                      onClick={() => onUpdateSettings({ roundDuration: sec })}
                      className={`py-1.5 px-1 text-xs font-bold rounded-md transition-colors font-mono tabular-nums whitespace-nowrap ${
                        roomState.settings.roundDuration === sec
                          ? 'bg-[#1B3139] text-[#FAF6EE]'
                          : 'text-[#162328] hover:bg-white/60'
                      } ${isHost ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                    >
                      {sec}с
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Hero Selection + Lives */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-bold text-[#475569] mb-1.5">
                  Выбор героев
                </div>
                <div className="grid grid-cols-3 gap-1 p-1 bg-[#E5DAC6] border-2 border-[#162328] rounded-lg">
                  {(
                    [
                      ['rotate', 'Круг'],
                      ['random', 'Случ.'],
                      ['host_pick', 'Ручн.'],
                    ] as [HeroSelectionMode, string][]
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      disabled={!isHost}
                      onClick={() => onUpdateSettings({ heroSelection: val })}
                      className={`py-1.5 px-1 text-xs font-bold rounded-md transition-colors whitespace-nowrap ${
                        roomState.settings.heroSelection === val
                          ? 'bg-[#1B3139] text-[#FAF6EE]'
                          : 'text-[#162328] hover:bg-white/60'
                      } ${isHost ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold text-[#475569] mb-1.5">
                  Жизни Героя
                </div>
                <div className="grid grid-cols-4 gap-1 p-1 bg-[#E5DAC6] border-2 border-[#162328] rounded-lg">
                  {(
                    [
                      ['auto', 'Авт'],
                      [1, '1'],
                      [2, '2'],
                      [3, '3'],
                    ] as [HeroLivesOption, string][]
                  ).map(([val, label]) => (
                    <button
                      key={String(val)}
                      type="button"
                      disabled={!isHost}
                      onClick={() => onUpdateSettings({ heroLives: val })}
                      className={`py-1.5 px-1 text-xs font-bold rounded-md transition-colors whitespace-nowrap ${
                        roomState.settings.heroLives === val
                          ? 'bg-[#1B3139] text-[#FAF6EE]'
                          : 'text-[#162328] hover:bg-white/60'
                      } ${isHost ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {isHost ? (
              <button
                type="button"
                disabled={!canStart}
                onClick={onStartGame}
                className={`game-btn w-full py-3.5 px-5 rounded-lg font-extrabold text-base flex items-center justify-center gap-2 whitespace-nowrap ${
                  canStart
                    ? 'bg-[#F59E0B] hover:bg-[#FBBF24] text-[#162328] cursor-pointer'
                    : 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                }`}
              >
                <Play className="w-5 h-5 fill-current" />
                <span>Начать игру</span>
              </button>
            ) : (
              <div className="w-full py-3 px-4 rounded-lg bg-[#E5DAC6]/60 border-2 border-[#162328]/25 text-center text-sm font-semibold text-[#475569]">
                Ожидаем запуска от ведущего…
              </div>
            )}
          </div>

          {/* Mini Lobby Chat */}
          <div className="game-card rounded-xl p-4 flex flex-col h-48">
            <div className="text-xs font-bold text-[#475569] mb-2 pb-1.5 border-b border-[#162328]/10">
              Чат комнаты
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-sm">
              {roomState.chat.length === 0 ? (
                <div className="text-[#94A3B8] text-xs pt-2">
                  Сообщений пока нет…
                </div>
              ) : (
                roomState.chat.map((c) => (
                  <div key={c.id} className="leading-snug">
                    {c.system ? (
                      <span className="text-xs font-medium text-[#64748B]">
                        {c.text}
                      </span>
                    ) : (
                      <>
                        <span className="font-bold mr-1.5 text-[#162328]">
                          {c.senderName}:
                        </span>
                        <span className="text-[#334155] break-words">
                          {c.text}
                        </span>
                      </>
                    )}
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleChatSubmit} className="mt-2 flex gap-2">
              <input
                type="text"
                maxLength={140}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Написать коллегам…"
                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-white border-2 border-[#162328] text-sm text-[#162328] placeholder-[#94A3B8] focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Отправить сообщение"
                className="game-btn px-3 py-1.5 rounded-lg bg-[#1B3139] text-[#FAF6EE] cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
};
