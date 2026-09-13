import { describe, expect, it } from "vitest";
import type { PlacedStructure } from "../../construction";
import {
  influenceStrengthAt,
  resolveInfluenceZone,
  stripCenterlineDegrees,
  stripLongAxisHeadingDegrees,
} from "./influenceZones";

const BASE: PlacedStructure = {
  id: "p1",
  structureId: "levee",
  position: { longitude: 140.378, latitude: 37.36, height: 19 },
  headingDegrees: 45,
};

describe("influenceZones", () => {
  it("makes levees a long narrow strip along the crest axis", () => {
    const zone = resolveInfluenceZone(BASE, 0.9);
    expect(zone.kind).toBe("strip");
    expect(zone.headingDegrees).toBe(stripLongAxisHeadingDegrees(BASE.headingDegrees));
    if (zone.kind !== "strip") {
      return;
    }
    expect(zone.lengthMeters).toBeGreaterThan(zone.widthMeters * 4);
  });

  it("makes retention basins an elongated ellipse", () => {
    const zone = resolveInfluenceZone({ ...BASE, structureId: "retention-basin" }, 0.8);
    expect(zone.kind).toBe("ellipse");
    if (zone.kind !== "ellipse") {
      return;
    }
    expect(zone.majorMeters).toBeGreaterThan(zone.minorMeters);
  });

  it("makes drainage a forward fan that is weak behind the pump", () => {
    const zone = resolveInfluenceZone({ ...BASE, structureId: "drainage-pump", headingDegrees: 0 }, 1);
    expect(zone.kind).toBe("fan");
    const ahead = influenceStrengthAt(zone, 140.378, 37.3615);
    const behind = influenceStrengthAt(zone, 140.378, 37.3585);
    expect(ahead).toBeGreaterThan(behind * 2);
  });

  it("rotates strip axis with placement heading (crest = facing + 90°)", () => {
    const a = resolveInfluenceZone({ ...BASE, headingDegrees: 0 }, 1);
    const b = resolveInfluenceZone({ ...BASE, headingDegrees: 90 }, 1);
    // 向き 0°（北＝法面）→ 堤体長軸 90°（東西）。向き 90° → 長軸 180°（南北）。
    expect(a.headingDegrees).toBe(90);
    expect(b.headingDegrees).toBe(180);
    if (a.kind !== "strip" || b.kind !== "strip") {
      throw new Error("expected strip");
    }
    const lineA = stripCenterlineDegrees(a);
    const lineB = stripCenterlineDegrees(b);
    expect(Math.abs(lineA[2]! - lineA[0]!)).toBeGreaterThan(Math.abs(lineA[3]! - lineA[1]!));
    expect(Math.abs(lineB[3]! - lineB[1]!)).toBeGreaterThan(Math.abs(lineB[2]! - lineB[0]!));
  });
});
