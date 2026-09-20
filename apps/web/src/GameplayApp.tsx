import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { DioramaGameMapHandle } from "./components/GameCanvas/DioramaGameMap";
import { MapBootFallback } from "./components/GameCanvas/MapBootFallback";
import { GameToast } from "./components/GameToast";
import { ConstructionMenu, useConstruction } from "./features/construction";
import type { GeoPosition } from "./features/construction/types/construction";
import { RiverMissionHud } from "./features/hud/RiverMissionHud";
import { getPlacementFeedback } from "./features/hud/riverMissionFeedback";
import { calculateStructureInfluences } from "./features/disaster/services/floodSimulation";
import { TutorialCoachmark } from "./features/hud/TutorialCoachmark";
import { hasSeenTutorial, markTutorialDone } from "./features/hud/tutorialStorage";
import "./command-hud.css";
import "./river-game.css";
import {
  FloodResultPanel,
  RainOverlay,
  ReviewModeBar,
  useFloodSimulation,
} from "./features/disaster";
import "./features/disaster/components/review-mode.css";
import type { PlayMode } from "./features/lobby/types";
import { NpcDialoguePanel } from "./features/npc/NpcDialoguePanel";
import { npcEnabled, npcs } from "./features/npc/catalog";
import { disasterResponse } from "./features/npc/disasterResponse";
import { NpcSources } from "./features/npc/NpcSources";
import { useNpcDialogue } from "./features/npc/useNpcDialogue";
import { useGameSocket } from "./features/realtime/hooks/useGameSocket";
import "./features/npc/npc.css";

/** タイトル／メニューでは Cesium（約 10MB+）を読まず、真っ白待ちを防ぐ。 */
const DioramaGameMap = lazy(async () => {
  const mod = await import("./components/GameCanvas/DioramaGameMap");
  return { default: mod.DioramaGameMap };
});

type DockDragState = {
  structureId: string;
  displayName: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  pointerId: number;
  /** 地図上で 3D 施設ゴーストを表示中。 */
  overMap: boolean;
  placeable: boolean;
};

/** ドックから地図への配置ドラッグを確定する最小移動量（CSS px）。 */
const DOCK_DRAG_PLACE_THRESHOLD_PX = 18;
/** 配置ゴーストを出し始める移動量（意図ロック直後から追従させる）。 */
const DOCK_DRAG_GHOST_THRESHOLD_PX = 10;
/** カメラ移動の WS 送信スロットル（ms）。 */
/** ローカル単独プレイではWS再接続を止め、開発サーバーのプロキシ負荷を避ける。 */
const REALTIME_ENABLED = import.meta.env.VITE_REALTIME_ENABLED === "true";

type GameplayAppProps = {
  playMode: PlayMode;
  inGame: boolean;
  sessionId: number;
  onReturnToMenu: () => void;
};

