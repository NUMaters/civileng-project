import { describe, expect, it } from "vitest";
import {
  applyOverflowTerrainElevations,
  clearOverflowTerrainElevations,
  listOverflowCandidates,
  resolveCandidateVulnerability,
} from "./overflowBankSites";

describe("overflowBankSites", () => {
  it("手動弱点と中心線サンプルの候補を返す", () => {
    const candidates = listOverflowCandidates();
    expect(candidates.some((item) => item.id === "campus-core")).toBe(true);
    expect(candidates.some((item) => item.id.startsWith("bank-"))).toBe(true);
    expect(candidates.length).toBeGreaterThan(8);
  });

  it("DEM 標高が低い地点ほど vulnerability が高い", () => {
    clearOverflowTerrainElevations();
    const candidates = listOverflowCandidates();
    const low = candidates[0];
    const high = candidates[1];
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    if (low === undefined || high === undefined) {
      return;
    }

    applyOverflowTerrainElevations([
      { id: low.id, heightMeters: 10 },
      { id: high.id, heightMeters: 30 },
      ...candidates.slice(2).map((item) => ({ id: item.id, heightMeters: 20 })),
    ]);

    expect(resolveCandidateVulnerability(low)).toBeGreaterThan(
      resolveCandidateVulnerability(high),
    );
    clearOverflowTerrainElevations();
  });
});
