import { listOverflowCandidates } from "../../features/disaster/services/overflowBankSites";
import type { StructureInfluence } from "../../features/disaster/services/floodSimulation";

const guidance = {
  overtopping: { title: "越水への備え", advice: "この岸を堤防・遊水地で守ろう" },
  erosion: { title: "岸の侵食への備え", advice: "護岸で流れから岸を守ろう" },
  inlandPonding: { title: "街の内水への備え", advice: "排水機場で街の水を川へ戻そう" },
};

const contributedAdvice = "この地点に効果あり。大雨で確かめよう";

/** Compare already-visible, already-clear candidates without allocating in the draw loop. */
export function isPreferredDioramaGuidanceCandidate(
  candidateHasContribution: boolean,
  candidateScore: number,
  bestHasContribution: boolean | undefined,
  bestScore: number,
) {
  if (!Number.isFinite(candidateScore)) return false;
  if (bestHasContribution === undefined) return true;
  const candidateTier = candidateHasContribution ? 1 : 0;
  const bestTier = bestHasContribution ? 1 : 0;
  return candidateTier < bestTier || (candidateTier === bestTier && candidateScore < bestScore);
}

/** Explain real simulation sites, not decorative or fabricated danger markers. */
export function getDioramaGuidance(influences: readonly StructureInfluence[]) {
  const contributed = new Set(
    influences
      .filter((influence) => !influence.preview)
      .flatMap((influence) => (influence.positiveSiteContributions ?? [])
        .filter((site) => Number.isFinite(site.strength) && site.strength > 0 &&
          influence.coveredSiteIds.includes(site.siteId))
        .map((site) => site.siteId)),
  );
  return listOverflowCandidates()
    .flatMap((site) => {
      const message = guidance[site.primaryHazard as keyof typeof guidance];
      if (!message) return [];
      const hasContribution = contributed.has(site.id);
      return [{
        ...site,
        ...message,
        advice: hasContribution ? contributedAdvice : message.advice,
        hasContribution,
      }];
    });
}

export function initialDioramaFocus() {
  return listOverflowCandidates()
    .filter((site) => site.primaryHazard === "overtopping")
    .sort((a, b) => b.structuralVulnerability - a.structuralVulnerability)[0]!;
}
