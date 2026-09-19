import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PlacementConfirmBar } from "./features/hud/PlacementConfirmBar";
import { PauseMenu } from "./features/hud/PauseMenu";
import { NpcHud } from "./features/npc/NpcHud";
import { isWithinNpcInteraction } from "./features/npc/npcProximity";
import { formatNpcName, useNpcCatalog } from "./features/npc/npcApi";
import {
  hasSeenTutorial,
  markTutorialDone,
  TutorialCoachmark,
} from "./features/hud/TutorialCoachmark";
import "./command-hud.css";
import {
  FloodHud,
  FloodResultPanel,
  RainOverlay,
  ReviewModeBar,
  useFloodSimulation,
} from "./features/disaster";
import { PhaseBanner } from "./features/disaster/components/PhaseBanner";
import { computeResultRank } from "./features/disaster/services/resultScore";
import type { PlayMode } from "./features/lobby/types";
import { useGameSocket } from "./features/realtime/hooks/useGameSocket";
import {
  getDockDragThresholds,
  isCoarsePointerDevice,
  triggerLightHaptic,
  triggerPlacementHaptic,
} from "./lib/deviceInput";
import { playGameSfx } from "./lib/gameFeedback";
import { bindDockStackHeight } from "./lib/hudLayout";

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

/** ドックから地図への配置ドラッグを確定する最小移動量（CSS px）。端末別に上書き。 */
const dockDragThresholds = getDockDragThresholds();
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
  onRetrySession: () => void;
};

