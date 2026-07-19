import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStructures } from "@civilcraft/game-data/load";
import {
  INITIAL_BUDGET,
  normalizeHeadingDegrees,
  placeStructure,
} from "../services/constructionService";
import type { GeoPosition, PlacedStructure, StructureDefinition } from "../types/construction";

const structures: StructureDefinition[] = loadStructures().map(
  ({ id, displayName, description, constructionCost, constructionTimeSeconds }) => ({
    id,
    displayName,
    description,
    constructionCost,
    constructionTimeSeconds,
  }),
);

/** トーストメッセージの表示時間（ms）。 */
const MESSAGE_AUTO_HIDE_MS = 3_500;

/** 古い iOS Safari など crypto.randomUUID 非対応端末向け。 */
function createPlacementId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function useConstruction() {
  const [budget, setBudget] = useState(INITIAL_BUDGET);
  const [selectedStructureId, setSelectedStructureId] = useState(structures[0]?.id ?? "");
  const [placements, setPlacements] = useState<PlacedStructure[]>([]);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [message, setMessageState] = useState("");
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 連続ドロップで同じ予算を二重に読まないための同期ソース。 */
  const budgetRef = useRef(budget);
  budgetRef.current = budget;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const setMessage = useCallback(
    (next: string) => {
      clearHideTimer();
      setMessageState(next);
      if (next === "") {
        return;
      }
      hideTimerRef.current = setTimeout(() => {
        setMessageState("");
        hideTimerRef.current = null;
      }, MESSAGE_AUTO_HIDE_MS);
    },
    [clearHideTimer],
  );

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const selectedStructure = useMemo(
    () => structures.find(({ id }) => id === selectedStructureId),
    [selectedStructureId],
  );

  const selectStructure = useCallback(
    (structureId: string) => {
      setSelectedStructureId(structureId);
      setSelectedPlacementId(null);
      setMessage("");
    },
    [setMessage],
  );

  const placeStructureAt = useCallback(
    (
      structureId: string,
      position: GeoPosition,
      headingDegrees: number,
    ): PlacedStructure | null => {
      const structure = structures.find(({ id }) => id === structureId);
      if (structure === undefined) {
        setMessage("配置する施設を選択してください");
        return null;
      }

      try {
        const placementId = `${structure.id}-${createPlacementId()}`;
        const result = placeStructure(
          structure,
          position,
          budgetRef.current,
          placementId,
          headingDegrees,
        );

        if (!result.ok) {
          setMessage(result.reason);
          return null;
        }

        budgetRef.current = result.remainingBudget;
        setBudget(result.remainingBudget);
        setPlacements((current) => [...current, result.placement]);
        setSelectedStructureId(structure.id);
        setSelectedPlacementId(result.placement.id);
        setMessage(
          `${structure.displayName}を配置 — 施設をドラッグして向きを調整できます`,
        );
        return result.placement;
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : "配置に失敗しました";
        setMessage(reason);
        return null;
      }
    },
    [setMessage],
  );

  const rotatePlacement = useCallback((placementId: string, headingDegrees: number) => {
    const nextHeading = normalizeHeadingDegrees(headingDegrees);
    setPlacements((current) =>
      current.map((placement) =>
        placement.id === placementId
          ? { ...placement, headingDegrees: nextHeading }
          : placement,
      ),
    );
  }, []);

  return {
    budget,
    message,
    placements,
    selectedPlacementId,
    selectedStructureId,
    structures,
    selectedStructure,
    placeStructureAt,
    rotatePlacement,
    selectStructure,
    setSelectedPlacementId,
    setMessage,
  };
}
