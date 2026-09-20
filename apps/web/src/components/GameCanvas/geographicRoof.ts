import { ShapeUtils, Vector2 } from "three";

export type RoofPlanPoint = { x: number; z: number };
export type RoofPoint = RoofPlanPoint & { y: number };
export type RoofTriangle = [RoofPoint, RoofPoint, RoofPoint];
export type GeographicRoofOptions = {
  /** Local metre coordinates: exterior followed by holes, closed or unclosed rings. */
  rings: readonly (readonly RoofPlanPoint[])[];
  baseY: number;
  heightM: number;
  sourceRoofShape?: string | null;
  /** Explicit opt-in to decorative roofs on untagged small compact buildings. Default false. */
  allowIllustrativeHip?: boolean;
  /** Caller must pass school/campus building identity; footprint alone cannot identify its use. */
  isSchool?: boolean;
  buildingUse?: string;
};
export type GeographicRoof = {
  style: "flat" | "gabled" | "hipped";
  /** Includes vertical gable end caps. No bottom, walls, overhang, chimney or extra geometry. */
  triangles: RoofTriangle[];
  eaveY: number;
  topY: number;
  roofRiseM: number;
  footprintAreaM2: number;
  ridge: [RoofPoint, RoofPoint] | null;
  provenance: {
    classification: "tagged-shape-but-inferred-pitch" | "illustrative" | "flat";
    sourceRoofShape: string | null;
    reason: string;
    ridge: "inferred-from-footprint-not-surveyed" | "none";
    heightPolicy: "original-base-plus-height-is-maximum-roof-top";
  };
};

const same = (a: RoofPlanPoint, b: RoofPlanPoint) => a.x === b.x && a.z === b.z;
const signedArea = (ring: RoofPlanPoint[]) => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length]!;
  // Translate to the first point to avoid cancellation far from the origin.
  const o = ring[0]!;
  return sum + (p.x - o.x) * (q.z - o.z) - (q.x - o.x) * (p.z - o.z);
}, 0) / 2;

/** Pure illustrative geometry, never a reconstruction of surveyed roof pitch/ridge.
 * Both tagged and illustrative pitched candidates must be convex near-rectangles <=350m²,
 * without holes and not school buildings. Untagged fallback additionally needs height<=14m
 * and aspect ratio<=2.5. Tagged unsupported shapes never fall through to illustrative hips.
 * All new X/Z points are convex combinations of source corners. Eaves descend from the
 * ORIGINAL maximum top by min(2.5m, height*0.2); no source height is added or exaggerated.
 */
