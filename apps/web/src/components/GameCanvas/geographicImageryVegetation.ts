import * as THREE from "three";
import { koriyamaGeoToLocal } from "./koriyamaGeodata";
import { imageryPixelToGeo, type ImageryTreeCandidate, type VegetationBounds, type VegetationExclusion, type VegetationPoint } from "./imageryVegetation";

export type ImageryVegetationOptions = {
  bounds: VegetationBounds;
  groundSampler: (x: number, z: number) => number | null;
  /** Supply source footprints (holes retained) and ALL original road/rail vertices.
   * Corridor half-widths are caller policy, not inferred/surveyed by this renderer. */
  exclusions: readonly VegetationExclusion[];
  tileSize?: number;
  maxInstancesPerBatch?: number;
  maxTrees?: number;
  illustrativeHeightM?: number;
  /** Default centre: crowns may legitimately overhang a road. Crown mode is conservative. */
  exclusionMode?: "centre" | "crown";
  clearanceM?: number;
  /** Only a consistency check against supplied pixel location, NOT claimed positional accuracy. */
  georeferenceToleranceM?: number;
};
export type ImageryVegetationReason = "rendered" | "invalid-candidate" | "duplicate-id" | "outside-bounds" | "excluded" | "no-ground-data" | "capacity";
export type ImageryVegetationRecord = {
  candidate: ImageryTreeCandidate;
  reason: ImageryVegetationReason;
  exclusions: { sourceId: string; kind: VegetationExclusion["kind"] }[];
  localPosition?: { x: number; y: number; z: number };
  heightM?: number;
  heightSource: "illustrative-not-measured";
};

