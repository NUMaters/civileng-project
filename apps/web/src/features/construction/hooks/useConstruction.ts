import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStructures } from "@civilcraft/game-data/load";
import {
  applyDisasterStartGrant,
  formatBudgetRate,
  INITIAL_BUDGET,
  MAX_BUDGET,
  normalizeHeadingDegrees,
  placeStructure,
  tickBudgetEconomy,
  type BudgetEconomyPhase,
} from "../services/constructionService";
import type { GeoPosition, PlacedStructure, StructureDefinition } from "../types/construction";

const structures: StructureDefinition[] = loadStructures().map(
  ({
    id,
    displayName,
    description,
    constructionCost,
    constructionTimeSeconds,
    maintenanceCostPerSecond,
    role,
    hazardAffinity,
  }) => ({
    id,
    displayName,
    description,
    constructionCost,
    constructionTimeSeconds,
    maintenanceCostPerSecond,
    role,
    hazardAffinity,
  }),
);

/** 成功・情報トーストの表示時間（ms）。短めにしてうるさくしない。 */
const MESSAGE_INFO_HIDE_MS = 2_200;
/** 警告トーストの表示時間（ms）。 */
const MESSAGE_WARN_HIDE_MS = 2_800;
/** 同じ文言の連投を抑える間隔（ms）。 */
const MESSAGE_THROTTLE_MS = 1_400;

export type ToastTone = "info" | "warn" | "success";

/** 古い iOS Safari など crypto.randomUUID 非対応端末向け。 */
function createPlacementId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

function inferTone(message: string): ToastTone {
  if (
    message.includes("足り") ||
    message.includes("必要") ||
    message.includes("範囲外") ||
    message.includes("できません") ||
    message.includes("移して") ||
    message.includes("のみ")
  ) {
    return "warn";
  }
  if (message.includes("配置")) {
    return "success";
  }
  return "info";
}

