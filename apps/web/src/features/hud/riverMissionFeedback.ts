import { loadStructures } from "@civilcraft/game-data/load";
import type {
  FloodSimulationState,
  StructureInfluence,
} from "../disaster/services/floodSimulation";

const structures = new Map(loadStructures().map((structure) => [structure.id, structure]));

export type PlacementFeedbackClassification = "good" | "bad" | "mixed" | "none";

/** Coverage is a placement assessment, never a claim of damage prevented. */
export function getPlacementFeedback(influence: StructureInfluence) {
  const name = structures.get(influence.structureId)?.displayName ?? influence.structureId;
  const coverage = new Set(influence.coveredSiteIds).size;
  const adverse = new Set(influence.adverseSiteIds).size;
  const hasGoodCoverage = influence.coverageTone === "good" && coverage > 0;
  const classification: PlacementFeedbackClassification = hasGoodCoverage
    ? (adverse > 0 ? "mixed" : "good")
    : (coverage > 0 ? "bad" : "none");
  const advice = classification === "mixed"
    ? `効果あり・別地点への影響に注意（相性注意 ${adverse}地点）`
    : classification === "good"
      ? influence.coverageHint
      : adverse > 0
        ? `相性注意 ${adverse}地点・位置や向きを見直そう`
        : coverage === 0
          ? "弱点が範囲外・位置や向きを見直そう"
          : influence.coverageHint;
  return {
    classification,
    tone: classification === "good" ? ("success" as const) : ("warn" as const),
    // Keep the mobile map visible: full assessment belongs in details, not a toast.
    toastMessage: classification === "mixed"
      ? `${name}を設置・${coverage}地点をカバー\n別の${adverse}地点への影響に注意`
      : classification === "good"
        ? `${name}を設置・${coverage}地点をカバー`
        : `${name}を設置\n${adverse > 0 ? `${adverse}地点への影響に注意` : coverage === 0 ? "弱点が範囲外・位置を見直そう" : "位置・向きを見直そう"}`,
    message: `${name}を設置｜配置有効率 ${Math.round(influence.effectiveness * 100)}%・弱点カバー ${coverage}地点。${advice}`,
  };
}

export function getRiverMissionFeedback(
  flood: Pick<
    FloodSimulationState,
    "phase" | "structureInfluences" | "protectedBankSites" | "rainfallIntensity"
  >,
) {
  const confirmed = flood.structureInfluences.filter((influence) => !influence.preview);
  const effective = confirmed.filter(
    (influence) =>
      influence.effectiveness > 0 &&
      influence.coverageTone === "good" &&
      influence.coveredSiteIds.length > 0,
  );
  const roles = new Set(
    effective.flatMap((influence) => {
      const role = structures.get(influence.structureId)?.role.primaryHazard;
      return role ? [role] : [];
    }),
  );
  const coveredSites = new Set(confirmed.flatMap((influence) => influence.coveredSiteIds)).size;
  const adverseSites = new Set(confirmed.flatMap((influence) => influence.adverseSiteIds)).size;
  // This array also contains overflowing, unprotected sites. Do not count those as protected.
  const protectedSites = flood.protectedBankSites.filter(
    (site) => site.protectionStrength > 0 && !site.overflowing,
  ).length;
  const overflowingSites = flood.protectedBankSites.filter((site) => site.overflowing).length;
  const averageEffectiveness =
    confirmed.length === 0
      ? null
      : confirmed.reduce((sum, influence) => sum + influence.effectiveness, 0) / confirmed.length;
  const prep = flood.phase === "preparation" || flood.phase === "idle";
  const stage = !prep ? 3 : effective.length === 0 ? 1 : roles.size < 2 ? 2 : 3;
  const label =
    stage === 1
      ? "01 / 弱点をねらう"
      : stage === 2
        ? "02 / 役割を組み合わせる"
        : "03 / 雨に備えて守る";
  const objective = !prep
    ? `雨の強さ ${Math.round(flood.rainfallIntensity * 100)}%・防護中 ${protectedSites}地点${overflowingSites > 0 ? `・氾濫 ${overflowingSites}` : ""}`
    : stage === 1
      ? "相性のよい弱点へ、まず1基"
      : stage === 2
        ? adverseSites > 0
          ? `${coveredSites}地点をカバー。相性注意の弱点にも備えよう`
          : "次は別の役割で弱点をカバー"
        : adverseSites > 0
          ? `${roles.size}種の役割・相性注意 ${adverseSites}地点を見直そう`
          : `${roles.size}種の役割・${coveredSites}地点をカバー。大雨で確認`;
  return {
    stage,
    label,
    objective,
    averageEffectiveness,
    coveredSites,
    protectedSites,
    overflowingSites,
  };
}
