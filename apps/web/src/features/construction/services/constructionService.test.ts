import { describe, expect, it } from "vitest";
import {
  applyDisasterStartGrant,
  DISASTER_START_GRANT,
  INITIAL_BUDGET,
  MAX_BUDGET,
  placeStructure,
  tickBudgetEconomy,
} from "./constructionService";
import type { StructureDefinition } from "../types/construction";

const levee: StructureDefinition = {
  id: "levee",
  displayName: "堤防",
  description: "越水を防ぐ",
  constructionCost: 3_000,
  constructionTimeSeconds: 18,
  maintenanceCostPerSecond: 3,
};

const position = {
  longitude: 140.377,
  latitude: 37.367,
  height: 0,
};

describe("placeStructure", () => {
  it("places a structure and subtracts its cost", () => {
    const result = placeStructure(levee, position, 10_000, "placement-1", 45);

    expect(result).toEqual({
      ok: true,
      placement: {
        id: "placement-1",
        structureId: "levee",
        position,
        headingDegrees: 45,
      },
      remainingBudget: 7_000,
    });
  });

  it("rejects a structure when the budget is insufficient", () => {
    const result = placeStructure(levee, position, 2_000, "placement-1", 0);

    expect(result.ok).toBe(false);
  });
});

describe("tickBudgetEconomy", () => {
  it("increases budget during preparation", () => {
    const result = tickBudgetEconomy({
      currentBudget: INITIAL_BUDGET,
      deltaSeconds: 10,
      phase: "preparation",
      placedStructureIds: [],
    });
    expect(result.budget).toBeGreaterThan(INITIAL_BUDGET);
    expect(result.netIncomePerSecond).toBeGreaterThan(0);
  });

  it("subtracts maintenance from income when structures are placed", () => {
    const idle = tickBudgetEconomy({
      currentBudget: 10_000,
      deltaSeconds: 1,
      phase: "disaster",
      placedStructureIds: [],
    });
    const withLevee = tickBudgetEconomy({
      currentBudget: 10_000,
      deltaSeconds: 1,
      phase: "disaster",
      placedStructureIds: ["levee"],
    });
    expect(withLevee.netIncomePerSecond).toBeLessThan(idle.netIncomePerSecond);
    expect(withLevee.budget).toBeLessThan(idle.budget);
  });

  it("does not change budget outside active phases", () => {
    const result = tickBudgetEconomy({
      currentBudget: 8_000,
      deltaSeconds: 5,
      phase: "result",
      placedStructureIds: [],
    });
    expect(result.budget).toBe(8_000);
    expect(result.netIncomePerSecond).toBe(0);
  });

  it("clamps to max budget", () => {
    const result = tickBudgetEconomy({
      currentBudget: MAX_BUDGET - 10,
      deltaSeconds: 60,
      phase: "disaster",
      placedStructureIds: [],
    });
    expect(result.budget).toBe(MAX_BUDGET);
  });
});

describe("applyDisasterStartGrant", () => {
  it("adds the emergency grant without exceeding the cap", () => {
    expect(applyDisasterStartGrant(5_000)).toBe(5_000 + DISASTER_START_GRANT);
    expect(applyDisasterStartGrant(MAX_BUDGET - 100)).toBe(MAX_BUDGET);
  });
});
