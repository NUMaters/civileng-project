import { describe, expect, it } from "vitest";
import { placeStructure } from "./constructionService";
import type { StructureDefinition } from "../types/construction";

const levee: StructureDefinition = {
  id: "levee",
  displayName: "堤防",
  description: "越水を防ぐ",
  constructionCost: 3_500,
  constructionTimeSeconds: 18,
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
      remainingBudget: 6_500,
    });
  });

  it("rejects a structure when the budget is insufficient", () => {
    const result = placeStructure(levee, position, 3_000, "placement-1", 0);

    expect(result.ok).toBe(false);
  });
});
