import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import type { CesiumGameMapHandle } from "./components/GameCanvas/CesiumGameMap";
import { MapBootFallback } from "./components/GameCanvas/MapBootFallback";
import { GameToast } from "./components/GameToast";
import { ConstructionMenu, useConstruction } from "./features/construction";
import { formatBudget } from "./features/construction/services/constructionService";
import type { GeoPosition } from "./features/construction/types/construction";
import { FloodHud, FloodResultPanel, RainOverlay, ReviewModeBar, useFloodSimulation } from "./features/disaster";
import { GameMenuScreen, TitleScreen, type LobbyScreen, type PlayMode } from "./features/lobby";
import { useGameSocket } from "./features/realtime/hooks/useGameSocket";

/** タイトル／メニューでは Cesium（約 10MB+）を読まず、真っ白待ちを防ぐ。 */
const CesiumGameMap = lazy(async () => {
  const mod = await import("./components/GameCanvas/CesiumGameMap");
  return { default: mod.CesiumGameMap };
});

type DockDragState = {
  structureId: string;
  displayName: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** 地図上で 3D ゴーストを表示中（HTML アイコンは隠す）。 */
  overMap: boolean;
  placeable: boolean;
};

/** タップ選択とドラッグ配置を区別する最小移動量（CSS px）。 */
const DOCK_DRAG_PLACE_THRESHOLD_PX = 28;
/** カメラ移動の WS 送信スロットル（ms）。 */
const MOVE_SEND_THROTTLE_MS = 400;
/** ローカル単独プレイではWS再接続を止め、開発サーバーのプロキシ負荷を避ける。 */
const REALTIME_ENABLED = import.meta.env.VITE_REALTIME_ENABLED === "true";

const statusLabel: Record<string, string> = {
  connecting: "同期中",
  connected: "連携中",
  disconnected: "単独プレイ",
  error: "通信エラー",
};

