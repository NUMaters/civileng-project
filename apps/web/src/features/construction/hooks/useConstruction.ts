import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStructures } from "@civilcraft/game-data/load";
import {
  INITIAL_BUDGET,
  normalizeHeadingDegrees,
  placeStructure,
} from "../services/constructionService";
import { getStructureEffectLabel } from "../structureVisuals";
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
  const [pendingPlacement, setPendingPlacement] = useState<PlacedStructure | null>(null);
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
      setPendingPlacement(null);
      setMessage("");
    },
    [setMessage],
  );

  /** ドロップ後の仮配置。予算はまだ消費しない。 */
  const beginPendingPlacement = useCallback(
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
      if (budgetRef.current < structure.constructionCost) {
        setMessage(
          `${structure.displayName}の建設にはあと${(structure.constructionCost - budgetRef.current).toLocaleString("ja-JP")} pt必要です`,
        );
        return null;
      }

      const pending: PlacedStructure = {
        id: `preview-${structure.id}-${createPlacementId()}`,
        structureId: structure.id,
        position,
        headingDegrees: normalizeHeadingDegrees(headingDegrees),
        preview: true,
      };
      setPendingPlacement(pending);
      setSelectedStructureId(structure.id);
      setSelectedPlacementId(pending.id);
      setMessage("");
      return pending;
    },
    [setMessage],
  );

  const cancelPendingPlacement = useCallback(() => {
    setPendingPlacement((current) => {
      if (current === null) {
        return null;
      }
      setMessage("仮配置をキャンセルしました");
      setSelectedPlacementId(null);
      return null;
    });
  }, [setMessage]);

  /** 仮配置を確定し予算を消費する。 */
  const confirmPendingPlacement = useCallback((): PlacedStructure | null => {
    const pending = pendingPlacement;
    if (pending === null) {
      return null;
    }
    const structure = structures.find(({ id }) => id === pending.structureId);
    if (structure === undefined) {
      setPendingPlacement(null);
      setMessage("配置する施設を選択してください");
      return null;
    }

    const confirmedId = `${structure.id}-${createPlacementId()}`;
    const result = placeStructure(
      structure,
      pending.position,
      budgetRef.current,
      confirmedId,
      pending.headingDegrees,
    );
    if (!result.ok) {
      setMessage(result.reason);
      return null;
    }

    const confirmed: PlacedStructure = {
      ...result.placement,
      preview: false,
    };
    budgetRef.current = result.remainingBudget;
    setBudget(result.remainingBudget);
    setPlacements((current) => [...current, confirmed]);
    setPendingPlacement(null);
    setSelectedStructureId(structure.id);
    setSelectedPlacementId(confirmed.id);
    setMessage(
      `${structure.displayName}を配置 — ${getStructureEffectLabel(structure.id)}（緑の円が影響範囲）`,
    );
    return confirmed;
  }, [pendingPlacement, setMessage]);

  const rotatePlacement = useCallback((placementId: string, headingDegrees: number) => {
    const nextHeading = normalizeHeadingDegrees(headingDegrees);
    setPendingPlacement((current) => {
      if (current !== null && current.id === placementId) {
        return { ...current, headingDegrees: nextHeading };
      }
      return current;
    });
    setPlacements((current) =>
      current.map((placement) =>
        placement.id === placementId
          ? { ...placement, headingDegrees: nextHeading }
          : placement,
      ),
    );
  }, []);

  const rotatePlacementBy = useCallback(
    (placementId: string, deltaDegrees: number) => {
      const target =
        pendingPlacement?.id === placementId
          ? pendingPlacement
          : placements.find(({ id }) => id === placementId);
      if (target === undefined) {
        return;
      }
      rotatePlacement(placementId, target.headingDegrees + deltaDegrees);
    },
    [pendingPlacement, placements, rotatePlacement],
  );

  const visiblePlacements = useMemo(() => {
    if (pendingPlacement === null) {
      return placements;
    }
    return [...placements, pendingPlacement];
  }, [pendingPlacement, placements]);

  return {
    budget,
    message,
    placements,
    pendingPlacement,
    visiblePlacements,
    selectedPlacementId,
    selectedStructureId,
    structures,
    selectedStructure,
    beginPendingPlacement,
    confirmPendingPlacement,
    cancelPendingPlacement,
    rotatePlacement,
    rotatePlacementBy,
    selectStructure,
    setSelectedPlacementId,
    setMessage,
  };
}