export function createGeographicRoof(options: GeographicRoofOptions): GeographicRoof {
  const { baseY, heightM } = options;
  const topY = baseY + heightM;
  if (!Number.isFinite(baseY) || !Number.isFinite(heightM) || heightM < 0 || !Number.isFinite(topY)) throw new RangeError("Invalid roof height envelope");
  const rings = options.rings.map((ring) => {
    const copy = ring.map(({ x, z }) => ({ x, z })).filter((p, i, ps) => i === 0 || !same(p, ps[i - 1]!));
    if (copy.length > 1 && same(copy[0]!, copy.at(-1)!)) copy.pop();
    return copy;
  });
  if (!rings.length || rings.some((ring) => ring.length < 3 || ring.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z)))) throw new RangeError("Invalid roof polygon rings");
  const outer = rings[0]!;
  const footprintAreaM2 = Math.max(0, Math.abs(signedArea(outer)) - rings.slice(1).reduce((n, r) => n + Math.abs(signedArea(r)), 0));
  const shape = options.sourceRoofShape?.trim().toLowerCase() || null;
  const school = options.isSchool || /school|university|college|education|campus|学校|大学|教育/i.test(options.buildingUse ?? "");
  const edges = outer.map((p, i) => ({ x: outer[(i + 1) % outer.length]!.x - p.x, z: outer[(i + 1) % outer.length]!.z - p.z }));
  const lengths = edges.map((p) => Math.hypot(p.x, p.z));
  let winding = 0;
  const rectangle = rings.length === 1 && outer.length === 4 && edges.every((a, i) => {
    const b = edges[(i + 1) % 4]!, product = lengths[i]! * lengths[(i + 1) % 4]!;
    const cross = a.x * b.z - a.z * b.x, sign = Math.sign(cross);
    if (product < 0.01 || !sign || (winding && sign !== winding)) return false;
    winding = sign;
    return Math.abs(a.x * b.x + a.z * b.z) / product <= Math.sin(2 * Math.PI / 180);
  });
  const aspect = Math.max(...lengths) / Math.min(...lengths);
  let reason = "eligible", style: GeographicRoof["style"] = "flat";
  if (school) reason = "school-retains-flat";
  else if (!rectangle) reason = "complex-or-holed-footprint-retains-flat";
  else if (footprintAreaM2 > 350 || footprintAreaM2 < 1) reason = "footprint-size-retains-flat";
  else if (heightM <= 0) reason = "zero-height-retains-flat";
  else if (shape === "gabled" || shape === "hipped") style = shape;
  else if (shape) reason = "unsupported-source-shape-retains-flat";
  else if (!options.allowIllustrativeHip) reason = "illustrative-fallback-disabled";
  else if (heightM > 14 || aspect > 2.5) reason = "not-small-compact-building";
  else { style = "hipped"; reason = "opted-in-small-building-illustration"; }
  const provenance: GeographicRoof["provenance"] = {
    classification: style === "flat" ? "flat" : shape ? "tagged-shape-but-inferred-pitch" : "illustrative",
    sourceRoofShape: shape, reason, ridge: style === "flat" ? "none" : "inferred-from-footprint-not-surveyed",
    heightPolicy: "original-base-plus-height-is-maximum-roof-top",
  };
  const triangles: RoofTriangle[] = [];
  function add(a: RoofPoint, b: RoofPoint, c: RoofPoint) {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-10) return;
    triangles.push(ny < 0 ? [a, c, b] : [a, b, c]);
  }
  if (style === "flat") {
    const flat = rings.flat();
    const shapes = rings.map((ring) => ring.map((p) => new Vector2(p.x, -p.z)));
    for (const face of ShapeUtils.triangulateShape(shapes[0]!, shapes.slice(1))) {
      const [a, b, c] = face.map((i) => ({ ...flat[i]!, y: topY }));
      add(a!, b!, c!);
    }
    return { style, triangles, eaveY: topY, topY, roofRiseM: 0, footprintAreaM2, ridge: null, provenance };
  }
  const roofRiseM = Math.min(2.5, heightM * 0.2), eaveY = topY - roofRiseM;
  // Rotate corners so 0->1 and 2->3 are the longer pair. Winding may be either orientation.
  const offset = (lengths[0]! + lengths[2]!) >= (lengths[1]! + lengths[3]!) ? 0 : 1;
  const corners = Array.from({ length: 4 }, (_, i) => ({ ...outer[(i + offset) % 4]!, y: eaveY }));
  const [p0, p1, p2, p3] = corners as [RoofPoint, RoofPoint, RoofPoint, RoofPoint];
  const start = { x: (p3.x + p0.x) / 2, z: (p3.z + p0.z) / 2 };
  const end = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
  const ridgeLength = Math.hypot(end.x - start.x, end.z - start.z);
  const width = (Math.hypot(p0.x - p3.x, p0.z - p3.z) + Math.hypot(p1.x - p2.x, p1.z - p2.z)) / 2;
  const inset = style === "hipped" ? Math.min(0.5, width / (2 * ridgeLength)) : 0;
  const ridgePoint = (t: number): RoofPoint => ({ x: start.x + (end.x - start.x) * t, y: topY, z: start.z + (end.z - start.z) * t });
  const r0 = ridgePoint(inset), r1 = ridgePoint(1 - inset);
  add(p0, p1, r1); add(p0, r1, r0);
  add(p2, p3, r0); add(p2, r0, r1);
  add(p3, p0, r0); add(p1, p2, r1);
  return { style, triangles, eaveY, topY, roofRiseM, footprintAreaM2, ridge: [r0, r1], provenance };
}
