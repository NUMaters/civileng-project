import { describe, expect, it } from "vitest";
import { nextFacilityHeading, facilityPopScale } from "./facilityTap";
describe("facility tap feedback", () => {
  it("rotates exactly 36 degrees and returns after ten taps", () => {
    let heading = 321;
    expect(nextFacilityHeading(heading)).toBe(357);
    expect(nextFacilityHeading(357)).toBe(33);
    for (let i = 0; i < 10; i++) heading = nextFacilityHeading(heading);
    expect(heading).toBe(321);
  });
  it("pops and settles at its original scale", () => {
    expect(facilityPopScale(0)).toBe(1);
    expect(facilityPopScale(0.5)).toBeCloseTo(1.14);
    expect(facilityPopScale(1)).toBeCloseTo(1);
    expect(facilityPopScale(3)).toBeCloseTo(1);
  });
});
