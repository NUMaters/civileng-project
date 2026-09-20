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
      .flatMap((influence) => influence.coveredSiteIds),
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
