import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import type { CesiumGameMapHandle } from "./components/GameCanvas/CesiumGameMap";
import { MapBootFallback } from "./components/GameCanvas/MapBootFallback";
import { GameToast } from "./components/GameToast";
import { ConstructionMenu, useConstruction } from "./features/construction";
import type { GeoPosition } from "./features/construction/types/construction";
import { CommandStatusPanel } from "./features/hud/CommandStatusPanel";
import { HudLegend } from "./features/hud/HudLegend";
import { HudMinimap } from "./features/hud/HudMinimap";
import { MobileHudPanel } from "./features/hud/MobileHudPanel";
import { TutorialCoachmark } from "./features/hud/TutorialCoachmark";
import { hasSeenTutorial, markTutorialDone } from "./features/hud/tutorialStorage";
import "./command-hud.css";
import {
  FloodHud,
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
const MOVE_SEND_THROTTLE_MS = 400;
/** ローカル単独プレイではWS再接続を止め、開発サーバーのプロキシ負荷を避ける。 */
const REALTIME_ENABLED = import.meta.env.VITE_REALTIME_ENABLED === "true";

const statusLabel: Record<string, string> = {
  connecting: "同期中",
  connected: "連携中",
  disconnected: "単独プレイ",
  error: "通信エラー",
};

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
  const flood = useFloodSimulation(construction.visiblePlacements);
  const { advanceForTest, getLatestState, phase, restart, startFreshGame, startRainNow } = flood;
  const socket = useGameSocket(REALTIME_ENABLED && playMode === "multi");
  const mapRef = useRef<CesiumGameMapHandle>(null);
  const dragRef = useRef<DockDragState | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const lastMoveSentAtRef = useRef(0);
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
    if (!inGame) {
      return;
    }
    setEconomyPhase(phase);
  }, [inGame, phase, setEconomyPhase]);

  useEffect(() => {
    resetSession();
    startFreshGame();
  }, [sessionId, resetSession, startFreshGame]);

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
        setMessage("仮配置しました。位置と向きを調整して確定してください。", "info");
      }
    },
    [beginPendingPlacement, setMessage],
  );

  const handleConfirmPlacement = useCallback(() => {
    const placement = confirmPendingPlacement();
    if (placement === null) {
      return;
    }
    markTutorialDone();
    setShowTutorial(false);
    socket.sendPlaceStructure({
      structureId: placement.structureId,
      position: placement.position,
      headingDegrees: placement.headingDegrees,
      clientPlacementId: placement.id,
    });
  }, [confirmPendingPlacement, socket]);

  useEffect(() => {
    if (!inGame || talking || pendingPlacement === null) {
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
  }, [inGame, talking, cancelPendingPlacement, pendingPlacement, handleConfirmPlacement]);

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

  const handleReturnToMenu = useCallback(() => {
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
        <CesiumGameMap
          ref={mapRef}
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
          floodState={{
            active:
              flood.phase === "disaster" || flood.phase === "result" || flood.phase === "review",
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

      {npc.available && !talking ? (
        <div className="npc-prototype-note">住民アイコンで地域や技術の話を聞けます</div>
      ) : null}
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
          <FloodHud
            phase={flood.phase}
            phaseRemainingSeconds={flood.phaseRemainingSeconds}
            rainfallIntensity={flood.rainfallIntensity}
            riverLevelMeters={flood.riverLevelMeters}
            overflowMeters={flood.overflowMeters}
            floodDepthMeters={flood.floodDepthMeters}
            damagePercent={flood.damagePercent}
            overflowSites={flood.overflowSites}
            floodedAreaPercent={flood.floodedAreaPercent}
            mitigation={flood.mitigation}
            onStartGame={flood.startGame}
            onStartRainNow={flood.startRainNow}
            onExit={handleReturnToMenu}
          />

          <CommandStatusPanel
            budget={construction.budget}
            budgetRatio={construction.budgetRatio}
            incomeLabel={construction.incomeLabel}
            netIncomePerSecond={construction.netIncomePerSecond}
            damagePercent={flood.damagePercent}
            mitigation={flood.mitigation}
            socketStatus={playMode === "multi" ? socket.status : undefined}
            socketLabel={playMode === "multi" ? statusLabel[socket.status] : undefined}
          />

          <div className="hud-frame__desktop">
            <HudLegend phase={flood.phase} />
            <HudMinimap
              damagePercent={flood.damagePercent}
              overflowSiteCount={flood.overflowSites.length}
            />
          </div>

          <MobileHudPanel
            phase={flood.phase}
            damagePercent={flood.damagePercent}
            overflowSiteCount={flood.overflowSites.length}
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
              施設の影響圏
            </span>
            <span>
              <i
                className="review-mode-legend__swatch review-mode-legend__swatch--risk"
                aria-hidden="true"
              />
              決壊・注意地点
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
