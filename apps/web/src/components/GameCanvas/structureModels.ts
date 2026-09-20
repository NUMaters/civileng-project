import type { StructureMaterialKind } from "./structureMaterials";
import { BASIN_PORTS } from "./facilityVisualPorts";

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

/** Rounded berm with a lowered north inlet and an east culvert bore.
 * Closed sector prisms retain the empty enclosure and the original 92x72x9 bounds.
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
  const rings: [number, number, number][][] = [];
  for (const { x, y, r, z } of loops) {
    const ring: [number, number, number][] = [];
    for (let corner = 0; corner < 4; corner += 1) {
      const cx = corner === 0 || corner === 3 ? x - r : -x + r;
      const cy = corner < 2 ? y - r : -y + r;
      for (let step = 0; step <= 3; step += 1) {
        const angle = ((corner + step / 3) * Math.PI) / 2;
        ring.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle), z]);
      }
      if (corner === 0) {
        for (const east of [7, BASIN_PORTS.inletHalfWidth, -BASIN_PORTS.inletHalfWidth, -7]) {
          ring.push([east, y, Math.abs(east) <= BASIN_PORTS.inletHalfWidth && z > 0
            ? BASIN_PORTS.sillHeight - 4.5 : z]);
        }
      }
      if (corner === 3) {
        for (const north of [-4, -BASIN_PORTS.outletHalfWidth, BASIN_PORTS.outletHalfWidth, 4]) {
          ring.push([x, north, z]);
        }
      }
    }
    rings.push(ring);
  }
  const count = rings[0].length;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const bore = rings[0][i][0] === 46 && rings[0][next][0] === 46 &&
      Math.abs(rings[0][i][1]) <= BASIN_PORTS.outletHalfWidth &&
      Math.abs(rings[0][next][1]) <= BASIN_PORTS.outletHalfWidth;
    const base = positions.length;
    for (const index of [i, next]) {
      for (let loop = 0; loop < 4; loop++) {
        const p = [...rings[loop][index]] as [number, number, number];
        if (bore) {
          p[0] = loop < 2 ? BASIN_PORTS.outletOuterX : BASIN_PORTS.outletInnerX;
          p[2] = loop === 0 || loop === 3 ? BASIN_PORTS.outletCeiling - 4.5 : 4.5;
        }
        positions.push(p);
      }
    }
    for (let loop = 0; loop < 4; loop++) {
      const nextLoop = (loop + 1) % 4;
      indices.push(base + loop, base + loop + 4, base + nextLoop + 4,
        base + loop, base + nextLoop + 4, base + nextLoop);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3,
      base + 4, base + 6, base + 5, base + 4, base + 7, base + 6);
  }
  return { ...box("berm", 92, 72, 9, 4.5, "grass"), kind: "mesh", mesh: { positions, indices } };
}

/**
 * Broad engineering silhouettes with no decorative badges or subpixel railings.
 * Box slabs must be at least 0.8 m thick (the legacy renderer's minimum).
 * Thin basin beds/inverts use closed meshes to preserve their exact clearance.
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
      // Dry storage by default; operational filling belongs to the view adapter.
      return [
        wedge("bed", 68, 48, 48, 0.2, 0.1, "earth"),
        basinBerm(),
        { ...wedge("drain-floor", 16, 6, 6, 0.3, 0.15, "concrete"), offsetEast: 38 },
        box("outlet", 10, 12, 6, 9, "concrete", 37),
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
