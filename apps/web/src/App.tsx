import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { CesiumGameMap, type CesiumGameMapHandle } from "./components/GameCanvas/CesiumGameMap";
import { ConstructionMenu, useConstruction } from "./features/construction";
import { formatBudget } from "./features/construction/services/constructionService";
import type { GeoPosition } from "./features/construction/types/construction";
import { FloodHud, FloodResultPanel, ReviewModeBar, useFloodSimulation } from "./features/disaster";
import { useGameSocket } from "./features/realtime/hooks/useGameSocket";

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
  connecting: "接続中",
  connected: "オンライン",
  disconnected: "オフライン",
  error: "接続エラー",
};

export function App() {
  const construction = useConstruction();
  const flood = useFloodSimulation(construction.placements);
  const socket = useGameSocket(REALTIME_ENABLED);
  const mapRef = useRef<CesiumGameMapHandle>(null);
  const dragRef = useRef<DockDragState | null>(null);
  const lastMoveSentAtRef = useRef(0);
  const [drag, setDrag] = useState<DockDragState | null>(null);

  useEffect(() => {
    construction.setEconomyPhase(flood.phase);
  }, [flood.phase, construction.setEconomyPhase]);

  const beginDockDrag = useCallback(
    (structureId: string, clientX: number, clientY: number) => {
      const structure = construction.structures.find(({ id }) => id === structureId);
      if (structure === undefined) {
        return;
      }
      if (construction.budget < structure.constructionCost) {
        construction.setMessage("予算が足りません");
        return;
      }
      const next: DockDragState = {
        structureId,
        displayName: structure.displayName,
        startX: clientX,
        startY: clientY,
        x: clientX,
        y: clientY,
        overMap: false,
        placeable: false,
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
    if (construction.pendingPlacement === null) {
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

  const handleStartNewGame = useCallback(() => {
    construction.resetSession();
    flood.startFreshGame();
  }, [construction.resetSession, flood.startFreshGame]);

  const isDockDragging = drag !== null;
  const isReviewing = flood.phase === "review";
  const hideConstructionUi = flood.phase === "result" || isReviewing;

  useEffect(() => {
    if (!isDockDragging) {
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
      // 地図上では 3D ゴーストが本体なので、HTML 更新は状態変化時／地図外だけ。
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
  }, [isDockDragging]);

  return (
    <main
      className={`game-shell${drag !== null ? " is-dock-dragging" : ""}${isReviewing ? " is-reviewing" : ""}`}
    >
      <div className="game-shell__veil game-shell__veil--top" aria-hidden="true" />
      <div className="game-shell__veil game-shell__veil--bottom" aria-hidden="true" />

      <CesiumGameMap
        ref={mapRef}
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
          // 結果・プレビュー中も最終の浸水状態を残す。
          active:
            flood.phase === "disaster" ||
            flood.phase === "result" ||
            flood.phase === "review",
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

      {!hideConstructionUi ? (
        <FloodHud
          phase={flood.phase}
          phaseRemainingSeconds={flood.phaseRemainingSeconds}
          disasterElapsedSeconds={flood.disasterElapsedSeconds}
          rainfallIntensity={flood.rainfallIntensity}
          riverLevelMeters={flood.riverLevelMeters}
          overflowMeters={flood.overflowMeters}
          overflowLevelMeters={flood.overflowLevelMeters}
          floodDepthMeters={flood.floodDepthMeters}
          floodedAreaPercent={flood.floodedAreaPercent}
          floodplainFillRatio={flood.floodplainFillRatio}
          floodplainHalfWidthMeters={flood.floodplainHalfWidthMeters}
          damagePercent={flood.damagePercent}
          score={flood.score}
          isClear={flood.isClear}
          overflowSites={flood.overflowSites}
          mitigation={flood.mitigation}
          protectedBankSites={flood.protectedBankSites}
          structureInfluences={flood.structureInfluences}
          onStartGame={flood.startGame}
          onStartRainNow={flood.startRainNow}
        />
      ) : null}

      {!hideConstructionUi ? (
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
                    title="補給 − 維持費"
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
            <div
              className={`socket-status socket-status--${socket.status}`}
              role="status"
              title={socket.playerId ?? undefined}
            >
              <span className="socket-status__dot" aria-hidden="true" />
              <span>{statusLabel[socket.status] ?? socket.status}</span>
            </div>
          </div>
        </header>
      ) : null}

      {construction.message !== "" && !hideConstructionUi ? (
        <p key={construction.message} className="game-toast" role="status">
          {construction.message}
        </p>
      ) : null}

      {!hideConstructionUi ? (
        <ConstructionMenu
          budget={construction.budget}
          selectedStructureId={construction.selectedStructureId}
          structures={construction.structures}
          onSelect={construction.selectStructure}
          onDragStart={beginDockDrag}
        />
      ) : null}

      {drag !== null && !drag.overMap ? (
        <div
          className="dock-drag-ghost dock-drag-ghost--lift"
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <span className="dock-drag-ghost__hint">地図へドラッグして配置</span>
          <span>{drag.displayName}</span>
        </div>
      ) : null}
      {drag !== null && drag.overMap ? (
        <div
          className={`dock-drag-ghost dock-drag-ghost--map${drag.placeable ? " is-placeable" : " is-blocked"}`}
          style={{ left: drag.x, top: drag.y + 56 }}
          aria-hidden="true"
        >
          <span>{drag.placeable ? `${drag.displayName}を配置` : "河道・河岸へ"}</span>
        </div>
      ) : null}

      <FloodResultPanel
        phase={flood.phase}
        isClear={flood.isClear}
        damagePercent={flood.damagePercent}
        floodedAreaPercent={flood.floodedAreaPercent}
        floodDepthMeters={flood.floodDepthMeters}
        score={flood.score}
        usedBudget={construction.spentBudget}
        placementCount={construction.placements.length}
        onEnterReview={flood.enterReviewMode}
        onStartNewGame={handleStartNewGame}
      />

      {isReviewing ? (
        <ReviewModeBar
          isClear={flood.isClear}
          score={flood.score}
          onShowResult={flood.reopenResultPanel}
          onStartNewGame={handleStartNewGame}
        />
      ) : null}
    </main>
  );
}