export function App() {
  const [lobbyScreen, setLobbyScreen] = useState<LobbyScreen>("title");
  const [playMode, setPlayMode] = useState<PlayMode | null>(null);
  const [menuHowtoOnMount, setMenuHowtoOnMount] = useState(false);
  /** 一度ゲームを開始したら Cesium を破棄せず裏に残し、再入場の白画面を防ぐ。 */
  const [gameLayerMounted, setGameLayerMounted] = useState(false);
  const construction = useConstruction();
  // 仮配置（preview）も含め、設置調整中から影響圏を地図に出す。
  // 数値の治水効果は floodSimulation 側で preview を除外する。
  const flood = useFloodSimulation(construction.visiblePlacements);
  const socket = useGameSocket(REALTIME_ENABLED && playMode === "multi");
  const mapRef = useRef<CesiumGameMapHandle>(null);
  const dragRef = useRef<DockDragState | null>(null);
  const lastMoveSentAtRef = useRef(0);
  const [drag, setDrag] = useState<DockDragState | null>(null);

  const inGame = lobbyScreen === "game";

  useEffect(() => {
    if (!inGame) {
      return;
    }
    construction.setEconomyPhase(flood.phase);
  }, [inGame, flood.phase, construction.setEconomyPhase]);

  // 開発時のみ E2E から配置・状況取得できるようにする。
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    const api = {
      inGame: () => lobbyScreen === "game",
      getFlood: () => flood.getLatestState(),
      startRain: () => {
        flood.startRainNow();
      },
      advance: (seconds: number) => flood.advanceForTest(seconds),
      setBudget: (amount: number) => {
        construction.setBudgetForTest(amount);
      },
      place: (
        structureId: string,
        longitude: number,
        latitude: number,
        headingDegrees: number,
      ) =>
        construction.placeConfirmedForTest(
          structureId,
          { longitude, latitude, height: 20 },
          headingDegrees,
        ),
      placementCount: () => construction.placements.length,
    };
    (window as Window & { __civilcraftE2E?: typeof api }).__civilcraftE2E = api;
    return () => {
      delete (window as Window & { __civilcraftE2E?: typeof api }).__civilcraftE2E;
    };
  }, [
    construction.placeConfirmedForTest,
    construction.placements.length,
    construction.setBudgetForTest,
    flood.advanceForTest,
    flood.getLatestState,
    flood.startRainNow,
    lobbyScreen,
  ]);

  const beginDockDrag = useCallback(
    (structureId: string, startX: number, startY: number, x: number, y: number) => {
      const structure = construction.structures.find(({ id }) => id === structureId);
      if (structure === undefined) {
        return;
      }
      if (construction.budget < structure.constructionCost) {
        construction.setMessage("予算不足");
        return;
      }
      const moved = Math.hypot(x - startX, y - startY);
      const ghost =
        moved >= DOCK_DRAG_PLACE_THRESHOLD_PX
          ? mapRef.current?.updateDragGhost(structureId, x, y)
          : undefined;
      const next: DockDragState = {
        structureId,
        displayName: structure.displayName,
        startX,
        startY,
        x,
        y,
        overMap: ghost?.overMap === true,
        placeable: ghost?.placeable === true,
      };
      dragRef.current = next;
      setDrag(next);
    },
    [construction],
  );

  const handleDropPlace = useCallback(
    (structureId: string, position: GeoPosition, headingDegrees: number) => {
      construction.beginPendingPlacement(structureId, position, headingDegrees);
    },
    [construction],
  );

  const handleConfirmPlacement = useCallback(() => {
    const placement = construction.confirmPendingPlacement();
    if (placement === null) {
      return;
    }
    socket.sendPlaceStructure({
      structureId: placement.structureId,
      position: placement.position,
      headingDegrees: placement.headingDegrees,
      clientPlacementId: placement.id,
    });
  }, [construction.confirmPendingPlacement, socket]);

  useEffect(() => {
    if (!inGame || construction.pendingPlacement === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        construction.cancelPendingPlacement();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        handleConfirmPlacement();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    inGame,
    construction.cancelPendingPlacement,
    construction.pendingPlacement,
    handleConfirmPlacement,
  ]);

  const handleCameraFocusChange = useCallback(
    (position: GeoPosition) => {
      const now = Date.now();
      if (now - lastMoveSentAtRef.current < MOVE_SEND_THROTTLE_MS) {
        return;
      }
      lastMoveSentAtRef.current = now;
      socket.sendMove({ position });
    },
    [socket],
  );

  const enterMenu = useCallback(() => {
    setMenuHowtoOnMount(false);
    setLobbyScreen("menu");
  }, []);

  const handleMenuStart = useCallback(
    (mode: PlayMode) => {
      setPlayMode(mode);
      construction.resetSession();
      flood.startFreshGame();
      setGameLayerMounted(true);
      setLobbyScreen("game");
    },
    [construction.resetSession, flood.startFreshGame],
  );

  const handleReturnToMenu = useCallback(() => {
    construction.resetSession();
    flood.restart();
    setPlayMode(null);
    setMenuHowtoOnMount(false);
    setLobbyScreen("menu");
  }, [construction.resetSession, flood.restart]);

  const isDockDragging = drag !== null;
  const isReviewing = flood.phase === "review";
  const hideConstructionUi = !inGame || flood.phase === "result" || isReviewing;

  useEffect(() => {
    if (!inGame || !isDockDragging) {
      return;
    }
    const map = mapRef.current;

    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (current === null) {
        return;
      }
      const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      const ghost =
        moved >= DOCK_DRAG_PLACE_THRESHOLD_PX
          ? mapRef.current?.updateDragGhost(
              current.structureId,
              event.clientX,
              event.clientY,
            )
          : undefined;
      const next: DockDragState = {
        ...current,
        x: event.clientX,
        y: event.clientY,
        overMap: ghost?.overMap === true,
        placeable: ghost?.placeable === true,
      };
      dragRef.current = next;
      if (
        current.overMap !== next.overMap ||
        current.placeable !== next.placeable ||
        !next.overMap
      ) {
        setDrag(next);
      }
    };

    const onUp = (event: PointerEvent) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      mapRef.current?.clearDragGhost();
      if (current === null) {
        return;
      }
      const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      if (moved < DOCK_DRAG_PLACE_THRESHOLD_PX) {
        return;
      }
      mapRef.current?.tryDropStructure(current.structureId, event.clientX, event.clientY);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      map?.clearDragGhost();
    };
  }, [inGame, isDockDragging]);

  return (
    <>
      {lobbyScreen === "title" ? (
        <main className="game-shell game-shell--lobby">
          <TitleScreen onEnter={enterMenu} />
        </main>
      ) : null}

      {lobbyScreen === "menu" ? (
        <main className="game-shell game-shell--lobby">
          <GameMenuScreen
            onBackToTitle={() => setLobbyScreen("title")}
            onStartGame={handleMenuStart}
            openHowtoOnMount={menuHowtoOnMount}
          />
        </main>
      ) : null}

      {gameLayerMounted ? (
        <main
          className={`game-shell${drag !== null ? " is-dock-dragging" : ""}${isReviewing ? " is-reviewing" : ""}${inGame ? "" : " is-dormant"}`}
          aria-hidden={!inGame}
        >
          <div className="game-shell__veil game-shell__veil--top" aria-hidden="true" />
          <div className="game-shell__veil game-shell__veil--bottom" aria-hidden="true" />

          <RainOverlay
            active={
              inGame &&
              (flood.phase === "disaster" ||
                flood.phase === "result" ||
                flood.phase === "review")
            }
            getLatestState={flood.getLatestState}
          />

          <Suspense fallback={<MapBootFallback />}>
            <CesiumGameMap
              ref={mapRef}
              mapActive={inGame}
              placements={construction.visiblePlacements}
              structures={construction.structures}
              selectedPlacementId={construction.selectedPlacementId}
              onDropPlace={handleDropPlace}
              onRotatePlacement={construction.rotatePlacement}
              onMovePendingPlacement={construction.movePendingPlacement}
              onSelectPlacement={construction.setSelectedPlacementId}
              onInvalidPosition={construction.setMessage}
              onConfirmPendingPlacement={handleConfirmPlacement}
              onCancelPendingPlacement={construction.cancelPendingPlacement}
              onCameraFocusChange={handleCameraFocusChange}
              freeCameraLook={isReviewing}
              floodState={{
                active:
                  flood.phase === "disaster" ||
                  flood.phase === "result" ||
                  flood.phase === "review",
                phase: flood.phase,
                rainfallIntensity: flood.rainfallIntensity,
                riverLevelMeters: flood.riverLevelMeters,
                overflowMeters: flood.overflowMeters,
                floodDepthMeters: flood.floodDepthMeters,
                floodedAreaPercent: flood.floodedAreaPercent,
                floodplainFillRatio: flood.floodplainFillRatio,
                floodplainHalfWidthMeters: flood.floodplainHalfWidthMeters,
                overflowLevelMeters: flood.overflowLevelMeters,
                overflowSites: flood.overflowSites,
                protectedBankSites: flood.protectedBankSites,
                structureInfluences: flood.structureInfluences,
                mitigationCalm: Math.min(
                  1,
                  flood.mitigation.overflowPrevention * 0.65 +
                    flood.mitigation.waterLevelReduction * 0.5 +
                    flood.mitigation.channelCapacityIncrease * 0.2,
                ),
              }}
              getLatestFloodState={flood.getLatestState}
            />
          </Suspense>

          {inGame && !hideConstructionUi ? (
            <FloodHud
              phase={flood.phase}
              phaseRemainingSeconds={flood.phaseRemainingSeconds}
              rainfallIntensity={flood.rainfallIntensity}
              riverLevelMeters={flood.riverLevelMeters}
              overflowMeters={flood.overflowMeters}
              floodDepthMeters={flood.floodDepthMeters}
              damagePercent={flood.damagePercent}
              overflowSites={flood.overflowSites}
              mitigation={flood.mitigation}
              onStartGame={flood.startGame}
              onStartRainNow={flood.startRainNow}
            />
          ) : null}

          {inGame && !hideConstructionUi ? (
            <header className="game-header game-header--budget-only">
              <div className="game-header__row">
                <div className="budget-panel" aria-label="残り予算">
                  <div className="budget-panel__meta">
                    <span>BUDGET</span>
                    <strong key={Math.round(construction.budget)}>
                      {formatBudget(construction.budget)}
                    </strong>
                    {construction.incomeLabel !== "" ? (
                      <em
                        className={`budget-panel__rate${construction.netIncomePerSecond < 0 ? " is-drain" : ""}`}
                        title="収入 − 維持コスト"
                      >
                        {construction.incomeLabel}
                      </em>
                    ) : null}
                  </div>
                  <div className="budget-panel__track" aria-hidden="true">
                    <div
                      className="budget-panel__fill"
                      style={{ width: `${construction.budgetRatio * 100}%` }}
                    />
                  </div>
                </div>
                {playMode === "multi" ? (
                  <div
                    className={`socket-status socket-status--${socket.status}`}
                    role="status"
                    title={socket.playerId ?? undefined}
                  >
                    <span className="socket-status__dot" aria-hidden="true" />
                    <span>{statusLabel[socket.status] ?? socket.status}</span>
                  </div>
                ) : null}
              </div>
            </header>
          ) : null}

          {inGame && !hideConstructionUi ? (
            <GameToast message={construction.message} tone={construction.messageTone} />
          ) : null}

          {inGame && !hideConstructionUi ? (
            <ConstructionMenu
              budget={construction.budget}
              selectedStructureId={construction.selectedStructureId}
              structures={construction.structures}
              onSelect={construction.selectStructure}
              onDragStart={beginDockDrag}
            />
          ) : null}

          {inGame && drag !== null && !drag.overMap ? (
            <div
              className="dock-drag-ghost dock-drag-ghost--lift"
              style={{ left: drag.x, top: drag.y }}
              aria-hidden="true"
            >
              <span className="dock-drag-ghost__hint">川へドロップ</span>
              <span>{drag.displayName}</span>
            </div>
          ) : null}
          {inGame && drag !== null && drag.overMap ? (
            <div
              className={`dock-drag-ghost dock-drag-ghost--map${drag.placeable ? " is-placeable" : " is-blocked"}`}
              style={{ left: drag.x, top: drag.y + 56 }}
              aria-hidden="true"
            >
              <span>{drag.placeable ? `${drag.displayName} OK` : "配置帯の上へ"}</span>
            </div>
          ) : null}

          {inGame ? (
            <FloodResultPanel
              phase={flood.phase}
              isClear={flood.isClear}
              damagePercent={flood.damagePercent}
              score={flood.score}
              placementCount={construction.placements.length}
              onEnterReview={flood.enterReviewMode}
              onStartNewGame={handleReturnToMenu}
            />
          ) : null}

          {inGame && isReviewing ? (
            <ReviewModeBar
              isClear={flood.isClear}
              score={flood.score}
              onShowResult={flood.reopenResultPanel}
              onStartNewGame={handleReturnToMenu}
            />
          ) : null}
        </main>
      ) : null}
    </>
  );
}
