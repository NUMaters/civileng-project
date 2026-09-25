import { describe, expect, it } from "vitest";
import { worldToGeo } from "./dioramaSpace";
import { GAMEPLAY_MAP_BOUNDS, GAMEPLAY_MAP_GEO_BOUNDS } from "./gameplayMapBounds";

describe("gameplay map bounds", () => {
  it("fixes the play area to the supplied Big Palette-to-Nihon University frame", () => {
    const northWest = worldToGeo(GAMEPLAY_MAP_BOUNDS.minX, GAMEPLAY_MAP_BOUNDS.minZ);
    const southEast = worldToGeo(GAMEPLAY_MAP_BOUNDS.maxX, GAMEPLAY_MAP_BOUNDS.maxZ);
    expect(northWest.longitude).toBeCloseTo(GAMEPLAY_MAP_GEO_BOUNDS.west, 8);
    expect(northWest.latitude).toBeCloseTo(GAMEPLAY_MAP_GEO_BOUNDS.north, 8);
    expect(southEast.longitude).toBeCloseTo(GAMEPLAY_MAP_GEO_BOUNDS.east, 8);
    expect(southEast.latitude).toBeCloseTo(GAMEPLAY_MAP_GEO_BOUNDS.south, 8);
    expect(GAMEPLAY_MAP_BOUNDS.maxX - GAMEPLAY_MAP_BOUNDS.minX).toBeGreaterThan(1500);
    expect(GAMEPLAY_MAP_BOUNDS.maxZ - GAMEPLAY_MAP_BOUNDS.minZ).toBeGreaterThan(2100);
  });
});
