import { useCallback, useEffect, useRef, useState } from "react";
import type { PlacedStructure } from "../../construction";
import {
  advanceFloodSimulation,
  beginDisaster,
  beginPreparation,
  createInitialFloodState,
  enterReview,
  refreshPlacementEffects,
  reopenResult,
  type FloodSimulationState,
} from "../services/floodSimulation";

/** HUD / React への反映間隔。描画側はこれより高頻度で補間する。 */
const UI_EMIT_SECONDS = 1 / 20;

export type UseFloodSimulationResult = FloodSimulationState & {
  startGame: () => void;
  startRainNow: () => void;
  restart: () => void;
  enterReviewMode: () => void;
  reopenResultPanel: () => void;
  /** 配置リセット後の新規開始。影響計算に古い配置を使わない。 */
  startFreshGame: () => void;
  /** Cesium 描画用。React の間引きに依存せず最新水位を読む。 */
  getLatestState: () => FloodSimulationState;
};

export function useFloodSimulation(placements: PlacedStructure[]): UseFloodSimulationResult {
  const [state, setState] = useState(createInitialFloodState);
  const placementsRef = useRef(placements);
  const stateRef = useRef(state);
  placementsRef.current = placements;
  stateRef.current = state;

  // 配置が変わるたびに影響圏・治水効果を即時反映（準備中も見える）。
  useEffect(() => {
    setState((current) => {
      const next = refreshPlacementEffects(current, placements);
      stateRef.current = next;
      return next;
    });
  }, [placements]);

  useEffect(() => {
    if (state.phase !== "preparation" && state.phase !== "disaster") {
      return;
    }
    // 水位は毎フレーム連続で進め、React への通知だけ間引いて階段状の見た目を防ぐ。
    let frameId = 0;
    let lastAt = performance.now();
    let emitAccumulator = 0;

    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastAt) / 1000));
      lastAt = now;
      if (deltaSeconds > 0) {
        const previousPhase = stateRef.current.phase;
        const next = advanceFloodSimulation(
          stateRef.current,
          placementsRef.current,
          deltaSeconds,
        );
        stateRef.current = next;
        emitAccumulator += deltaSeconds;
        const phaseChanged = next.phase !== previousPhase;
        if (emitAccumulator >= UI_EMIT_SECONDS || phaseChanged || next.phase === "result") {
          emitAccumulator = 0;
          setState(next);
        }
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [state.phase]);

  const startGame = useCallback(() => {
    setState(() => {
      const next = refreshPlacementEffects(beginPreparation(), placementsRef.current);
      stateRef.current = next;
      return next;
    });
  }, []);

  /** 新規ゲーム。配置は呼び出し側で先にリセットし、空の状態から準備を始める。 */
  const startFreshGame = useCallback(() => {
    const next = beginPreparation();
    stateRef.current = next;
    setState(next);
  }, []);

  const startRainNow = useCallback(() => {
    setState((current) => {
      const next = refreshPlacementEffects(beginDisaster(current), placementsRef.current);
      stateRef.current = next;
      return next;
    });
  }, []);

  const restart = useCallback(() => {
    const next = createInitialFloodState();
    stateRef.current = next;
    setState(next);
  }, []);

  const enterReviewMode = useCallback(() => {
    setState((current) => {
      const next = enterReview(current);
      stateRef.current = next;
      return next;
    });
  }, []);

  const reopenResultPanel = useCallback(() => {
    setState((current) => {
      const next = reopenResult(current);
      stateRef.current = next;
      return next;
    });
  }, []);

  const getLatestState = useCallback(() => stateRef.current, []);

  return {
    ...state,
    startGame,
    startFreshGame,
    startRainNow,
    restart,
    enterReviewMode,
    reopenResultPanel,
    getLatestState,
  };
}
