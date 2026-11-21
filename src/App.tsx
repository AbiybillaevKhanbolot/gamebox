import { GameScreen } from './components/GameScreen.tsx';
import { LobbyScreen } from './components/LobbyScreen.tsx';
import { useGameSocket } from './hooks/useGameSocket.ts';

export default function App() {
  const {
    connecting,
    roomState,
    playerId,
    error,
    clearError,
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
  } = useGameSocket();

  if (!roomState || roomState.phase === 'LOBBY') {
    return (
      <LobbyScreen
        roomState={roomState}
        playerId={playerId}
        connecting={connecting}
        error={error}
        onClearError={clearError}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
        onLeaveRoom={leaveRoom}
        onUpdateSettings={updateSettings}
        onStartGame={startGame}
        onSendChat={sendChat}
      />
    );
  }

  return (
    <GameScreen
      roomState={roomState}
      playerId={playerId}
      liveTickRef={liveTickRef}
      prevTickRef={prevTickRef}
      effectsRef={effectsRef}
      hudStats={hudStats}
      onSendInput={sendInput}
      onPingCell={sendPing}
      onSendChat={sendChat}
      onNextRound={nextRound}
      onReturnLobby={returnLobby}
      onLeaveRoom={leaveRoom}
    />
  );
}
