import type { FloodSimulationState, StructureInfluence } from "../../features/disaster/services/floodSimulation";
import { getRiverPlacementContext } from "../../features/disaster/services/hydraulicPlacement";

const clamp = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
const labels: Record<string, string> = {
  levee: "越水を抑制中", "retention-basin": "洪水を一時貯留中",
  "drainage-pump": "排水運転中", revetment: "岸の侵食を抑制中",
  "channel-dredging": "流下断面を確保",
};

type ActivityState = Pick<FloodSimulationState, "riverLevelMeters" | "floodDepthMeters" | "protectedBankSites"> & {
  phase: string;
  /** Added to the live state in the simulation; optional for pre-integration map callers. */
  inflowPerSecond?: number;
  drainageCapacityPerSecond?: number;
  retentionStorageByPlacement?: Readonly<Record<string, number>>;
};

/** Operational illustration, not a per-facility measured flow or saved-damage attribution. */
export function resolveFacilityActivity(influence: StructureInfluence | undefined, state: ActivityState | undefined) {
  // A mismatch is a separate warning, not a facility-wide simulation shutdown.
  const warning = influence?.adverseSiteIds.length ? `相性注意${influence.adverseSiteIds.length}地点` : undefined;
  const result = (operationActivity: number, label: string, waterActivity = operationActivity) => ({
    // The map already renders the mismatch count on its own line. Keep the
    // operational label concise rather than duplicating that warning here.
    // Keep activity as the legacy water-animation value. Mechanical operation is separate
    // so a preventive pump does not render water jets on a dry surface.
    activity: waterActivity, operationActivity, waterActivity, warning, label,
  });
  if (!influence || influence.preview || !state) return result(0, "配置を検討中");
  if (state.phase === "idle" || state.phase === "preparation") return result(0, "大雨に備えて待機");
  if (influence.structureId === "channel-dredging") {
    // Earthwork can run without protecting a bank candidate. In particular the
    // current candidate set has no capacityShortage sites. Effectiveness alone
    // cannot authorize work: its evaluator retains a floor even on dry banks.
    const effectiveness = clamp(influence.effectiveness);
    if (state.phase !== "disaster") return result(0, "掘削作業は待機中");
    if (!effectiveness || !Number.isFinite(influence.longitude) || !Number.isFinite(influence.latitude) ||
      !Number.isFinite(influence.headingDegrees) ||
      !getRiverPlacementContext(influence.longitude, influence.latitude, influence.headingDegrees).inChannel) {
      return result(0, "河道内の有効な配置で作業");
    }
    // Mechanical motion is not evidence of water-level reduction or bank
    // protection. Only this placement's actual positive attribution feeds water.
    const protection = influence.positiveSiteContributions?.reduce((max, site) => Math.max(max, clamp(site.strength)), 0) ?? 0;
    const water = effectiveness * protection * clamp((state.riverLevelMeters - 2.2) / 2.5);
    return result(effectiveness, "河道掘削作業中", water >= 0.01 ? water : 0);
  }
  const stored = influence.structureId === "retention-basin"
    ? clamp(state.retentionStorageByPlacement?.[influence.placementId] ?? 0) : 0;
  if (stored >= 1) return result(0, "貯留上限・水を保持中");
  if (!influence.positiveSiteContributions) return result(0, "施設の寄与を確認できません");

  const contributions = influence.positiveSiteContributions.filter(site => clamp(site.strength) > 0);
  const protection = contributions.reduce((max, site) => Math.max(max, clamp(site.strength)), 0);
  if (!protection || clamp(influence.effectiveness) === 0) return result(0, "対象地点への有効な寄与なし");
  const rise = clamp((state.riverLevelMeters - 2.2) / 2.5);
  const residualDemand = clamp(state.floodDepthMeters / 0.7);
  const inflowValue = state.inflowPerSecond;
  const hasInflow = typeof inflowValue === "number" && Number.isFinite(inflowValue);
  // 0.035 is the existing inflow/capacity conversion to depth-equivalent demand.
  // Capacity is intentionally not used as demand: a large idle capacity must not start a pump.
  const inflowDemand = hasInflow ? clamp(Math.max(0, inflowValue) / 0.035) : residualDemand;
  const demand = influence.structureId === "drainage-pump"
    ? Math.max(inflowDemand, residualDemand)
    : rise;
  const activity = clamp(influence.effectiveness) * protection * demand;
  const waterActivity = influence.structureId === "drainage-pump"
    ? clamp(influence.effectiveness) * protection * clamp(state.floodDepthMeters / 0.7)
    : activity;
  if (activity < 0.01) return result(0, stored > 0 ? "貯めた水を保持中" : "水の増加に備えて待機", 0);
  // Aggregate site state is used only for the continuing-flood warning, never attribution.
  const overwhelmed = state.protectedBankSites.some(site => site.overflowing &&
    contributions.some(contribution => contribution.siteId === site.id));
  const label = overwhelmed
    ? "稼働中・周辺で浸水が継続"
    : influence.structureId === "drainage-pump" && waterActivity < 0.01
      ? "稼働中・浸水を防ぐため排水中"
      : (labels[influence.structureId] ?? "稼働中");
  return result(activity, label, waterActivity);
}
