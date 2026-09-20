import { listOverflowCandidates } from "../../features/disaster/services/overflowBankSites";
import type { StructureInfluence } from "../../features/disaster/services/floodSimulation";

const guidance = {
  overtopping: { title: "越水への備え", advice: "この岸を堤防・遊水地で守ろう" },
  erosion: { title: "岸の侵食への備え", advice: "護岸で流れから岸を守ろう" },
  inlandPonding: { title: "街の内水への備え", advice: "排水機場で街の水を川へ戻そう" },
};

/** Explain real simulation sites, not decorative or fabricated danger markers. */
export function getDioramaGuidance(influences: readonly StructureInfluence[]) {
  const covered = new Set(
    influences
      .filter((influence) => !influence.preview)
      // Coverage is affinity/geometry only: e.g. a basin can cover ponding yet
      // contribute zero drainage. Require this facility's evaluated positive effect.
      // Keep the original coverage gate so tiny effects outside it do not hide more
      // guidance. Legacy snapshots without attribution keep the hint (same as 179).
      .flatMap((influence) => (influence.positiveSiteContributions ?? [])
        .filter((site) => Number.isFinite(site.strength) && site.strength > 0 &&
          influence.coveredSiteIds.includes(site.siteId))
        .map((site) => site.siteId)),
  );
  return listOverflowCandidates()
    .filter((site) => !covered.has(site.id))
    .flatMap((site) => {
      const message = guidance[site.primaryHazard as keyof typeof guidance];
      return message ? [{ ...site, ...message }] : [];
    });
}

export function initialDioramaFocus() {
  return listOverflowCandidates()
    .filter((site) => site.primaryHazard === "overtopping")
    .sort((a, b) => b.structuralVulnerability - a.structuralVulnerability)[0]!;
}
