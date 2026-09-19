import { lazy, Suspense, useCallback, useState } from "react";
import "./App.css";
import { LoadingIndicator } from "./components/LoadingIndicator";
import { TitleScreen } from "./features/lobby/TitleScreen";
import type { LobbyScreen, PlayMode } from "./features/lobby/types";

function LobbyLoadingFallback({ label }: { label: string }) {
  return (
    <div className="lobby-loading-panel" role="status" aria-live="polite">
      <LoadingIndicator label={label} compact />
    </div>
  );
}

const GameMenuScreen = lazy(async () => {
  const mod = await import("./features/lobby/GameMenuScreen");
  return { default: mod.GameMenuScreen };
});

const GameplayApp = lazy(async () => {
  const mod = await import("./GameplayApp");
  return { default: mod.GameplayApp };
});

/** 起動直後はタイトルだけを読み、洪水シミュレーションや Cesium で待たせない。 */
export function App() {
  const [lobbyScreen, setLobbyScreen] = useState<LobbyScreen>("title");
  const [playMode, setPlayMode] = useState<PlayMode | null>(null);
  const [menuHowtoOnMount, setMenuHowtoOnMount] = useState(false);
  const [gameLayerMounted, setGameLayerMounted] = useState(false);
  const [sessionId, setSessionId] = useState(0);

  const enterMenu = useCallback(() => {
    // The guide is available from the menu. Do not interrupt first-time users
    // with a modal before they have chosen whether they want help.
    setMenuHowtoOnMount(false);
    setLobbyScreen("menu");
  }, []);

  const handleMenuStart = useCallback((mode: PlayMode) => {
    setPlayMode(mode);
    setSessionId((current) => current + 1);
    setGameLayerMounted(true);
    setLobbyScreen("game");
  }, []);

  const handleRetrySession = useCallback(() => {
    setSessionId((current) => current + 1);
  }, []);

  const handleReturnToMenu = useCallback(() => {
    setMenuHowtoOnMount(false);
    setLobbyScreen("menu");
  }, []);

  const handleBackToTitle = useCallback(() => {
    setPlayMode(null);
    setGameLayerMounted(false);
    setLobbyScreen("title");
  }, []);

  return (
    <>
      {lobbyScreen === "title" ? (
        <main className="game-shell game-shell--lobby">
          <TitleScreen onEnter={enterMenu} />
        </main>
      ) : null}

      {lobbyScreen === "menu" ? (
        <main className="game-shell game-shell--lobby">
          <Suspense fallback={<LobbyLoadingFallback label="メニューを開いています…" />}>
            <GameMenuScreen
              onBackToTitle={handleBackToTitle}
              onStartGame={handleMenuStart}
              openHowtoOnMount={menuHowtoOnMount}
            />
          </Suspense>
        </main>
      ) : null}

      {gameLayerMounted && playMode !== null ? (
        <Suspense fallback={lobbyScreen === "game" ? <LobbyLoadingFallback label="ゲームを準備しています…" /> : null}>
          <GameplayApp
            playMode={playMode}
            inGame={lobbyScreen === "game"}
            sessionId={sessionId}
            onReturnToMenu={handleReturnToMenu}
            onRetrySession={handleRetrySession}
          />
        </Suspense>
      ) : null}
    </>
  );
}
