import { describe, expect, it } from "vitest";
import { loadGameData, loadRules, loadStructures } from "./load";

describe("loadGameData", () => {
  it("loads five MVP structures with costs", () => {
    const structures = loadStructures();
    expect(structures).toHaveLength(5);
    expect(structures.map(({ id }) => id).sort()).toEqual([
      "channel-dredging",
      "drainage-pump",
      "levee",
      "retention-basin",
      "revetment",
    ]);
    expect(structures.every((s) => s.constructionCost > 0)).toBe(true);
    expect(structures.every((s) => s.role.strengths.length > 0)).toBe(true);
    expect(structures.every((s) => typeof s.hazardAffinity.overtopping === "number")).toBe(
      true,
    );
  });

  it("loads solo budget and phase timing", () => {
    const rules = loadRules();
    expect(rules.budget.initialBudgetSolo).toBe(12_000);
    expect(rules.budget.incomePerSecondPreparation).toBe(80);
    expect(rules.budget.incomePerSecondDisaster).toBe(110);
    expect(rules.budget.disasterStartGrant).toBe(2_000);
    expect(rules.budget.maxBudget).toBe(24_000);
    expect(rules.timing.totalPlayTimeSeconds).toBe(180);
    expect(rules.victory.clearThresholdPercent).toBe(5);
  });

  it("bundles structures, rules, and disasters", () => {
    const data = loadGameData();
    expect(data.structures).toHaveLength(5);
    expect(data.disasters.some((d) => d.id === "heavy-rain" && d.mvp)).toBe(true);
  });
});
