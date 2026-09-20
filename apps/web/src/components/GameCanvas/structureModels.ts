import type { StructureMaterialKind } from "./structureMaterials";

export type StructureModelPart = {
  id: string;
  kind: "box" | "cylinder";
  dimensions?: { length: number; width: number; height: number };
  radius?: number;
  offsetEast?: number;
  offsetNorth?: number;
  centerHeight: number;
  material: StructureMaterialKind;
  accentHex?: string;
  repeatX?: number;
  repeatY?: number;
};

/** Dimensions follow local X (along the bank), Y (across the bank), Z. */
function box(
  id: string,
  length: number,
  width: number,
  height: number,
  centerHeight: number,
  material: StructureMaterialKind,
  offsetEast = 0,
  offsetNorth = 0,
): StructureModelPart {
  return {
    id,
    kind: "box",
    dimensions: { length, width, height },
    centerHeight,
    material,
    offsetEast,
    offsetNorth,
  };
}

/**
 * Broad engineering silhouettes with no decorative badges or subpixel railings.
 * Keep all slabs at least 0.8 m thick to match the scene renderer's minimum.
 * These visual dimensions never participate in the hydraulic simulation.
 */
export function getStructureModelParts(structureId: string): StructureModelPart[] {
  switch (structureId) {
    case "levee":
      // Low earth embankment and grass terraces, topped by a continuous service path.
      return [
        box("toe", 96, 34, 1.6, 0.8, "earth"),
        box("slope-lower", 94, 26, 2.4, 2.8, "grass"),
        box("slope-upper", 92, 16, 2, 5, "grass"),
        box("crest", 92, 7, 0.8, 6.4, "asphalt"),
      ];
    case "retention-basin":
      // A low rectangular enclosure reads as storage, rather than a raised circular tank.
      // The pool is below the crest and is not buried inside a solid berm.
      return [
        box("bed", 80, 60, 0.8, 0.4, "earth"),
        box("pool", 68, 48, 0.8, 1.2, "water"),
        box("berm-north", 80, 6, 3.2, 1.6, "grass", 0, 27),
        box("berm-south", 80, 6, 3.2, 1.6, "grass", 0, -27),
        box("berm-east", 6, 48, 3.2, 1.6, "grass", 37),
        box("berm-west", 6, 48, 3.2, 1.6, "grass", -37),
        box("outlet", 8, 10, 4, 2, "concrete", 36),
      ];
    case "drainage-pump":
      return [
        box("pad", 36, 28, 1.2, 0.6, "concrete"),
        box("hall", 24, 18, 9, 5.7, "concrete"),
        box("window-band", 19, 0.8, 2, 7, "metal", 0, 9.2),
        box("roof", 26, 20, 0.8, 10.6, "metal"),
        box("intake", 10, 16, 2, 1, "concrete", -17),
        box("intake-water", 7, 12, 0.8, 2.4, "water", -17),
      ];
    case "revetment":
      return [
        box("riprap", 76, 18, 1.6, 0.8, "riprap", 0, -3),
        box("apron", 74, 9, 1.6, 1.6, "concrete", 0, 2),
        box("wall", 74, 3.5, 5.2, 3.4, "concrete", 0, 7),
        box("coping", 76, 5, 0.8, 6.4, "concrete", 0, 7),
      ];
    case "channel-dredging":
      return [
        box("channel-bed", 102, 32, 0.8, 0.4, "riprap"),
        box("bank-left", 100, 6, 1.6, 0.8, "earth", 0, 13),
        box("bank-right", 100, 6, 1.6, 0.8, "earth", 0, -13),
        box("channel", 102, 20, 0.8, 1.2, "water"),
      ];
    default:
      return [box("facility", 22, 22, 10, 5, "concrete")];
  }
}

/** Symmetric bounds around the placement origin for the drag ghost (meters). */
export function getStructureFootprintMeters(structureId: string): {
  length: number;
  width: number;
  height: number;
} {
  let length = 0;
  let width = 0;
  let height = 0;
  for (const part of getStructureModelParts(structureId)) {
    const diameter = (part.radius ?? 10) * 2;
    const partLength = part.kind === "cylinder" ? diameter : (part.dimensions?.length ?? 0);
    const partWidth = part.kind === "cylinder" ? diameter : (part.dimensions?.width ?? 0);
    length = Math.max(length, partLength + Math.abs(part.offsetEast ?? 0) * 2);
    width = Math.max(width, partWidth + Math.abs(part.offsetNorth ?? 0) * 2);
    height = Math.max(height, part.centerHeight + (part.dimensions?.height ?? 0) * 0.5);
  }
  return { length, width, height };
}
