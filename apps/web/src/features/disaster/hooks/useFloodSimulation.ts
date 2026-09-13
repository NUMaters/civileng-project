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
/** 1 フレームあたりの物理積分ステップ上限（安定用）。合計は実時間に追いつくまで複数回進める。 */
const MAX_SIM_STEP_SECONDS = 0.05;
/** タブ復帰などで一気に飛ばしすぎない上限（秒）。 */
const MAX_CATCH_UP_SECONDS = 0.5;

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
  /**
   * E2E / 開発用: 指定秒数だけシミュレーションを進める。
   * headless では rAF が止まることがあるため壁時計の代わりに使う。
   */
  advanceForTest: (seconds: number) => FloodSimulationState;
};

export function useFloodSimulation(placements: PlacedStructure[]): UseFloodSimulationResult {
  const [state, setState] = useState(createInitialFloodState);
  const placementsRef = useRef(placements);
  const stateRef = useRef(state);
  placementsRef.current = placements;
  // stateRef は rAF が進める最新状態の単一ソース。
  // 毎レンダーで state を書き戻すと、HUD 間引きのあいだに進んだ時間が巻き戻る。

  // 配置が変わるたびに影響圏・治水効果を即時反映（準備中も見える）。
  // タイマー進行は stateRef（rAF 最新）を基準にし、間引き後の古い React state で巻き戻さない。
  useEffect(() => {
    const next = refreshPlacementEffects(stateRef.current, placements);
    stateRef.current = next;
    setState(next);
  }, [placements]);

  useEffect(() => {
    if (state.phase !== "preparation" && state.phase !== "disaster") {
      return;
    }
    // 水位は毎フレーム連続で進め、React への通知だけ間引いて階段状の見た目を防ぐ。
    // カウントダウンは壁時計に合わせる（Cesium 負荷でフレームが伸びても遅れない）。
    let frameId = 0;
    let lastAt = performance.now();
    let emitAccumulator = 0;
    const phaseWhenStarted = state.phase;

    const tick = (now: number) => {
      const wallDelta = Math.max(0, (now - lastAt) / 1000);
      lastAt = now;
      let catchUp = Math.min(MAX_CATCH_UP_SECONDS, wallDelta);
      let next = stateRef.current;
      let advanced = 0;

      while (catchUp > 1e-6) {
        if (next.phase !== phaseWhenStarted) {
          break;
        }
        const step = Math.min(MAX_SIM_STEP_SECONDS, catchUp);
        next = advanceFloodSimulation(next, placementsRef.current, step);
        catchUp -= step;
        advanced += step;
        if (next.phase !== phaseWhenStarted) {
          break;
        }
      }

      if (advanced > 0 || next.phase !== phaseWhenStarted) {
        stateRef.current = next;
        emitAccumulator += advanced;
        const phaseChanged = next.phase !== phaseWhenStarted;
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
      // rAF が進めた最新状態から災害へ移す（間引き表示の遅れを持ち込まない）。
      const base = stateRef.current.phase === current.phase ? stateRef.current : current;
      const next = refreshPlacementEffects(beginDisaster(base), placementsRef.current);
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

  const advanceForTest = useCallback((seconds: number) => {
    let remaining = Math.max(0, seconds);
    let next = stateRef.current;
    while (remaining > 1e-6) {
      const step = Math.min(MAX_SIM_STEP_SECONDS, remaining);
      next = advanceFloodSimulation(next, placementsRef.current, step);
      remaining -= step;
    }
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  return {
    ...state,
    startGame,
    startFreshGame,
    startRainNow,
    restart,
    enterReviewMode,
    reopenResultPanel,
    getLatestState,
    advanceForTest,
  };
}
