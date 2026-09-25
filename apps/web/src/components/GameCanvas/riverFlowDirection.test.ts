import { describe, expect, it } from "vitest";
import { ABUKUMA_RIVER_CENTERLINE } from "./abukumaRiverGeometry";

describe("阿武隈川の流向", () => {
  it("中心線は南（下流）から北（上流）の順で並ぶ", () => {
    const south = ABUKUMA_RIVER_CENTERLINE[0];
    const north = ABUKUMA_RIVER_CENTERLINE[ABUKUMA_RIVER_CENTERLINE.length - 1];
    expect(south).toBeDefined();
    expect(north).toBeDefined();
    expect(south!.lat).toBeLessThan(north!.lat);
  });

  it("下流方向サンプルは北から南へ進む", () => {
    const downstream = [...ABUKUMA_RIVER_CENTERLINE].reverse();
    expect(downstream[0]!.lat).toBeGreaterThan(downstream[downstream.length - 1]!.lat);
  });
});