/** 本編（地図・配置・洪水）。タイトル／メニューからは遅延読込する。 */
export function GameplayApp({
  playMode,
  inGame,
  sessionId,
  onReturnToMenu,
  onRetrySession,
}: GameplayAppProps) {
  const construction = useConstruction();
  // Pause state is consumed by the flood simulation below; initialize it
  // before that hook so the first render does not hit the temporal dead zone.
  const [paused, setPaused] = useState(false);
  // 仮配置（preview）も含め、設置調整中から影響圏を地図に出す。
  // 数値の治水効果は floodSimulation 側で preview を除外する。
  const flood = useFloodSimulation(construction.visiblePlacements, inGame && !paused);
  const npcCatalog = useNpcCatalog();
  const [cameraFocus, setCameraFocus] = useState<GeoPosition | null>(null);
  const [npcDialogueOpen, setNpcDialogueOpen] = useState(false);
  const npcMarker = useMemo(() => {
    const npc = npcCatalog?.definitions[0];
    if (!npc) {
      return null;
    }
    return {
      id: npc.id,
      longitude: npc.position.longitude,
      latitude: npc.position.latitude,
      height: npc.position.height,
      label: formatNpcName(npc),
    };
  }, [npcCatalog]);

  const isNearNpc = useMemo(() => {
    const npc = npcCatalog?.definitions[0];
    if (!npc || cameraFocus === null || flood.phase !== "preparation") {
      return false;
    }
    return isWithinNpcInteraction(
      cameraFocus,
      npc.position,
      npc.interactionRadiusMeters,
    );
  }, [cameraFocus, flood.phase, npcCatalog]);

  useEffect(() => {
    if (flood.phase !== "preparation") {
      setNpcDialogueOpen(false);
    }
  }, [flood.phase]);

  const socket = useGameSocket(REALTIME_ENABLED && playMode === "multi");
  const mapRef = useRef<CesiumGameMapHandle>(null);
  const dragRef = useRef<DockDragState | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const lastMoveSentAtRef = useRef(0);
  const lastProximityUpdateRef = useRef(0);
  const [drag, setDrag] = useState<DockDragState | null>(null);
  const [mapCameraReady, setMapCameraReady] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => !hasSeenTutorial());
  const [phaseBanner, setPhaseBanner] = useState<string | null>(null);
  const lastPhaseRef = useRef(flood.phase);
  const lastOverflowCountRef = useRef(0);
  const prepUrgentHapticRef = useRef(false);
  const resultRank = computeResultRank(flood.score, flood.isClear === true);

  const sessionActive = inGame && !paused;

  useEffect(() => {
    if (!inGame) {
      setPaused(false);
    }
  }, [inGame]);

  useEffect(() => {
    if (!inGame || paused) {
      construction.setEconomyPhase("idle");
      return;
    }
    construction.setEconomyPhase(flood.phase);
  }, [inGame, paused, flood.phase, construction.setEconomyPhase]);

  useEffect(() => {
    construction.resetSession();
    flood.startFreshGame();
    lastOverflowCountRef.current = 0;
  }, [sessionId, construction.resetSession, flood.startFreshGame]);

  useEffect(() => {
    const previous = lastPhaseRef.current;
    if (previous === flood.phase) {
      return;
    }
    if (flood.phase === "disaster" && previous === "preparation") {
      setPhaseBanner("大雨開始！ 水位が上がります");
      playGameSfx("disaster");
      window.setTimeout(() => setPhaseBanner(null), 2800);
    }
    if (flood.phase === "result") {
      playGameSfx(flood.isClear ? "clear" : "fail");
    }
    lastPhaseRef.current = flood.phase;
  }, [flood.phase, flood.isClear]);

  useEffect(() => {
    const count = flood.overflowSites.length;
    if (flood.phase === "disaster" && count > lastOverflowCountRef.current) {
      playGameSfx("overflow");
      const newest = flood.overflowSites[0];
      if (newest !== undefined) {
        mapRef.current?.focusOnPosition(newest.longitude, newest.latitude);
      }
    }
    lastOverflowCountRef.current = count;
  }, [flood.overflowSites, flood.phase]);

  useEffect(() => {
    if (!inGame) {
      return;
    }
    const shell = document.querySelector(".game-shell");
    if (!(shell instanceof HTMLElement)) {
      return;
    }
    return bindDockStackHeight(shell);
  }, [inGame, construction.pendingPlacement]);

  useEffect(() => {
    if (flood.phase !== "preparation") {
      prepUrgentHapticRef.current = false;
      return;
    }
    if (flood.phaseRemainingSeconds <= 10 && !prepUrgentHapticRef.current) {
      prepUrgentHapticRef.current = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([18, 28, 18]);
      }
    }
  }, [flood.phase, flood.phaseRemainingSeconds]);

  // 開発時のみ E2E から配置・状況取得できるようにする。
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    const api = {
      inGame: () => inGame,
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
    inGame,
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
        moved >= dockDragThresholds.ghost
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
    [construction],
  );

  const handleDropPlace = useCallback(
    (structureId: string, position: GeoPosition, headingDegrees: number) => {
      construction.beginPendingPlacement(structureId, position, headingDegrees);
      if (isCoarsePointerDevice()) {
        triggerLightHaptic();
      }
    },
    [construction],
  );

  const handleConfirmPlacement = useCallback(() => {
    const placement = construction.confirmPendingPlacement();
    if (placement === null) {
      return;
    }
    const structureName =
      construction.structures.find(({ id }) => id === placement.structureId)?.displayName ??
      "施設";
    construction.setMessage(`${structureName} を配置しました`, "success");
    markTutorialDone();
    setShowTutorial(false);
    playGameSfx("place");
    socket.sendPlaceStructure({
      structureId: placement.structureId,
      position: placement.position,
      headingDegrees: placement.headingDegrees,
      clientPlacementId: placement.id,
    });
  }, [construction.confirmPendingPlacement, construction.setMessage, construction.structures, socket]);

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

  useEffect(() => {
    if (!inGame || flood.phase !== "preparation") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      event.preventDefault();
      flood.startRainNow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flood.phase, flood.startRainNow, inGame]);

  const handleCameraFocusChange = useCallback(
    (position: GeoPosition) => {
      const now = Date.now();
      if (now - lastMoveSentAtRef.current >= MOVE_SEND_THROTTLE_MS) {
        lastMoveSentAtRef.current = now;
        socket.sendMove({ position });
      }
      if (now - lastProximityUpdateRef.current >= 200) {
        lastProximityUpdateRef.current = now;
        setCameraFocus(position);
      }
    },
    [socket],
  );

  const handleFocusNpc = useCallback(() => {
    const npc = npcCatalog?.definitions[0];
    if (!npc) {
      return;
    }
    mapRef.current?.focusOnPosition(npc.position.longitude, npc.position.latitude);
  }, [npcCatalog]);

  const handleNpcMarkerClick = useCallback(() => {
    setNpcDialogueOpen(true);
  }, []);

  const handleFocusOverflow = useCallback(() => {
    const site = flood.overflowSites[0];
    if (site === undefined) {
      return;
    }
    triggerPlacementHaptic();
    mapRef.current?.focusOnPosition(site.longitude, site.latitude);
  }, [flood.overflowSites]);

  const handleReviewOverflowSites = useCallback(() => {
    flood.enterReviewMode();
    window.requestAnimationFrame(() => {
      handleFocusOverflow();
    });
  }, [flood.enterReviewMode, handleFocusOverflow]);

  const handleReturnToMenu = useCallback(() => {
    construction.resetSession();
    flood.restart();
    onReturnToMenu();
  }, [construction.resetSession, flood.restart, onReturnToMenu]);

  const handleRetry = useCallback(() => {
    construction.resetSession();
    flood.startFreshGame();
    onRetrySession();
  }, [construction.resetSession, flood.startFreshGame, onRetrySession]);

  const handleSkipPrep = useCallback(() => {
    triggerLightHaptic();
    flood.startRainNow();
  }, [flood.startRainNow]);

  const isDockDragging = drag !== null;
  const isReviewing = flood.phase === "review";
  const hideConstructionUi = !inGame || flood.phase === "result" || isReviewing;
  const hasPendingPlacement = construction.pendingPlacement !== null;
  const pendingStructure = useMemo(() => {
    const structureId = construction.pendingPlacement?.structureId;
    if (structureId === undefined) {
      return null;
    }
    return construction.structures.find(({ id }) => id === structureId) ?? null;
  }, [construction.pendingPlacement?.structureId, construction.structures]);
  const quickPlaceStructureId =
    sessionActive &&
    flood.phase === "preparation" &&
    !hasPendingPlacement &&
    !isDockDragging &&
    isCoarsePointerDevice()
      ? construction.selectedStructureId
      : null;

  useEffect(() => {
    if (!inGame || flood.phase === "result" || isReviewing || hasPendingPlacement) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      setPaused((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flood.phase, hasPendingPlacement, inGame, isReviewing]);

  useEffect(() => {
    if (!inGame || !isReviewing) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        flood.reopenResultPanel();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        handleRetry();
        return;
      }
      if (event.key.toLowerCase() === "o" && flood.overflowSites.length > 0) {
        event.preventDefault();
        handleFocusOverflow();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flood.overflowSites.length, flood.reopenResultPanel, handleFocusOverflow, handleRetry, inGame, isReviewing]);

  useEffect(() => {
    if (paused) {
      mapRef.current?.clearDragGhost();
    }
  }, [paused]);

  const rainOverlayActive = useMemo(
    () =>
      sessionActive &&
      (flood.phase === "disaster" || flood.phase === "result" || flood.phase === "review"),
    [flood.phase, sessionActive],
  );

  const mapFloodSyncKey = useMemo(
    () =>
      [
        flood.phase,
        flood.overflowSites.map((site) => site.id).join(","),
        flood.protectedBankSites.map((site) => site.id).join(","),
        flood.structureInfluences.map((item) => item.placementId).join(","),
        flood.mitigation.overflowPrevention.toFixed(3),
        flood.mitigation.waterLevelReduction.toFixed(3),
        flood.mitigation.channelCapacityIncrease.toFixed(3),
        flood.mitigation.placementInterference.toFixed(3),
      ].join("|"),
    [
      flood.phase,
      flood.overflowSites,
      flood.protectedBankSites,
      flood.structureInfluences,
      flood.mitigation,
    ],
  );

  const mapFloodState = useMemo(
    () => ({
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 水位などの高頻度更新は getLatestFloodState / rAF に任せる。
    [mapFloodSyncKey],
  );

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
        moved >= dockDragThresholds.ghost
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
      if (moved < dockDragThresholds.place) {
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
      className={`game-shell${drag !== null ? " is-dock-dragging" : ""}${hasPendingPlacement ? " is-pending-placement" : ""}${isReviewing ? " is-reviewing" : ""}${paused ? " is-paused" : ""}${inGame && !mapCameraReady ? " is-camera-calibrating" : ""}${flood.phase === "preparation" ? " is-prep-phase" : ""}${flood.phase === "disaster" ? " is-disaster-phase" : ""}${inGame ? "" : " is-dormant"}`}
      aria-hidden={!inGame}
    >
          <div className="game-shell__veil game-shell__veil--top" aria-hidden="true" />
          <div className="game-shell__veil game-shell__veil--bottom" aria-hidden="true" />

          <PhaseBanner message={phaseBanner} />

          {inGame && !hideConstructionUi && !paused && !hasPendingPlacement ? (
            <button
              className="game-pause-btn"
              type="button"
              aria-label="一時停止"
              title="一時停止（Esc）"
              onClick={() => setPaused(true)}
            >
              <span aria-hidden="true">⏸</span>
            </button>
          ) : null}

          {paused ? (
            <PauseMenu
              onResume={() => setPaused(false)}
              onReturnToMenu={handleReturnToMenu}
            />
          ) : null}

          <RainOverlay active={rainOverlayActive} getLatestState={flood.getLatestState} />

          <Suspense fallback={<MapBootFallback />}>
            <CesiumGameMap
              ref={mapRef}
              mapActive={sessionActive}
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
              onCameraReadyChange={setMapCameraReady}
              freeCameraLook={isReviewing}
              floodState={mapFloodState}
              getLatestFloodState={flood.getLatestState}
              quickPlaceStructureId={quickPlaceStructureId}
              npcMarker={npcMarker}
              npcNearby={isNearNpc}
              onNpcMarkerClick={handleNpcMarkerClick}
            />
          </Suspense>

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
                overflowLevelMeters={flood.overflowLevelMeters}
                onStartRainNow={flood.startRainNow}
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
                  onFocusOverflow={
                    flood.overflowSites.length > 0 ? handleFocusOverflow : undefined
                  }
                />
              </div>

              <MobileHudPanel
                phase={flood.phase}
                phaseRemainingSeconds={flood.phaseRemainingSeconds}
                budget={construction.budget}
                netIncomePerSecond={construction.netIncomePerSecond}
                damagePercent={flood.damagePercent}
                overflowSiteCount={flood.overflowSites.length}
                riverLevelMeters={flood.riverLevelMeters}
                rainfallIntensity={flood.rainfallIntensity}
                onFocusOverflow={
                  flood.overflowSites.length > 0 ? handleFocusOverflow : undefined
                }
                onSkipPrep={flood.phase === "preparation" ? handleSkipPrep : undefined}
              />

              <NpcHud
                gameSessionId={String(sessionId)}
                phase={flood.phase}
                overflowCount={flood.overflowSites.length}
                damagePercent={flood.damagePercent}
                phaseSecondsLeft={flood.phaseRemainingSeconds}
                nearNpc={isNearNpc}
                dialogueOpen={npcDialogueOpen}
                onDialogueOpenChange={setNpcDialogueOpen}
                onFocusNpc={handleFocusNpc}
              />
            </div>
          ) : null}

          {inGame && showTutorial && !hideConstructionUi ? (
            <TutorialCoachmark
              phase={flood.phase}
              hasPlacement={construction.placements.length > 0}
              hasPendingPlacement={hasPendingPlacement}
              overflowSiteCount={flood.overflowSites.length}
              nearNpc={isNearNpc}
              onDismiss={() => {
                markTutorialDone();
                setShowTutorial(false);
              }}
            />
          ) : null}

          {inGame && !hideConstructionUi ? (
            <GameToast message={construction.message} tone={construction.messageTone} />
          ) : null}

          {inGame && hasPendingPlacement && construction.pendingPlacement !== null ? (
            <PlacementConfirmBar
              structureName={pendingStructure?.displayName ?? "施設"}
              constructionCost={pendingStructure?.constructionCost ?? 0}
              headingDegrees={construction.pendingPlacement.headingDegrees}
              onRotateBy={(delta) =>
                construction.rotatePlacementBy(construction.pendingPlacement!.id, delta)
              }
              onSetHeading={(heading) =>
                construction.rotatePlacement(construction.pendingPlacement!.id, heading)
              }
              onConfirm={handleConfirmPlacement}
              onCancel={construction.cancelPendingPlacement}
            />
          ) : null}

          {inGame && !hideConstructionUi ? (
            <ConstructionMenu
              budget={construction.budget}
              selectedStructureId={construction.selectedStructureId}
              structures={construction.structures}
              tapPlaceActive={quickPlaceStructureId !== null}
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
              overflowSites={flood.overflowSites}
              onEnterReview={flood.enterReviewMode}
              onReviewOverflowSites={
                flood.overflowSites.length > 0 ? handleReviewOverflowSites : undefined
              }
              onRetry={handleRetry}
              onStartNewGame={handleReturnToMenu}
            />
          ) : null}

          {inGame && isReviewing ? (
            <ReviewModeBar
              isClear={flood.isClear}
              score={flood.score}
              rank={resultRank}
              onShowResult={flood.reopenResultPanel}
              onRetry={handleRetry}
              onStartNewGame={handleReturnToMenu}
              onFocusOverflow={
                flood.overflowSites.length > 0 ? handleFocusOverflow : undefined
              }
            />
          ) : null}
        </main>
  );
}