/** 本編（地図・配置・洪水）。タイトル／メニューからは遅延読込する。 */
export function GameplayApp({ playMode, inGame, sessionId, onReturnToMenu }: GameplayAppProps) {
  const construction = useConstruction();
  const {
    budget,
    beginPendingPlacement,
    cancelPendingPlacement,
    confirmPendingPlacement,
    pendingPlacement,
    placeConfirmedForTest,
    placements,
    resetSession,
    setBudgetForTest,
    setEconomyPhase,
    setMessage,
    structures,
  } = construction;
  // 仮配置（preview）も含め、設置調整中から影響圏を地図に出す。
  // 数値の治水効果は floodSimulation 側で preview を除外する。
  const [paused, setPaused] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const flood = useFloodSimulation(construction.visiblePlacements, paused || !inGame || !mapReady);
  const { advanceForTest, getLatestState, phase, restart, startFreshGame, startRainNow } = flood;
  const socket = useGameSocket(REALTIME_ENABLED && playMode === "multi");
  const mapRef = useRef<DioramaGameMapHandle>(null);
  const [floodFocus, setFloodFocus] = useState({ available: false, viewing: false });
  const dragRef = useRef<DockDragState | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DockDragState | null>(null);
  const [showTutorial, setShowTutorial] = useState(() => !hasSeenTutorial());
  const npc = useNpcDialogue(npcEnabled && inGame && playMode === "solo", phase, getLatestState);
  const talking = npc.activeNpc !== null;
  const recommendedNpc = npcs.find((person) => person.id === npc.state.highlightedNpcId);
  const openDialogue = npc.open;
  const openNpc = useCallback(
    (npcId: string) => {
      if (dragRef.current !== null) return;
      openDialogue(npcId);
    },
    [openDialogue],
  );

  useEffect(() => {
    resetSession();
    startFreshGame();
    setPaused(false);
    mapRef.current?.resetCamera();
  }, [sessionId, resetSession, startFreshGame]);

  useEffect(() => {
    setEconomyPhase(inGame && !paused && mapReady ? phase : "idle");
  }, [inGame, phase, paused, mapReady, sessionId, setEconomyPhase]);

  // 開発時のみ E2E から配置・状況取得できるようにする。
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    const api = {
      inGame: () => inGame,
      getFlood: () => getLatestState(),
      startRain: (weatherSeed?: number) => {
        startRainNow(weatherSeed);
      },
      advance: (seconds: number) => advanceForTest(seconds),
      setBudget: (amount: number) => {
        setBudgetForTest(amount);
      },
      place: (structureId: string, longitude: number, latitude: number, headingDegrees: number) =>
        placeConfirmedForTest(structureId, { longitude, latitude, height: 20 }, headingDegrees),
      placementCount: () => placements.length,
    };
    (window as Window & { __civilcraftE2E?: typeof api }).__civilcraftE2E = api;
    return () => {
      delete (window as Window & { __civilcraftE2E?: typeof api }).__civilcraftE2E;
    };
  }, [
    advanceForTest,
    getLatestState,
    inGame,
    placeConfirmedForTest,
    placements.length,
    setBudgetForTest,
    startRainNow,
  ]);

  const beginDockDrag = useCallback(
    (
      structureId: string,
      startX: number,
      startY: number,
      x: number,
      y: number,
      pointerId: number,
    ) => {
      const structure = structures.find(({ id }) => id === structureId);
      if (structure === undefined) {
        return;
      }
      if (budget < structure.constructionCost) {
        setMessage("予算不足");
        return;
      }
      const moved = Math.hypot(x - startX, y - startY);
      const ghost =
        moved >= DOCK_DRAG_GHOST_THRESHOLD_PX
          ? mapRef.current?.updateDragGhost(structureId, x, y)
          : undefined;
      const next: DockDragState = {
        structureId,
        displayName: structure.displayName,
        startX,
        startY,
        x,
        y,
        pointerId,
        overMap: ghost?.overMap === true,
        placeable: ghost?.placeable === true,
      };
      dragRef.current = next;
      setDrag(next);
    },
    [budget, setMessage, structures],
  );

  const handleDropPlace = useCallback(
    (structureId: string, position: GeoPosition, headingDegrees: number) => {
      const pending = beginPendingPlacement(structureId, position, headingDegrees);
      if (pending !== null) {
        setMessage("タップで回転・ドラッグで移動。✓で配置", "info");
      }
    },
    [beginPendingPlacement, setMessage],
  );

  const handleConfirmPlacement = useCallback(() => {
    const placement = confirmPendingPlacement();
    if (placement === null) {
      return;
    }
    const influence = calculateStructureInfluences([placement])[0];
    if (influence) {
      const feedback = getPlacementFeedback(influence);
      setMessage(
        feedback.tone === "warn" ? "設置しました。位置・向きの相性に注意" : "設置しました",
        feedback.tone,
      );
    }
    markTutorialDone();
    setShowTutorial(false);
    socket.sendPlaceStructure({
      structureId: placement.structureId,
      position: placement.position,
      headingDegrees: placement.headingDegrees,
      clientPlacementId: placement.id,
    });
  }, [confirmPendingPlacement, setMessage, socket]);

  useEffect(() => {
    if (!inGame || paused || talking || pendingPlacement === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPendingPlacement();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        handleConfirmPlacement();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inGame, paused, talking, cancelPendingPlacement, pendingPlacement, handleConfirmPlacement]);

  const handleCameraFocusChange = useCallback(
    (position: GeoPosition) => {
      // The map owns throttling and delivers the final settled position.
      // A second throttle here can discard that trailing update permanently.
      socket.sendMove({ position });
    },
    [socket],
  );

  const handleReturnToMenu = useCallback(() => {
    setPaused(false);
    resetSession();
    restart();
    onReturnToMenu();
  }, [onReturnToMenu, resetSession, restart]);

  const isDockDragging = drag !== null;
  const isReviewing = phase === "review";
  const hideConstructionUi = !inGame || phase === "result" || isReviewing;
  const hasPendingPlacement = pendingPlacement !== null;

  useEffect(() => {
    if (!inGame || !isDockDragging) {
      return;
    }
    const map = mapRef.current;

    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (current === null || event.pointerId !== current.pointerId) {
        return;
      }
      const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      const ghost =
        moved >= DOCK_DRAG_GHOST_THRESHOLD_PX
          ? mapRef.current?.updateDragGhost(current.structureId, event.clientX, event.clientY)
          : undefined;
      const next: DockDragState = {
        ...current,
        x: event.clientX,
        y: event.clientY,
        overMap: ghost?.overMap === true,
        placeable: ghost?.placeable === true,
      };
      dragRef.current = next;
      // 位置だけはReactの再描画を待たず、DOMへ直接反映する。
      // pointermoveごとのApp全体の再レンダーを避け、指の軌道へ1:1で追従させる。
      if (dragGhostRef.current !== null) {
        dragGhostRef.current.style.left = `${event.clientX}px`;
        dragGhostRef.current.style.top = `${event.clientY}px`;
      }
      if (current.overMap !== next.overMap || current.placeable !== next.placeable) {
        setDrag(next);
      }
    };

    const onUp = (event: PointerEvent) => {
      const current = dragRef.current;
      if (current !== null && event.pointerId !== current.pointerId) {
        return;
      }
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

    const onCancel = (event: PointerEvent) => {
      if (dragRef.current !== null && event.pointerId !== dragRef.current.pointerId) {
        return;
      }
      dragRef.current = null;
      setDrag(null);
      mapRef.current?.clearDragGhost();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      map?.clearDragGhost();
    };
  }, [inGame, isDockDragging]);

  const cesiumFloodState = useMemo(
    () => ({
      active: flood.phase === "disaster" || flood.phase === "result" || flood.phase === "review",
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
    }),
    [
      flood.floodDepthMeters,
      flood.floodedAreaPercent,
      flood.floodplainFillRatio,
      flood.floodplainHalfWidthMeters,
      flood.mitigation,
      flood.overflowLevelMeters,
      flood.overflowMeters,
      flood.overflowSites,
      flood.phase,
      flood.protectedBankSites,
      flood.rainfallIntensity,
      flood.riverLevelMeters,
      flood.structureInfluences,
    ],
  );

  return (
    <main
      className={`game-shell${drag !== null ? " is-dock-dragging" : ""}${hasPendingPlacement ? " is-pending-placement" : ""}${isReviewing ? " is-reviewing" : ""}${inGame ? "" : " is-dormant"}`}
      aria-hidden={!inGame}
    >
      <div className="game-shell__veil game-shell__veil--top" aria-hidden="true" />
      <div className="game-shell__veil game-shell__veil--bottom" aria-hidden="true" />

      <RainOverlay
        active={
          inGame &&
          (flood.phase === "disaster" || flood.phase === "result" || flood.phase === "review")
        }
        getLatestState={flood.getLatestState}
      />

      <Suspense fallback={<MapBootFallback />}>
        <DioramaGameMap
          ref={mapRef}
          onReadyChange={setMapReady}
          onFloodFocusChange={setFloodFocus}
          mapActive={inGame}
          npcMarkers={npc.available ? npcs : undefined}
          highlightedNpcId={npc.state.highlightedNpcId}
          onSelectNpc={openNpc}
          interactionLocked={talking}
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
          floodState={cesiumFloodState}
          getLatestFloodState={flood.getLatestState}
        />
      </Suspense>

      {npc.available && recommendedNpc && !talking ? (
        <div className="npc-guide" role="status">
          <span>
            {recommendedNpc.locationLabel}の{recommendedNpc.name}に聞いてみよう
          </span>
          <button type="button" onClick={() => mapRef.current?.focusNpc(recommendedNpc.position)}>
            場所を見る
          </button>
        </div>
      ) : null}
      {npc.activeNpc ? (
        <NpcDialoguePanel
          key={npc.activeNpc.id}
          npc={npc.activeNpc}
          phase={phase}
          history={npc.state.history}
          coolingDown={npc.coolingDown}
          pending={npc.pending}
          error={npc.error}
          disaster={disasterResponse(npc.activeNpc, flood)}
          onClose={npc.close}
          onAsk={npc.ask}
          onRefer={npc.refer}
          furigana={npc.furigana}
          onFuriganaChange={npc.setFurigana}
        />
      ) : null}

      {inGame && !hideConstructionUi ? (
        <div className="hud-frame" aria-hidden={false}>
          <RiverMissionHud
            flood={flood}
            budget={construction.budget}
            incomeLabel={construction.incomeLabel}
            paused={paused}
            onPause={setPaused}
            onStartRain={flood.startRainNow}
            onExit={handleReturnToMenu}
          />
        </div>
      ) : null}

      {inGame && showTutorial && !hideConstructionUi ? (
        <TutorialCoachmark
          phase={flood.phase}
          hasPlacement={construction.placements.length > 0}
          hasPendingPlacement={hasPendingPlacement}
          onDismiss={() => {
            markTutorialDone();
            setShowTutorial(false);
          }}
        />
      ) : null}

      {inGame && phase !== "result" && !hasPendingPlacement ? (
        <button
          type="button"
          className={`river-recenter${floodFocus.available || floodFocus.viewing ? " river-recenter--flood" : ""}`}
          aria-label={floodFocus.viewing ? "元の視点へ" : floodFocus.available ? "浸水を見る" : "川の中心へ視点を戻す"}
          onClick={() => floodFocus.viewing ? mapRef.current?.returnFromFlood()
            : floodFocus.available ? mapRef.current?.focusRenderedFlood() : mapRef.current?.resetCamera()}
        >
          {floodFocus.available || floodFocus.viewing ? <span>{floodFocus.viewing ? "元の視点へ" : "浸水を見る"}</span> :
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="6" />
            <path d="M12 2v5m0 10v5M2 12h5m10 0h5" />
          </svg>
          }
        </button>
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
          ref={dragGhostRef}
          className="dock-drag-ghost dock-drag-ghost--lift"
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <span className="dock-drag-ghost__hint">川へドロップ</span>
          <span>{drag.displayName}</span>
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
          onRetry={() => {
            resetSession();
            startFreshGame();
            mapRef.current?.resetCamera();
          }}
        >
          <NpcSources factIds={npc.state.usedFactIds} />
        </FloodResultPanel>
      ) : null}

      {inGame && isReviewing ? (
        <>
          <div className="review-mode-legend" role="region" aria-label="マップ凡例">
            <strong>マップ凡例</strong>
            <span>
              <i
                className="review-mode-legend__swatch review-mode-legend__swatch--flood"
                aria-hidden="true"
              />
              浸水・被災範囲
            </span>
            <span>
              <i
                className="review-mode-legend__swatch review-mode-legend__swatch--influence"
                aria-hidden="true"
              />
              配置した治水施設
            </span>
          </div>
          <ReviewModeBar
            isClear={flood.isClear}
            score={flood.score}
            onShowResult={flood.reopenResultPanel}
            onStartNewGame={handleReturnToMenu}
          />
        </>
      ) : null}
    </main>
  );
}
