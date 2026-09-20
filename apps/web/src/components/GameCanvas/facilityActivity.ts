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
  if (!influence || influence.preview || !state) return { activity: 0, label: "配置を検討中" };
  if (state.phase === "idle" || state.phase === "preparation") return { activity: 0, label: "大雨に備えて待機" };
  if (influence.adverseSiteIds.length) return { activity: 0, label: "相性注意・位置や向きを確認" };
  if (!influence.coveredSiteIds.length || influence.effectiveness <= 0)
    return { activity: 0, label: "対象の弱点が範囲外" };

  // Protection uses the simulation's current covered sites, not a placement-only badge.
  const sites = state.protectedBankSites.filter(site => influence.coveredSiteIds.includes(site.id));
  const protection = sites.reduce((max, site) => Math.max(max, clamp(site.protectionStrength)), 0);
  const rise = clamp((state.riverLevelMeters - 2.2) / 2.5);
  const demand = influence.structureId === "drainage-pump" ? clamp(state.floodDepthMeters / 0.7) : rise;
  const activity = clamp(influence.effectiveness) * protection * demand;
  if (activity < 0.01) return { activity: 0, label: "水の増加に備えて待機" };
  const overwhelmed = sites.some(site => site.overflowing);
  return { activity, label: overwhelmed ? "稼働中・周辺で浸水が継続" : (labels[influence.structureId] ?? "稼働中") };
}
