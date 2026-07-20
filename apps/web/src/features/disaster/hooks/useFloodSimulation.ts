import { useCallback, useEffect, useRef, useState } from "react";
import type { PlacedStructure } from "../../construction";
import {
  advanceFloodSimulation,
  beginDisaster,
  beginPreparation,
  createInitialFloodState,
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

  useEffect(() => {
    if (state.phase !== "preparation" && state.phase !== "disaster") {
      return;
    }
    const intervalId = window.setInterval(() => {
      setState((current) => advanceFloodSimulation(current, placementsRef.current));
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, [state.phase]);

  const startGame = useCallback(() => {
    setState(beginPreparation());
  }, []);

  const startRainNow = useCallback(() => {
    setState((current) => beginDisaster(current));
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