export function useConstruction() {
  const [budget, setBudget] = useState(INITIAL_BUDGET);
  const [spentBudget, setSpentBudget] = useState(0);
  const [economyPhase, setEconomyPhaseState] = useState<BudgetEconomyPhase>("idle");
  const [netIncomePerSecond, setNetIncomePerSecond] = useState(0);
  const [selectedStructureId, setSelectedStructureId] = useState(structures[0]?.id ?? "");
  const [placements, setPlacements] = useState<PlacedStructure[]>([]);
  const [pendingPlacement, setPendingPlacement] = useState<PlacedStructure | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [message, setMessageState] = useState("");
  const [messageTone, setMessageTone] = useState<ToastTone>("info");
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastToastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  /** 連続ドロップで同じ予算を二重に読まないための同期ソース（rAF 経済ティックの単一ソース）。 */
  const budgetRef = useRef(budget);
  const placementsRef = useRef(placements);
  placementsRef.current = placements;
  const economyPhaseRef = useRef(economyPhase);
  economyPhaseRef.current = economyPhase;
  const disasterGrantAppliedRef = useRef(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const setMessage = useCallback(
    (next: string, tone?: ToastTone) => {
      if (next === "") {
        clearHideTimer();
        setMessageState("");
        return;
      }
      const now = performance.now();
      if (
        next === lastToastRef.current.text &&
        now - lastToastRef.current.at < MESSAGE_THROTTLE_MS
      ) {
        return;
      }
      lastToastRef.current = { text: next, at: now };
      clearHideTimer();
      const resolvedTone = tone ?? inferTone(next);
      setMessageTone(resolvedTone);
      setMessageState(next);
      const hideMs = resolvedTone === "warn" ? MESSAGE_WARN_HIDE_MS : MESSAGE_INFO_HIDE_MS;
      hideTimerRef.current = setTimeout(() => {
        setMessageState("");
        hideTimerRef.current = null;
      }, hideMs);
    },
    [clearHideTimer],
  );

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  /** 洪水フェーズに合わせて予算経済を同期する。 */
  const setEconomyPhase = useCallback(
    (phase: BudgetEconomyPhase) => {
      const previous = economyPhaseRef.current;
      economyPhaseRef.current = phase;
      setEconomyPhaseState(phase);

      if (
        phase === "preparation" &&
        (previous === "idle" || previous === "result" || previous === "review")
      ) {
        disasterGrantAppliedRef.current = false;
      }

      if (phase === "disaster" && previous !== "disaster" && !disasterGrantAppliedRef.current) {
        disasterGrantAppliedRef.current = true;
        const granted = applyDisasterStartGrant(budgetRef.current);
        budgetRef.current = granted;
        setBudget(granted);
        // 緊急予算は HUD の数値変化で十分。トーストは出さない。
      }

      if (phase !== "preparation" && phase !== "disaster") {
        setNetIncomePerSecond(0);
      }
    },
    [],
  );

  // 準備／災害中は補給 − 維持費で予算を更新する（壁時計ベース。フレーム落ちでも遅れない）。
  useEffect(() => {
    if (economyPhase !== "preparation" && economyPhase !== "disaster") {
      return;
    }
    let frameId = 0;
    let lastAt = performance.now();
    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.5, Math.max(0, (now - lastAt) / 1000));
      lastAt = now;
      if (deltaSeconds > 0) {
        const result = tickBudgetEconomy({
          currentBudget: budgetRef.current,
          deltaSeconds,
          phase: economyPhaseRef.current,
          placedStructureIds: placementsRef.current.map((placement) => placement.structureId),
        });
        if (Math.abs(result.budget - budgetRef.current) >= 0.05) {
          budgetRef.current = result.budget;
          setBudget(result.budget);
        }
        setNetIncomePerSecond(result.netIncomePerSecond);
      }
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [economyPhase]);

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
        setMessage("先にドックで施設を選べ");
        return null;
      }
      if (budgetRef.current < structure.constructionCost) {
        setMessage(
          `${structure.displayName}まであと${(structure.constructionCost - budgetRef.current).toLocaleString("ja-JP")} pt不足`,
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
      // キャンセルは操作の結果が画面から消えるのでトースト不要。
      setSelectedPlacementId(null);
      return null;
    });
  }, []);

  /** 仮配置を確定し予算を消費する。 */
  const confirmPendingPlacement = useCallback((): PlacedStructure | null => {
    const pending = pendingPlacement;
    if (pending === null) {
      return null;
    }
    const structure = structures.find(({ id }) => id === pending.structureId);
    if (structure === undefined) {
      setPendingPlacement(null);
      setMessage("先にドックで施設を選べ");
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
    setSpentBudget((current) => current + structure.constructionCost);
    setPlacements((current) => [...current, confirmed]);
    setPendingPlacement(null);
    setSelectedStructureId(structure.id);
    // 確定後は向き変更 UI を出さない（選択ハイライトも外す）。
    setSelectedPlacementId(null);
    setMessage(`${structure.displayName}を配備完了`, "success");
    return confirmed;
  }, [pendingPlacement, setMessage]);

  /** 向き変更は仮配置中のみ。確定済み施設は変更しない。 */
  const rotatePlacement = useCallback((placementId: string, headingDegrees: number) => {
    const nextHeading = normalizeHeadingDegrees(headingDegrees);
    setPendingPlacement((current) => {
      if (current === null || current.id !== placementId) {
        return current;
      }
      return { ...current, headingDegrees: nextHeading };
    });
  }, []);

  /** 仮配置の位置を配置可能域内で更新する（確定前の微調整用）。 */
  const movePendingPlacement = useCallback((placementId: string, position: GeoPosition) => {
    setPendingPlacement((current) => {
      if (current === null || current.id !== placementId) {
        return current;
      }
      return {
        ...current,
        position: {
          longitude: position.longitude,
          latitude: position.latitude,
          height: position.height,
        },
      };
    });
  }, []);

  const rotatePlacementBy = useCallback(
    (placementId: string, deltaDegrees: number) => {
      if (pendingPlacement === null || pendingPlacement.id !== placementId) {
        return;
      }
      rotatePlacement(placementId, pendingPlacement.headingDegrees + deltaDegrees);
    },
    [pendingPlacement, rotatePlacement],
  );

  const visiblePlacements = useMemo(() => {
    if (pendingPlacement === null) {
      return placements;
    }
    return [...placements, pendingPlacement];
  }, [pendingPlacement, placements]);

  /** 新規ゲーム開始用。配置・予算・選択状態を初期化する。 */
  const resetSession = useCallback(() => {
    clearHideTimer();
    budgetRef.current = INITIAL_BUDGET;
    setBudget(INITIAL_BUDGET);
    setSpentBudget(0);
    setNetIncomePerSecond(0);
    disasterGrantAppliedRef.current = false;
    economyPhaseRef.current = "idle";
    setEconomyPhaseState("idle");
    setPlacements([]);
    setPendingPlacement(null);
    setSelectedPlacementId(null);
    setSelectedStructureId(structures[0]?.id ?? "");
    setMessageState("");
  }, [clearHideTimer]);

  const budgetRatio = Math.max(0, Math.min(1, budget / MAX_BUDGET));
  const incomeLabel =
    economyPhase === "preparation" || economyPhase === "disaster"
      ? formatBudgetRate(netIncomePerSecond)
      : "";

  return {
    budget,
    budgetRatio,
    spentBudget,
    netIncomePerSecond,
    incomeLabel,
    economyPhase,
    setEconomyPhase,
    message,
    messageTone,
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
    movePendingPlacement,
    selectStructure,
    setSelectedPlacementId,
    setMessage,
    resetSession,
  };
}
