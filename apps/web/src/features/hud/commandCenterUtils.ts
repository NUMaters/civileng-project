import type { MitigationSummary } from "../disaster/services/floodSimulation";

const CLEAR_THRESHOLD = 8;

export function computeSafetyScore(
  damagePercent: number,
  mitigation: MitigationSummary | undefined,
): number {
  const damage = Number.isFinite(damagePercent) ? damagePercent : 0;
  const m = mitigation ?? {
    waterLevelReduction: 0,
    overflowPrevention: 0,
    drainageCapacity: 0,
    bankProtection: 0,
    channelCapacityIncrease: 0,
    activeStructureCount: 0,
    averageEffectiveness: 0,
    placementInterference: 0,
  };
  const defense =
    m.overflowPrevention * 28 +
    m.waterLevelReduction * 22 +
    m.bankProtection * 18 +
    m.drainageCapacity * 14 +
    m.channelCapacityIncrease * 10 +
    m.averageEffectiveness * 12;
  const penalty = damage * 2.4 + m.placementInterference * 18;
  return Math.round(Math.max(0, Math.min(100, 72 + defense - penalty)));
}

export function computeImpactStats(
  damagePercent: number,
  overflowSiteCount: number,
  floodedAreaPercent: number,
): { households: number; people: number } {
  const damage = Number.isFinite(damagePercent) ? damagePercent : 0;
  const flooded = Number.isFinite(floodedAreaPercent) ? floodedAreaPercent : 0;
  const households = Math.round(
    overflowSiteCount * 420 + flooded * 28 + damage * 42,
  );
  const people = Math.round(households * 2.65);
  return { households, people };
}

export function alertLevel(
  phase: string,
  damagePercent: number,
  rainfallIntensity: number,
  overflowSiteCount: number,
): { level: number; label: string; tone: "safe" | "watch" | "warn" | "danger" } {
  if (phase === "preparation" || phase === "idle") {
    return { level: 1, label: "警戒", tone: "watch" };
  }
  const damage = Number.isFinite(damagePercent) ? damagePercent : 0;
  const rain = Number.isFinite(rainfallIntensity) ? rainfallIntensity : 0;
  if (damage >= CLEAR_THRESHOLD || overflowSiteCount >= 3) {
    return { level: 4, label: "危険", tone: "danger" };
  }
  if (damage >= CLEAR_THRESHOLD * 0.55 || overflowSiteCount >= 2 || rain >= 0.75) {
    return { level: 3, label: "注意", tone: "warn" };
  }
  if (overflowSiteCount >= 1 || rain >= 0.45) {
    return { level: 2, label: "監視", tone: "watch" };
  }
  return { level: 1, label: "安定", tone: "safe" };
}

export function precipitationMmPerHour(intensity: number): number {
  const safe = Number.isFinite(intensity) ? intensity : 0;
  return Math.round(18 + safe * 82);
}

export function missionTitle(phase: string): string {
  switch (phase) {
    case "preparation":
      return "Phase 01: 施設を配置せよ";
    case "disaster":
      return "Phase 02: 街を洪水から守れ";
    case "result":
      return "Phase 03: 結果を確認";
    case "review":
      return "Phase 03: マップを確認";
    default:
      return "待機中";
  }
}

export function effectRangeLabel(structureId: string): string {
  switch (structureId) {
    case "levee":
    case "revetment":
    case "channel-dredging":
      return "中";
    case "retention-basin":
      return "広";
    case "drainage-pump":
      return "狭〜中";
    default:
      return "中";
  }
}
