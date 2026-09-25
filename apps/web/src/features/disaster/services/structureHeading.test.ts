import { describe, expect, it } from "vitest";
import { ABUKUMA_RIVER_CENTERLINE } from "../../../components/GameCanvas/abukumaRiverGeometry";
import { getRiverPlacementContext, suggestedStructureHeading } from "./hydraulicPlacement";

describe("suggestedStructureHeading", () => {
  it.each(["levee", "revetment", "channel-dredging", "retention-basin"])(
    "%s の長軸を川に沿わせる",
    (id) => {
      for (const point of ABUKUMA_RIVER_CENTERLINE) {
        const heading = suggestedStructureHeading(id, {
          longitude: point.lon,
          latitude: point.lat,
        });
        expect(heading).toBeGreaterThanOrEqual(0);
        expect(heading).toBeLessThan(360);
        expect(
          getRiverPlacementContext(point.lon, point.lat, heading).alignmentWithChannel,
        ).toBeCloseTo(1);
      }
    },
  );
});
