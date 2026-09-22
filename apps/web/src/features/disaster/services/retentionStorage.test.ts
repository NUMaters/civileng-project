import { describe, expect, it } from "vitest";
import { advanceRetentionStorage, RETENTION_FILL_SECONDS } from "./retentionStorage";

const basin = {
  placementId: "basin",
  structureId: "retention-basin",
  effectiveness: 1,
  positiveSiteContributions: [{ siteId: "own-site", strength: 1 }],
};

describe("advanceRetentionStorage", () => {
  it("is partition invariant for constant activity and fills in 45 seconds", () => {
    const whole = advanceRetentionStorage(undefined, [basin], 4.8, 30);
    let parts: Record<string, number> = {};
    for (const dt of [0.25, 2.75, 7, 11, 9]) {
      parts = advanceRetentionStorage(parts, [basin], 4.8, dt);
    }
    expect(parts.basin).toBeCloseTo(whole.basin, 14);
    expect(whole.basin).toBeCloseTo(30 / RETENTION_FILL_SECONDS);
    expect(advanceRetentionStorage({}, [basin], 4.8, 45).basin).toBe(1);
    expect(advanceRetentionStorage(whole, [basin], 8, 1000).basin).toBe(1);
  });

  it("retains accumulated fill when demand or local activity stops", () => {
    const current = { basin: 0.4 };
    expect(advanceRetentionStorage(current, [basin], 2.2, 90)).toEqual(current);
    expect(advanceRetentionStorage(current, [{ ...basin, effectiveness: 0 }], 5, 90)).toEqual(
      current,
    );
    expect(
      advanceRetentionStorage(current, [{ ...basin, positiveSiteContributions: [] }], 5, 90),
    ).toEqual(current);
    expect(current).toEqual({ basin: 0.4 });
  });

  it("scales by own contribution, effectiveness, and river demand independently", () => {
    const next = advanceRetentionStorage(
      {},
      [
        basin,
        {
          ...basin,
          placementId: "weak",
          effectiveness: 0.5,
          positiveSiteContributions: [{ siteId: "other", strength: 0.4 }],
        },
        { ...basin, placementId: "uncovered", positiveSiteContributions: [] },
      ],
      3.45,
      45,
    );
    expect(next.basin).toBeCloseTo(0.5);
    expect(next.weak).toBeCloseTo(0.1);
    expect(next.uncovered).toBe(0);
  });

  it("does not multiply activity by site count or borrow other facilities' attribution", () => {
    const multiple = {
      ...basin,
      positiveSiteContributions: [
        { siteId: "a", strength: 0.5 },
        { siteId: "b", strength: 0.5 },
      ],
    };
    expect(advanceRetentionStorage({}, [multiple], 4.8, 45).basin).toBe(0.5);
    expect(
      advanceRetentionStorage(
        {},
        [
          { ...basin, positiveSiteContributions: undefined },
          { ...basin, placementId: "levee", structureId: "levee" },
        ],
        4.8,
        45,
      ),
    ).toEqual({ basin: 0 });
  });

  it("prunes deleted and preview basins while initializing late placements empty", () => {
    expect(
      advanceRetentionStorage(
        { deleted: 0.8, preview: 0.5 },
        [basin, { ...basin, placementId: "preview", preview: true }],
        5,
        0,
      ),
    ).toEqual({ basin: 0 });
    expect(advanceRetentionStorage(undefined, [basin], 5, 1).basin).toBeCloseTo(1 / 45);
  });

  it("rejects invalid inputs without inflow and sanitizes stored fractions", () => {
    for (const dt of [-1, NaN, Infinity]) {
      expect(advanceRetentionStorage({ basin: 0.3 }, [basin], 5, dt).basin).toBe(0.3);
    }
    for (const river of [NaN, Infinity, -Infinity]) {
      expect(advanceRetentionStorage({}, [basin], river, 45).basin).toBe(0);
    }
    for (const effectiveness of [0, -1, NaN, Infinity]) {
      expect(advanceRetentionStorage({}, [{ ...basin, effectiveness }], 5, 45).basin).toBe(0);
    }
    for (const strength of [-1, 0, NaN, Infinity]) {
      expect(
        advanceRetentionStorage(
          {},
          [{ ...basin, positiveSiteContributions: [{ siteId: "bad", strength }] }],
          5,
          45,
        ).basin,
      ).toBe(0);
    }
    for (const [stored, expected] of [
      [NaN, 0],
      [Infinity, 0],
      [-1, 0],
      [2, 1],
    ]) {
      expect(advanceRetentionStorage({ basin: stored }, [basin], 5, 0).basin).toBe(expected);
    }
  });
});
