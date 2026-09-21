import * as THREE from "three";
import { isGeodataBridge, koriyamaGeoToLocal, KORIYAMA_ATTRIBUTION, type KoriyamaGeodata } from "./koriyamaGeodata";

export type BridgeBounds = { minX: number; minZ: number; maxX: number; maxZ: number };
export type GeographicBridgeOptions = {
  bounds: BridgeBounds;
  groundSampler: (x: number, z: number) => number | null;
  /** Optional land classifier; false/null rejects the endpoint. Without it land status is assumed. */
  isLandEndpoint?: (x: number, z: number) => boolean | null;
  endpointLift?: number;
  deckThickness?: number;
  guardrailHeight?: number;
  roadWidth?: number;
  railWidth?: number;
  tileSize?: number;
  maxBatchVertices?: number;
};
type Point = { x: number; y: number; z: number };
export type BridgeProfile = {
  sourceId: string; lineIndex: number; kind: "road" | "rail"; bridgeTag: string | number;
  width: number; widthSource: "osm-width-tag-unverified" | "decorative-default";
  endpointGround: [number, number]; length: number;
  points: (Point & { distance: number })[];
  elevationSource: "estimated-endpoint-interpolation-not-surveyed";
  landStatus: "caller-classified" | "assumed-OSM-bridge-endpoints";
};
export type BridgeSkip = { sourceId: string; reason: "invalid-line" | "outside-endpoints" | "no-data-endpoints" | "non-land-endpoints" };

/** Returns only completely rendered source IDs, safe for omitting the corresponding flat ribbons.
 * Original endpoints must be inside bounds and have valid ground. Never substitute clipped or
 * interior river points as land anchors. MultiLineString is atomic: one invalid part skips the way.
 * Elevation follows accumulated source-path distance between endpoint elevations, NOT interior DEM.
 * Width, lift, thickness and continuous guardrails are illustrative; no surveyed clearance or piers.
 * All GPU resources are owned by group descendants; caller's disposeObject traversal is sufficient.
 */