function distanceToSegment(p: VegetationPoint, a: VegetationPoint, b: VegetationPoint) {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
function insideRing(p: VegetationPoint, ring: readonly VegetationPoint[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function intersects(p: VegetationPoint, radius: number, exclusion: VegetationExclusion) {
  const g = exclusion.geometry;
  if (g.type === "disc") return Math.hypot(p.x - g.centre.x, p.z - g.centre.z) <= radius + g.radiusM + 1e-7;
  if (g.type === "corridor") {
    for (let i = 1; i < g.points.length; i++) if (distanceToSegment(p, g.points[i - 1]!, g.points[i]!) <= g.halfWidthM + radius + 1e-7) return true;
    return false;
  }
  if (insideRing(p, g.rings[0]!) && !g.rings.slice(1).some(ring => insideRing(p, ring))) return true;
  // Outer AND hole boundaries count as contact; a crown wholly within a courtyard is allowed.
  for (const ring of g.rings) for (let i = 0; i < ring.length; i++) {
    if (distanceToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!) <= radius + 1e-7) return true;
  }
  return false;
}
function validCandidate(c: ImageryTreeCandidate, tolerance: number) {
  if (!c.id || c.positionSource !== "imagery-inferred" || !c.imagery?.manuallyInspected ||
      !Array.isArray(c.coordinates) || c.coordinates.length !== 2 || !c.coordinates.every(Number.isFinite) ||
      Math.abs(c.coordinates[0]) > 180 || Math.abs(c.coordinates[1]) > 85.051129 ||
      !Number.isFinite(c.crownRadiusM) || c.crownRadiusM <= 0 || c.crownRadiusM > 100 || !c.imagery.attribution) return false;
  try {
    if (new URL(c.imagery.url).protocol !== "https:") return false;
    const expected = koriyamaGeoToLocal(imageryPixelToGeo(c.imagery.tile, c.imagery.pixel));
    const p = koriyamaGeoToLocal(c.coordinates);
    const period = c.imagery.capturePeriod;
    if (period !== null && (!period || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(period.start) ||
        !/^\d{4}-\d{2}(?:-\d{2})?$/.test(period.end) || period.start > period.end)) return false;
    return Math.hypot(p.x - expected.x, p.z - expected.z) <= tolerance;
  } catch { return false; }
}

/** Rendering only. No imagery requests, model inference, random scattering or production wiring.
 * Retains every input candidate, including exclusions, WITHOUT moving its coordinates.
 * Ground is sampled only at accepted in-bounds centres; null/NaN never becomes zero terrain.
 * The whole decorative crown stays inside bounds; candidates crossing an edge are reported,
 * not shifted/shrunk. A tile owns centres; its culling sphere includes overhanging crowns.
 * All resources belong to group descendants. Dispose unique geometries/materials plus
 * InstancedMesh.dispose() using disposeDioramaObject; no textures are allocated.
 */
export function createGeographicImageryVegetation(candidates: readonly ImageryTreeCandidate[], options: ImageryVegetationOptions) {
  const { bounds: b } = options;
  const tileSize = options.tileSize ?? 256, batchLimit = options.maxInstancesPerBatch ?? 1024;
  const maxTrees = options.maxTrees ?? 10_000, height = options.illustrativeHeightM ?? 7;
  const clearance = options.clearanceM ?? 0, tolerance = options.georeferenceToleranceM ?? 1;
  const mode = options.exclusionMode ?? "centre";
  if (![b.minX, b.minZ, b.maxX, b.maxZ].every(Number.isFinite) || b.minX >= b.maxX || b.minZ >= b.maxZ ||
      !Number.isFinite(tileSize) || tileSize < 16 || !Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 4096 ||
      !Number.isInteger(maxTrees) || maxTrees < 0 || maxTrees > 100_000 ||
      !Number.isFinite(height) || height <= 0 || height > 100 ||
      ![clearance, tolerance].every(n => Number.isFinite(n) && n >= 0) || !["centre", "crown"].includes(mode)) throw new RangeError("Invalid imagery vegetation options");

  // Index only relevant exclusions. Huge geometries use one global entry, not an unbounded grid.
  const index = new Map<string, VegetationExclusion[]>(), global: VegetationExclusion[] = [];
  for (const e of options.exclusions) {
    const g = e.geometry, rings = g.type === "polygon" ? g.rings : g.type === "disc" ? [[g.centre]] : [g.points];
    if (!e.sourceId || !rings.length || rings.some(r => r.length < (g.type === "polygon" ? 3 : g.type === "disc" ? 1 : 2)) ||
        (g.type === "disc" && (!Number.isFinite(g.radiusM) || g.radiusM < 0)) ||
        (g.type === "corridor" && (!Number.isFinite(g.halfWidthM) || g.halfWidthM < 0))) throw new RangeError("Invalid vegetation exclusion");
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const ring of rings) for (const p of ring) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new RangeError("Invalid exclusion coordinate");
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const padding = (g.type === "corridor" ? g.halfWidthM : g.type === "disc" ? g.radiusM : 0) + clearance + (mode === "crown" ? 100 : 0);
    if (maxX + padding < b.minX || minX - padding > b.maxX || maxZ + padding < b.minZ || minZ - padding > b.maxZ) continue;
    const x0 = Math.floor(Math.max(b.minX, minX - padding) / tileSize), x1 = Math.floor(Math.min(b.maxX, maxX + padding) / tileSize);
    const z0 = Math.floor(Math.max(b.minZ, minZ - padding) / tileSize), z1 = Math.floor(Math.min(b.maxZ, maxZ + padding) / tileSize);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 256) { global.push(e); continue; }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = `${x}/${z}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push(e);
    }
  }
  const records: ImageryVegetationRecord[] = [], ids = new Map<string, number>();
  for (const c of candidates) ids.set(c.id, (ids.get(c.id) ?? 0) + 1);
  const tiles = new Map<string, ImageryVegetationRecord[]>();
  let rendered = 0;
  for (const candidate of [...candidates].sort((a, c) => a.id < c.id ? -1 : a.id > c.id ? 1 : 0)) {
    const record: ImageryVegetationRecord = { candidate, reason: "rendered", exclusions: [], heightSource: "illustrative-not-measured" };
    records.push(record);
    if (!validCandidate(candidate, tolerance)) { record.reason = "invalid-candidate"; continue; }
    if (ids.get(candidate.id)! > 1) { record.reason = "duplicate-id"; continue; }
    const p = koriyamaGeoToLocal(candidate.coordinates), r = candidate.crownRadiusM;
    if (p.x - r < b.minX || p.x + r > b.maxX || p.z - r < b.minZ || p.z + r > b.maxZ) { record.reason = "outside-bounds"; continue; }
    const key = `${Math.floor(p.x / tileSize)}/${Math.floor(p.z / tileSize)}`;
    const radius = clearance + (mode === "crown" ? r : 0);
    for (const e of [...global, ...(index.get(key) ?? [])]) if (intersects(p, radius, e)) record.exclusions.push({ sourceId: e.sourceId, kind: e.kind });
    record.exclusions.sort((a, c) => a.sourceId < c.sourceId ? -1 : a.sourceId > c.sourceId ? 1 : 0);
    if (record.exclusions.length) { record.reason = "excluded"; continue; }
    if (rendered >= maxTrees) { record.reason = "capacity"; continue; }
    const y = options.groundSampler(p.x, p.z);
    if (y === null || !Number.isFinite(y)) { record.reason = "no-ground-data"; continue; }
    record.localPosition = { ...p, y }; record.heightM = height;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key)!.push(record); rendered++;
  }
  const group = new THREE.Group(); group.name = "imagery-inferred-vegetation";
  if (rendered) {
    const trunk = new THREE.CylinderGeometry(0.15, 0.2, 1, 6), crown = new THREE.SphereGeometry(1, 8, 6);
    const bark = new THREE.MeshStandardMaterial({ color: "#79614a", roughness: 1 });
    const leaf = new THREE.MeshStandardMaterial({ color: "#528a49", roughness: 0.95 });
    const dummy = new THREE.Object3D();
    for (const [key, trees] of [...tiles].sort(([a], [c]) => a < c ? -1 : a > c ? 1 : 0)) {
      for (let start = 0; start < trees.length; start += batchLimit) {
        const chunk = trees.slice(start, start + batchLimit);
        for (const part of ["trunk", "crown"] as const) {
          const mesh = new THREE.InstancedMesh(part === "trunk" ? trunk : crown, part === "trunk" ? bark : leaf, chunk.length);
          mesh.name = `imagery-${part}/${key}/${start / batchLimit}`;
          mesh.userData = { part, tile: key, candidateIds: chunk.map(t => t.candidate.id), positionSource: "imagery-inferred", heightSource: "illustrative-not-measured" };
          chunk.forEach((record, i) => {
            const p = record.localPosition!, r = record.candidate.crownRadiusM;
            dummy.position.set(p.x, p.y + height * (part === "trunk" ? 0.25 : 0.65), p.z);
            if (part === "trunk") dummy.scale.set(Math.min(1, r / 0.2), height * 0.5, Math.min(1, r / 0.2));
            else dummy.scale.set(r, height * 0.35, r);
            dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
          });
          mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
          mesh.frustumCulled = true; mesh.castShadow = false; mesh.receiveShadow = true;
          group.add(mesh);
        }
      }
    }
  }
  const counts: Record<ImageryVegetationReason, number> = { rendered: 0, "invalid-candidate": 0, "duplicate-id": 0, "outside-bounds": 0, excluded: 0, "no-ground-data": 0, capacity: 0 };
  for (const record of records) counts[record.reason]++;
  const stats = { candidates: candidates.length, counts, tiles: tiles.size, meshes: group.children.length };
  group.userData = { records, stats, positionSource: "imagery-inferred", heightSource: "illustrative-not-measured",
    attributions: [...new Set(candidates.map(c => c.imagery?.attribution).filter(Boolean))].sort(),
    exclusionPolicy: { mode, clearanceM: clearance, corridorWidths: "caller-supplied-not-verified" },
    limitations: "Manually inspected crown centres/radii, not surveyed trunks. Heights, crown shape and color illustrative. No scatter, species inference or coordinate relocation." };
  return { group, records, stats };
}
