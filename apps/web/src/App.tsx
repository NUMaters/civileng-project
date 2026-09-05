import { lazy, Suspense, useCallback, useState } from "react";
import "./App.css";
import { TitleScreen } from "./features/lobby/TitleScreen";
import type { LobbyScreen, PlayMode } from "./features/lobby/types";

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
    setMenuHowtoOnMount(false);
    setLobbyScreen("menu");
  }, []);

  const handleMenuStart = useCallback((mode: PlayMode) => {
    setPlayMode(mode);
    setSessionId((current) => current + 1);
    setGameLayerMounted(true);
    setLobbyScreen("game");
  }, []);

  const handleReturnToMenu = useCallback(() => {
    setPlayMode(null);
    setMenuHowtoOnMount(false);
    setLobbyScreen("menu");
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
          <Suspense fallback={<p className="lobby-loading">メニューを開いています…</p>}>
            <GameMenuScreen
              onBackToTitle={() => setLobbyScreen("title")}
              onStartGame={handleMenuStart}
              openHowtoOnMount={menuHowtoOnMount}
            />
          </Suspense>
        </main>
      ) : null}

      {gameLayerMounted && playMode !== null ? (
        <Suspense fallback={lobbyScreen === "game" ? <p className="lobby-loading">ゲームを準備しています…</p> : null}>
          <GameplayApp
            playMode={playMode}
            inGame={lobbyScreen === "game"}
            sessionId={sessionId}
            onReturnToMenu={handleReturnToMenu}
          />
        </Suspense>
      ) : null}
    </>
  );
}
