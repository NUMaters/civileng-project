import { useCallback, useEffect, useRef, useState } from "react";
import type { PlacedStructure } from "../../construction";
import {
  advanceFloodSimulation,
  beginDisaster,
  beginPreparation,
  createInitialFloodState,
  refreshPlacementEffects,
  type FloodSimulationState,
} from "../services/floodSimulation";

export type UseFloodSimulationResult = FloodSimulationState & {
  startGame: () => void;
  startRainNow: () => void;
  restart: () => void;
};

export function useFloodSimulation(placements: PlacedStructure[]): UseFloodSimulationResult {
  const [state, setState] = useState(createInitialFloodState);
  const placementsRef = useRef(placements);
  placementsRef.current = placements;

  // 配置が変わるたびに影響圏・治水効果を即時反映（準備中も見える）。
  useEffect(() => {
    setState((current) => refreshPlacementEffects(current, placements));
  }, [placements]);

  useEffect(() => {
    if (state.phase !== "preparation" && state.phase !== "disaster") {
      return;
    }
    // 0.25 秒刻みで水位・浸水を進め、見た目の補間と合わせて滑らかに増水させる。
    const tickSeconds = 0.25;
    const intervalId = window.setInterval(() => {
      setState((current) =>
        advanceFloodSimulation(current, placementsRef.current, tickSeconds),
      );
    }, tickSeconds * 1_000);
    return () => window.clearInterval(intervalId);
  }, [state.phase]);

  const startGame = useCallback(() => {
    setState((current) => refreshPlacementEffects(beginPreparation(), placementsRef.current));
  }, []);

  const startRainNow = useCallback(() => {
    setState((current) =>
      refreshPlacementEffects(beginDisaster(current), placementsRef.current),
    );
  }, []);

  const restart = useCallback(() => {
    setState(createInitialFloodState());
  }, []);

  return {
    ...state,
    startGame,
    startRainNow,
    restart,
  };
}
