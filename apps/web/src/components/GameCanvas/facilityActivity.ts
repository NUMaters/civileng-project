import type { FloodSimulationState, StructureInfluence } from "../../features/disaster/services/floodSimulation";

const clamp = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
const labels: Record<string, string> = {
  levee: "越水を抑制中", "retention-basin": "洪水を一時貯留中",
  "drainage-pump": "街側の水を排水中", revetment: "岸の侵食を抑制中",
  "channel-dredging": "流下断面を確保",
};

type ActivityState = Pick<FloodSimulationState, "riverLevelMeters" | "floodDepthMeters" | "protectedBankSites"> & { phase: string };

/** Operational illustration, not a per-facility measured flow or saved-damage attribution. */
export function resolveFacilityActivity(influence: StructureInfluence | undefined, state: ActivityState | undefined) {
  // A mismatch is a separate warning, not a facility-wide simulation shutdown.
  const warning = influence?.adverseSiteIds.length ? `相性注意${influence.adverseSiteIds.length}地点` : undefined;
  const result = (activity: number, label: string) => ({
    activity, warning, label: warning ? `${label}・${warning}` : label,
  });
  if (!influence || influence.preview || !state) return result(0, "配置を検討中");
  if (state.phase === "idle" || state.phase === "preparation") return result(0, "大雨に備えて待機");
  if (!influence.positiveSiteContributions) return result(0, "施設の寄与を確認できません");

  const contributions = influence.positiveSiteContributions.filter(site => clamp(site.strength) > 0);
  const protection = contributions.reduce((max, site) => Math.max(max, clamp(site.strength)), 0);
  if (!protection || clamp(influence.effectiveness) === 0) return result(0, "対象地点への有効な寄与なし");
  const rise = clamp((state.riverLevelMeters - 2.2) / 2.5);
  const demand = influence.structureId === "drainage-pump" ? clamp(state.floodDepthMeters / 0.7) : rise;
  const activity = clamp(influence.effectiveness) * protection * demand;
  if (activity < 0.01) return result(0, "水の増加に備えて待機");
  // Aggregate site state is used only for the continuing-flood warning, never attribution.
  const overwhelmed = state.protectedBankSites.some(site => site.overflowing &&
    contributions.some(contribution => contribution.siteId === site.id));
  return result(activity, overwhelmed ? "稼働中・周辺で浸水が継続" : (labels[influence.structureId] ?? "稼働中"));
}
