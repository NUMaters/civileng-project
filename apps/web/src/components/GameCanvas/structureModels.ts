import type { StructureMaterialKind } from "./structureMaterials";

export type StructureModelPart = {
  id: string;
  kind: "box" | "cylinder" | "mesh";
  /** Closed triangle mesh, local meters relative to the part center (east, north, up).
   * Renderer: rotate with placement heading, translate by centerHeight/offsets,
   * compute per-face normals, and use the same opaque material as other parts.
   * dimensions is the mesh bounding size, NOT a box fallback (which fills basin holes).
   */
  mesh?: { positions: [number, number, number][]; indices: number[] };
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

/** Closed prism with a trapezoidal cross-section; four broad sloping/flat faces. */
function wedge(
  id: string,
  length: number,
  width: number,
  crestWidth: number,
  height: number,
  centerHeight: number,
  material: StructureMaterialKind,
  offsetNorth = 0,
): StructureModelPart {
  const x = length / 2;
  const y = width / 2;
  const c = crestWidth / 2;
  const z = height / 2;
  return {
    ...box(id, length, width, height, centerHeight, material, 0, offsetNorth),
    kind: "mesh",
    mesh: {
      positions: [
        [-x, -y, -z],
        [x, -y, -z],
        [x, y, -z],
        [-x, y, -z],
        [-x, -c, z],
        [x, -c, z],
        [x, c, z],
        [-x, c, z],
      ],
      indices: [
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
        0, 4, 3, 4, 7,
      ],
    },
  };
}

/** Rounded rectangular berm: four concentric loops form an actual empty enclosure.
 * Outer/inner toes sit at z=0; the broad crest is at z=9. No solid lid covers water.
 */
function basinBerm(): StructureModelPart {
  const positions: [number, number, number][] = [];
  const indices: number[] = [];
  const loops = [
    { x: 46, y: 36, r: 14, z: -4.5 },
    { x: 41, y: 31, r: 12, z: 4.5 },
    { x: 34, y: 24, r: 8, z: 4.5 },
    { x: 30, y: 20, r: 6, z: -4.5 },
  ];
  for (const { x, y, r, z } of loops) {
    for (let corner = 0; corner < 4; corner += 1) {
      const cx = corner === 0 || corner === 3 ? x - r : -x + r;
      const cy = corner < 2 ? y - r : -y + r;
      for (let step = 0; step <= 3; step += 1) {
        const angle = ((corner + step / 3) * Math.PI) / 2;
        positions.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle), z]);
      }
    }
  }
  const count = 16;
  for (let loop = 0; loop < 4; loop += 1) {
    const nextLoop = (loop + 1) % 4;
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      const a = loop * count + i;
      const b = loop * count + next;
      const c = nextLoop * count + next;
      const d = nextLoop * count + i;
      indices.push(a, b, c, a, c, d);
    }
  }
  return { ...box("berm", 92, 72, 9, 4.5, "grass"), kind: "mesh", mesh: { positions, indices } };
}

/**
 * Broad engineering silhouettes with no decorative badges or subpixel railings.
 * Keep all slabs at least 0.8 m thick to match the scene renderer's minimum.
 * These visual dimensions never participate in the hydraulic simulation.
 */
export function getStructureModelParts(structureId: string): StructureModelPart[] {
  switch (structureId) {
    case "levee":
      // A continuous raised trapezoid, with a broad crest and visible earth footing.
      return [
        box("toe", 98, 38, 2, 1, "earth"),
        wedge("embankment", 96, 36, 12, 12, 8, "grass"),
        box("crest", 96, 9, 1, 14.5, "asphalt"),
      ];
    case "retention-basin":
      // Water intersects the inner slope below its crest, leaving a deep visible rim.
      return [
        box("bed", 90, 70, 1, 0.5, "earth"),
        basinBerm(),
        box("pool", 68, 48, 1, 3, "water"),
        box("outlet", 10, 12, 12, 6, "concrete", 37),
        box("outlet-roof", 12, 14, 1.2, 12.6, "metal", 37),
      ];
    case "drainage-pump":
      return [
        box("pad", 36, 28, 1.2, 0.6, "concrete"),
        box("hall", 26, 20, 16, 9.2, "concrete"),
        box("window-band", 20, 0.8, 3.5, 12, "metal", 0, 10.2),
        box("roof", 30, 24, 2, 18.2, "metal"),
        box("intake", 10, 16, 2, 1, "concrete", -17),
        box("intake-water", 7, 12, 0.8, 2.4, "water", -17),
      ];
    case "revetment":
      return [
        box("riprap", 76, 18, 1.6, 0.8, "riprap", 0, -3),
        box("apron", 74, 9, 1.6, 1.6, "concrete", 0, 2),
        wedge("wall", 74, 8, 4, 10, 5, "concrete", 7),
        box("coping", 76, 6, 1.2, 10.6, "concrete", 0, 7),
      ];
    case "channel-dredging":
      return [
        box("channel-bed", 102, 32, 0.8, 0.4, "riprap"),
        wedge("bank-left", 100, 10, 5, 6, 3.8, "earth", 13),
        wedge("bank-right", 100, 10, 5, 6, 3.8, "earth", -13),
        box("channel", 102, 22, 1, 1.3, "water"),
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
