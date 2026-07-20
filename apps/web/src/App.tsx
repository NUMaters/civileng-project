import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { CesiumGameMap, type CesiumGameMapHandle } from "./components/GameCanvas/CesiumGameMap";
import {
  ConstructionMenu,
  getStructureVisual,
  useConstruction,
} from "./features/construction";
import { formatBudget, INITIAL_BUDGET } from "./features/construction/services/constructionService";
import type { GeoPosition } from "./features/construction/types/construction";
import { FloodHud, FloodResultPanel, useFloodSimulation } from "./features/disaster";
import { useGameSocket } from "./features/realtime/hooks/useGameSocket";

type DockDragState = {
  structureId: string;
  displayName: string;
  imageSrc: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
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
  const budgetRatio = Math.max(0, Math.min(1, construction.budget / INITIAL_BUDGET));

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
        imageSrc: getStructureVisual(structureId).imageSrc,
        startX: clientX,
        startY: clientY,
        x: clientX,
        y: clientY,
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

  useEffect(() => {
    if (drag === null) {
      return;
    }

    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (current === null) {
        return;
      }
      const next = { ...current, x: event.clientX, y: event.clientY };
      dragRef.current = next;
      setDrag(next);
    };

    const onUp = (event: PointerEvent) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
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
    };
  }, [drag]);

  return (
    <main className={`game-shell${drag !== null ? " is-dock-dragging" : ""}`}>
      <div className="game-shell__veil game-shell__veil--top" aria-hidden="true" />
      <div className="game-shell__veil game-shell__veil--bottom" aria-hidden="true" />

      <CesiumGameMap
        ref={mapRef}
        placements={construction.visiblePlacements}
        structures={construction.structures}
        selectedPlacementId={construction.selectedPlacementId}
        onDropPlace={handleDropPlace}
        onRotatePlacement={construction.rotatePlacement}
        onSelectPlacement={construction.setSelectedPlacementId}
        onInvalidPosition={construction.setMessage}
        onCameraFocusChange={handleCameraFocusChange}
        floodState={{
          // 準備中も影響圏を出す。越水プルーム等は災害中のみ。
          active: flood.phase === "disaster" || flood.phase === "result",
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
      />

      <FloodHud {...flood} onStartGame={flood.startGame} onStartRainNow={flood.startRainNow} />

      <header className="game-header game-header--budget-only">
        <div className="game-header__row">
          <div className="budget-panel" aria-label="残り予算">
            <div className="budget-panel__meta">
              <span>BUDGET</span>
              <strong key={construction.budget}>{formatBudget(construction.budget)}</strong>
            </div>
            <div className="budget-panel__track" aria-hidden="true">
              <div className="budget-panel__fill" style={{ width: `${budgetRatio * 100}%` }} />
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

      {construction.pendingPlacement !== null ? (
        <div className="placement-confirm" role="region" aria-label="仮配置の確定">
          <p className="placement-confirm__copy">向きは施設前のスライダーで調整</p>
          <div className="placement-confirm__actions">
            <button
              type="button"
              className="placement-confirm__cancel"
              onClick={construction.cancelPendingPlacement}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="placement-confirm__confirm"
              onClick={handleConfirmPlacement}
            >
              確定して配置
            </button>
          </div>
        </div>
      ) : null}

      {construction.message !== "" ? (
        <p key={construction.message} className="game-toast" role="status">
          {construction.message}
        </p>
      ) : null}

      <ConstructionMenu
        budget={construction.budget}
        selectedStructureId={construction.selectedStructureId}
        structures={construction.structures}
        onSelect={construction.selectStructure}
        onDragStart={beginDockDrag}
      />

      {drag !== null ? (
        <div className="dock-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <span className="dock-drag-ghost__icon">
            <img src={drag.imageSrc} alt="" draggable={false} width={56} height={56} />
          </span>
          <span>{drag.displayName}</span>
        </div>
      ) : null}

      <FloodResultPanel
        {...flood}
        usedBudget={INITIAL_BUDGET - construction.budget}
        placementCount={construction.placements.length}
        onRestart={flood.restart}
      />
    </main>
  );
}
