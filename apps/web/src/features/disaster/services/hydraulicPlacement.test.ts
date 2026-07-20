import { describe, expect, it } from "vitest";
import { calculateHydraulicEffectiveness, getRiverPlacementContext } from "./hydraulicPlacement";

describe("hydraulicPlacement", () => {
  it("河岸帯（中心線から約 55 m）を onBank と判定する", () => {
    const ctx = getRiverPlacementContext(140.37776, 37.359853, 50);
    expect(ctx.distanceToCenterlineMeters).toBeGreaterThan(35);
    expect(ctx.distanceToCenterlineMeters).toBeLessThan(75);
    expect(ctx.onBank).toBe(true);
  });

  it("河道掘削は本川寄りで効きやすい", () => {
    const inChannel = calculateHydraulicEffectiveness({
      id: "d1",
      structureId: "channel-dredging",
      position: { longitude: 140.37737, latitude: 37.36024, height: 17 },
      headingDegrees: 50,
    });
    const onFarBank = calculateHydraulicEffectiveness({
      id: "d2",
      structureId: "channel-dredging",
      position: { longitude: 140.3785, latitude: 37.36024, height: 17 },
      headingDegrees: 50,
    });
    expect(inChannel).toBeGreaterThan(onFarBank);
  });
});
