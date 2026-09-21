import { describe, expect, it } from "vitest";
import { HOWTO_FACILITIES, HOWTO_PURPOSE, HOWTO_STEPS, hazardChipLabel } from "./howtoContent";

describe("howtoContent", () => {
  it("covers all five MVP facilities with role, mechanism, and real-world notes", () => {
    expect(HOWTO_FACILITIES.map((item) => item.id).sort()).toEqual([
      "channel-dredging",
      "drainage-pump",
      "levee",
      "retention-basin",
      "revetment",
    ]);
    for (const facility of HOWTO_FACILITIES) {
      expect(facility.role.length).toBeGreaterThan(8);
      expect(facility.mechanism.length).toBeGreaterThan(12);
      expect(facility.realWorld.length).toBeGreaterThan(12);
      expect(facility.iconSrc).toContain(facility.id);
    }
  });

  it("keeps purpose and steps short enough to scan", () => {
    expect(HOWTO_PURPOSE.body.length).toBeLessThan(120);
    expect(HOWTO_STEPS).toHaveLength(3);
    expect(hazardChipLabel("overtopping")).toBe("対 越水");
  });
});