export function createGeographicBridges(data: KoriyamaGeodata, options: GeographicBridgeOptions) {
  const { bounds, groundSampler } = options;
  const lift = options.endpointLift ?? 0.12, thickness = options.deckThickness ?? 0.65;
  const railHeight = options.guardrailHeight ?? 0.9, roadWidth = options.roadWidth ?? 5, railWidth = options.railWidth ?? 4;
  const tileSize = options.tileSize ?? 512, maxVertices = options.maxBatchVertices ?? 32766;
  if (!Object.values(bounds).every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ ||
      ![lift, railHeight].every((n) => Number.isFinite(n) && n >= 0) ||
      ![thickness, roadWidth, railWidth].every((n) => Number.isFinite(n) && n > 0) ||
      !Number.isFinite(tileSize) || tileSize < 16 || !Number.isInteger(maxVertices) || maxVertices < 3 || maxVertices > 65535) throw new RangeError("Invalid bridge geometry options");
  const group = new THREE.Group(); group.name = "geographic-bridges";
  const sourceIds = new Set<string>(), profiles: BridgeProfile[] = [], skipped: BridgeSkip[] = [];
  const inside = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.z) && p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ;
  for (const feature of data.features) {
    const kind = feature.properties.kind;
    if ((kind !== "road" && kind !== "rail") || !isGeodataBridge(feature)) continue;
    if (feature.geometry.type !== "MultiLineString" || !feature.geometry.coordinates.length) { skipped.push({ sourceId: feature.id, reason: "invalid-line" }); continue; }
    const raw = feature.properties.width;
    const tagged = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?(?:\s*m)?$/.test(raw) ? Number.parseFloat(raw) : NaN;
    const validWidth = Number.isFinite(tagged) && tagged > 0;
    const pending: BridgeProfile[] = [];
    let reason: BridgeSkip["reason"] | undefined;
    for (const [lineIndex, line] of feature.geometry.coordinates.entries()) {
      const points = line.map(koriyamaGeoToLocal);
      if (points.length < 2 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))) { reason = "invalid-line"; break; }
      const a = points[0]!, b = points.at(-1)!;
      if (!inside(a) || !inside(b)) { reason = "outside-endpoints"; break; }
      if (options.isLandEndpoint && (!options.isLandEndpoint(a.x, a.z) || !options.isLandEndpoint(b.x, b.z))) { reason = "non-land-endpoints"; break; }
      const ya = groundSampler(a.x, a.z), yb = groundSampler(b.x, b.z);
      if (ya === null || yb === null || !Number.isFinite(ya) || !Number.isFinite(yb)) { reason = "no-data-endpoints"; break; }
      const distances = [0];
      for (let i = 1; i < points.length; i++) distances.push(distances[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z));
      const length = distances.at(-1)!;
      if (length < 1e-6) { reason = "invalid-line"; break; }
      pending.push({ sourceId: feature.id, lineIndex, kind, bridgeTag: feature.properties.bridge!,
        width: validWidth ? tagged : kind === "road" ? roadWidth : railWidth,
        widthSource: validWidth ? "osm-width-tag-unverified" : "decorative-default",
        endpointGround: [ya, yb], length, points: points.map((p, i) => ({ ...p, y: ya + (yb - ya) * distances[i]! / length + lift, distance: distances[i]! })),
        elevationSource: "estimated-endpoint-interpolation-not-surveyed",
        landStatus: options.isLandEndpoint ? "caller-classified" : "assumed-OSM-bridge-endpoints" });
    }
    if (reason) skipped.push({ sourceId: feature.id, reason });
    else { profiles.push(...pending); sourceIds.add(feature.id); }
  }
  const stats = { sourceFeatures: sourceIds.size, profiles: profiles.length, skippedFeatures: skipped.length, batches: 0, vertices: 0 };
  group.userData = { attribution: KORIYAMA_ATTRIBUTION, profiles, skipped, stats,
    assumptions: ["estimated-endpoint-interpolation-not-surveyed", "interior-DEM-not-deck-elevation", "no-surveyed-clearance", "no-piers-or-invented-arches", "deck-thickness-and-guardrails-decorative"],
    endpointLift: lift, deckThickness: thickness, guardrailHeight: railHeight };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.83, side: THREE.DoubleSide });
  const deckColor = new THREE.Color("#ead7ae"), railColor = new THREE.Color("#718da3");
  type Batch = { tx: number; tz: number; positions: number[]; colors: number[] };
  const batches = new Map<string, Batch>();
  function flush(batch: Batch) {
    if (!batch.positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(batch.colors, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `bridge-batch/${batch.tx}/${batch.tz}/${stats.batches}`;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.tile = [batch.tx, batch.tz];
    group.add(mesh); stats.batches++; stats.vertices += batch.positions.length / 3;
    batch.positions = []; batch.colors = [];
  }
  function clip(points: Point[], axis: "x" | "z", value: number, above: boolean) {
    const output: Point[] = []; let a = points.at(-1);
    if (!a) return output;
    for (const b of points) {
      const ai = above ? a[axis] >= value : a[axis] <= value, bi = above ? b[axis] >= value : b[axis] <= value;
      if (ai !== bi) {
        const t = (value - a[axis]) / (b[axis] - a[axis]);
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; p[axis] = value; output.push(p);
      }
      if (bi) output.push(b); a = b;
    }
    return output;
  }
  function triangle(a: Point, b: Point, c: Point, color: THREE.Color) {
    const minX = Math.max(bounds.minX, Math.min(a.x, b.x, c.x)), maxX = Math.min(bounds.maxX, Math.max(a.x, b.x, c.x));
    const minZ = Math.max(bounds.minZ, Math.min(a.z, b.z, c.z)), maxZ = Math.min(bounds.maxZ, Math.max(a.z, b.z, c.z));
    if (minX > maxX || minZ > maxZ) return;
    for (let tx = Math.floor(minX / tileSize); tx <= Math.floor(maxX / tileSize); tx++) for (let tz = Math.floor(minZ / tileSize); tz <= Math.floor(maxZ / tileSize); tz++) {
      let polygon = clip([a, b, c], "x", Math.max(bounds.minX, tx * tileSize), true);
      polygon = clip(polygon, "x", Math.min(bounds.maxX, (tx + 1) * tileSize), false);
      polygon = clip(polygon, "z", Math.max(bounds.minZ, tz * tileSize), true);
      polygon = clip(polygon, "z", Math.min(bounds.maxZ, (tz + 1) * tileSize), false);
      const key = `${tx}/${tz}`;
      for (let i = 1; i < polygon.length - 1; i++) {
        const ps = [polygon[0]!, polygon[i]!, polygon[i + 1]!];
        const u = new THREE.Vector3().subVectors(ps[1]!, ps[0]!), v = new THREE.Vector3().subVectors(ps[2]!, ps[0]!);
        if (u.cross(v).lengthSq() < 1e-16) continue;
        let batch = batches.get(key);
        if (!batch) { batch = { tx, tz, positions: [], colors: [] }; batches.set(key, batch); }
        if (batch.positions.length / 3 + 3 > maxVertices) flush(batch);
        for (const p of ps) { batch.positions.push(p.x, p.y, p.z); batch.colors.push(color.r, color.g, color.b); }
      }
    }
  }
  function prism(a: Point, b: Point, oa: { x: number; z: number }, ob: { x: number; z: number }, left: number, right: number, bottom: number, top: number, color: THREE.Color) {
    const point = (p: Point, o: { x: number; z: number }, side: number, y: number) => ({ x: p.x + o.x * side, y: p.y + y, z: p.z + o.z * side });
    const p = [point(a, oa, left, bottom), point(a, oa, right, bottom), point(b, ob, right, bottom), point(b, ob, left, bottom),
      point(a, oa, left, top), point(a, oa, right, top), point(b, ob, right, top), point(b, ob, left, top)];
    for (const [i, j, k, l] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
      triangle(p[i!]!, p[j!]!, p[k!]!, color); triangle(p[i!]!, p[k!]!, p[l!]!, color);
    }
  }
  for (const profile of profiles) {
    // Keep all source points in metadata; consecutive duplicates need no zero-length prism.
    const points = profile.points.filter((p, i, ps) => i === 0 || p.distance !== ps[i - 1]!.distance);
    const offsets = points.map((p, i) => {
      const prev = points[Math.max(0, i - 1)]!, next = points[Math.min(points.length - 1, i + 1)]!;
      const direction = (a: Point, b: Point) => { const l = Math.hypot(b.x - a.x, b.z - a.z); return { x: -(b.z - a.z) / l, z: (b.x - a.x) / l }; };
      const a = i === 0 ? direction(p, next) : direction(prev, p), b = i === points.length - 1 ? a : direction(p, next);
      const length = Math.hypot(a.x + b.x, a.z + b.z);
      if (length < 1e-6) return a;
      const x = (a.x + b.x) / length, z = (a.z + b.z) / length;
      const scale = Math.min(2, 1 / Math.max(0.001, x * b.x + z * b.z));
      return { x: x * scale, z: z * scale };
    });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, oa = offsets[i - 1]!, ob = offsets[i]!, half = profile.width / 2;
      prism(a, b, oa, ob, -half, half, -thickness, 0, deckColor);
      if (railHeight > 0) for (const side of [-1, 1]) {
        const edge = side * Math.max(0, half - 0.12);
        prism(a, b, oa, ob, edge - 0.06, edge + 0.06, Math.max(0, railHeight - 0.16), railHeight, railColor);
      }
    }
  }
  for (const batch of batches.values()) flush(batch);
  if (!group.children.length) material.dispose();
  return { group, sourceIds, profiles, skipped, stats };
}
