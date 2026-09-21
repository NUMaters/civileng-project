import * as THREE from "three";
import { koriyamaGeoToLocal } from "./koriyamaGeodata";
import { imageryPixelToGeo, type ImageryTreeCandidate, type ImageryTreeObservations, type VegetationPoint, type VegetationBounds, type VegetationExclusion } from "./imageryVegetation";
import { distanceToVegetationSegment, insideVegetationRing, intersectsVegetationExclusion } from "./geographicImageryVegetation";
import { createVegetationStyleResources, vegetationColor, vegetationHashUnit, VEGETATION_STYLE_PROVENANCE } from "./geographicVegetationStyle";

export const IMAGERY_CANOPY_URL = "/geodata/koriyama/imagery-canopy-observations.json";
type IllustrativeCanopyProfile = "riverbank-detail-v1";
const RIVERBANK_DETAIL_IDS = new Set(["riverbank-south-canopy-core", "riverbank-middle-canopy-core", "riverbank-north-canopy-core"]);
/** Artistic sampling profile, NOT a density/size measurement from the source photograph. */
const RIVERBANK_DETAIL = { spacingM: 4.5, radiusRangeM: [1.8, 2.6] as const };
function validateProfile(patch: { id: string; illustrativeProfile?: IllustrativeCanopyProfile }) {
  if (patch.illustrativeProfile !== undefined &&
      (patch.illustrativeProfile !== "riverbank-detail-v1" || !RIVERBANK_DETAIL_IDS.has(patch.id))) throw new RangeError("Invalid/out-of-scope canopy profile");
}
export type ImageryCanopyObservationView = {
  mapUrl: string;
  layer: string;
  referenceTileTopLeftScreenPx: readonly [number, number];
  displayedCapturePeriod: string;
  captureDateUncertainty: string;
  boundaryStatus: string;
  screenVerticesPx: readonly (readonly [number, number])[];
};
export type ImageryCanopyObservations = {
  schemaVersion: 1;
  source: ImageryTreeObservations["source"];
  patches: { id: string; rings: [number, number][][]; observationView?: ImageryCanopyObservationView; illustrativeProfile?: IllustrativeCanopyProfile }[];
};
export type CanopyPatch = {
  id: string;
  rings: VegetationPoint[][];
  source: ImageryCanopyObservations["source"];
  observationView?: ImageryCanopyObservationView;
  illustrativeProfile?: IllustrativeCanopyProfile;
};
export function convertImageryCanopyObservations(data: ImageryCanopyObservations): CanopyPatch[] {
  const ref = data.source?.referenceTile;
  if (data.schemaVersion !== 1 || !ref || ref.sizePixels !== 256 || !data.source.attribution || !data.source.mapUrl ||
      !Array.isArray(data.patches) || !/^\d{4}-\d{2}\/\d{4}-\d{2}$/.test(data.source.displayedCapturePeriod)) throw new RangeError("Invalid canopy source metadata");
  imageryPixelToGeo(ref, { x: 0, y: 0 });
  data.patches.forEach(validateProfile);
  return data.patches.map(patch => ({ id: patch.id, source: data.source, observationView: patch.observationView, illustrativeProfile: patch.illustrativeProfile, rings: patch.rings.map(ring => ring.map(([east, south]) => {
    if (![east, south].every(Number.isFinite)) throw new RangeError("Invalid canopy pixel");
    const dx = Math.floor(east / 256), dy = Math.floor(south / 256);
    return koriyamaGeoToLocal(imageryPixelToGeo({ z: ref.z, x: ref.x + dx, y: ref.y + dy }, { x: east - dx * 256, y: south - dy * 256 }));
  })) }));
}

/** Entire circular crown must be inside the outer ring and outside all holes, including concave edges. */
export function canopyContainsCrown(rings: readonly (readonly VegetationPoint[])[], p: VegetationPoint, radius: number) {
  if (!Number.isFinite(radius) || radius <= 0 || !rings[0]?.length || !insideVegetationRing(p, rings[0]) || rings.slice(1).some(r => insideVegetationRing(p, r))) return false;
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    if (distanceToVegetationSegment(p, ring[i]!, ring[(i + 1) % ring.length]!) <= radius + 1e-6) return false;
  }
  return true;
}
function boundsOf(rings: readonly (readonly VegetationPoint[])[]): VegetationBounds {
  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const ring of rings) for (const p of ring) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new RangeError("Invalid canopy/exclusion coordinate");
    b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x); b.minZ = Math.min(b.minZ, p.z); b.maxZ = Math.max(b.maxZ, p.z);
  }
  return b;
}
function overlaps(a: VegetationBounds, b: VegetationBounds) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}
export type CanopyOptions = {
  bounds: VegetationBounds;
  groundSampler: (x: number, z: number) => number | null;
  exclusions: readonly VegetationExclusion[];
  /** ALL explicitly observed candidates, including the ones withheld by the individual renderer. */
  observedCrowns: readonly ImageryTreeCandidate[];
  /** Explicit options override patch profiles (useful for controlled baseline comparisons). */
  spacingM?: number;
  radiusRangeM?: readonly [number, number];
  heightRangeM?: readonly [number, number];
  maxCells?: number;
  maxTrees?: number;
  tileSize?: number;
  maxInstancesPerBatch?: number;
};
type Reason = "rendered" | "boundary" | "excluded" | "explicit-crown" | "reconstruction-overlap" | "no-ground-data" | "capacity";
export type CanopyRecord = {
  id: string; patchId: string; x: number; z: number; radiusM: number; heightM: number; y?: number;
  reason: Reason; exclusionIds: string[]; positionSource: "illustrative-within-imagery-envelope";
};

/** Bounded single-pass jittered lattice INSIDE supplied envelopes only. No rejection/retry loop,
 * no filling arbitrary parks, no relocation, and no claim that internal centres are observed trees.
 * Density, radii and heights are explicitly illustrative; source buildings/roads remain untouched.
 * Full crowns clear source exclusions, all explicit observations and previously accepted crowns.
 */
export function createGeographicCanopy(patches: readonly CanopyPatch[], options: CanopyOptions) {
  const { bounds: b } = options, spacing = options.spacingM ?? 6;
  const radii = options.radiusRangeM ?? [2.3, 3.5], heights = options.heightRangeM ?? [6, 9];
  const maxCells = options.maxCells ?? 8192, maxTrees = options.maxTrees ?? 1500;
  const tileSize = options.tileSize ?? 256, batchSize = options.maxInstancesPerBatch ?? 512;
  if (!Object.values(b).every(Number.isFinite) || b.minX >= b.maxX || b.minZ >= b.maxZ ||
      !Number.isFinite(spacing) || spacing < 2 || !Number.isFinite(tileSize) || tileSize < 16 ||
      !Number.isInteger(maxCells) || maxCells < 1 || maxCells > 20000 ||
      !Number.isInteger(maxTrees) || maxTrees < 0 || maxTrees > 5000 ||
      !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 4096 ||
      ![...radii, ...heights].every(v => Number.isFinite(v) && v > 0 && v <= 30) || radii[0] > radii[1] || heights[0] > heights[1]) throw new RangeError("Invalid canopy limits");
  const seen = new Set<string>();
  for (const patch of patches) {
    validateProfile(patch);
    if (!patch.id || seen.has(patch.id) || !patch.rings.length || patch.rings.some(r => r.length < 3 || r.length > 512)) throw new RangeError("Invalid/duplicate canopy patch");
    boundsOf(patch.rings); seen.add(patch.id);
  }
  const indexed = options.exclusions.map(e => {
    const g = e.geometry, bb = boundsOf(g.type === "polygon" ? g.rings : g.type === "corridor" ? [g.points] : [[g.centre]]);
    const pad = g.type === "corridor" ? g.halfWidthM : g.type === "disc" ? g.radiusM : 0;
    if (!Number.isFinite(pad) || pad < 0 || !Object.values(bb).every(Number.isFinite)) throw new RangeError("Invalid canopy exclusion");
    return { e, bounds: { minX: bb.minX - pad, maxX: bb.maxX + pad, minZ: bb.minZ - pad, maxZ: bb.maxZ + pad } };
  });
  const explicit = options.observedCrowns.map(c => {
    const p = koriyamaGeoToLocal(c.coordinates);
    if (![p.x, p.z, c.crownRadiusM].every(Number.isFinite) || c.crownRadiusM <= 0) throw new RangeError("Invalid explicit crown exclusion");
    return { p, radius: c.crownRadiusM, id: c.id };
  });
  const records: CanopyRecord[] = [], accepted: CanopyRecord[] = [];
  const skippedPatches: { id: string; reason: "outside-bounds" | "cell-budget" }[] = [];
  let evaluatedCells = 0;
  for (const patch of [...patches].sort((a, c) => a.id < c.id ? -1 : a.id > c.id ? 1 : 0)) {
    const profile = patch.illustrativeProfile === "riverbank-detail-v1" ? RIVERBANK_DETAIL : undefined;
    const patchSpacing = options.spacingM ?? profile?.spacingM ?? spacing;
    const patchRadii = options.radiusRangeM ?? profile?.radiusRangeM ?? radii;
    const pb = boundsOf(patch.rings);
    if (!overlaps(pb, b)) { skippedPatches.push({ id: patch.id, reason: "outside-bounds" }); continue; }
    const x0 = Math.floor(Math.max(pb.minX, b.minX) / patchSpacing), x1 = Math.ceil(Math.min(pb.maxX, b.maxX) / patchSpacing);
    const z0 = Math.floor(Math.max(pb.minZ, b.minZ) / patchSpacing), z1 = Math.ceil(Math.min(pb.maxZ, b.maxZ) / patchSpacing);
    const cells = (x1 - x0) * (z1 - z0);
    if (!Number.isSafeInteger(cells) || cells > maxCells - evaluatedCells) { skippedPatches.push({ id: patch.id, reason: "cell-budget" }); continue; }
    const obstacles = indexed.filter(entry => overlaps(pb, entry.bounds));
    for (let iz = z0; iz < z1; iz++) for (let ix = x0; ix < x1; ix++) {
      evaluatedCells++;
      const id = `${patch.id}/${ix}/${iz}`;
      const x = (ix + .5 + (vegetationHashUnit(`${id}/x`) - .5) * .3) * patchSpacing;
      const z = (iz + .5 + (vegetationHashUnit(`${id}/z`) - .5) * .3) * patchSpacing;
      const radius = patchRadii[0] + (patchRadii[1] - patchRadii[0]) * vegetationHashUnit(`${id}/radius`);
      const height = heights[0] + (heights[1] - heights[0]) * vegetationHashUnit(`${id}/height`);
      const r: CanopyRecord = { id, patchId: patch.id, x, z, radiusM: radius, heightM: height, reason: "rendered", exclusionIds: [], positionSource: "illustrative-within-imagery-envelope" };
      records.push(r);
      if (x - radius < b.minX || x + radius > b.maxX || z - radius < b.minZ || z + radius > b.maxZ || !canopyContainsCrown(patch.rings, r, radius)) { r.reason = "boundary"; continue; }
      for (const c of explicit) if (Math.hypot(x - c.p.x, z - c.p.z) <= radius + c.radius) r.exclusionIds.push(c.id);
      if (r.exclusionIds.length) { r.reason = "explicit-crown"; continue; }
      const crownBounds = { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius };
      for (const entry of obstacles) if (overlaps(crownBounds, entry.bounds) && intersectsVegetationExclusion(r, radius, entry.e)) r.exclusionIds.push(entry.e.sourceId);
      if (r.exclusionIds.length) { r.reason = "excluded"; continue; }
      if (accepted.some(a => Math.hypot(x - a.x, z - a.z) <= radius + a.radiusM)) { r.reason = "reconstruction-overlap"; continue; }
      if (accepted.length >= maxTrees) { r.reason = "capacity"; continue; }
      // Check the centre AND crown-edge ground. No invented support across DEM gaps.
      const base = options.groundSampler(x, z);
      let valid = base !== null && Number.isFinite(base);
      for (let i = 0; i < 8 && valid; i++) {
        const y = options.groundSampler(x + radius * Math.cos(i * Math.PI / 4), z + radius * Math.sin(i * Math.PI / 4));
        if (y === null || !Number.isFinite(y)) valid = false;
      }
      if (!valid) { r.reason = "no-ground-data"; continue; }
      r.y = base!; accepted.push(r);
    }
  }
  const group = new THREE.Group(); group.name = "imagery-envelope-canopy-reconstruction";
  const tiles = new Map<string, CanopyRecord[]>();
  for (const r of accepted) {
    const key = `${Math.floor(r.x / tileSize)}/${Math.floor(r.z / tileSize)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key)!.push(r);
  }
  if (accepted.length) {
    const style = createVegetationStyleResources(), dummy = new THREE.Object3D();
    for (const [key, trees] of tiles) for (let start = 0; start < trees.length; start += batchSize) {
      const chunk = trees.slice(start, start + batchSize);
      for (const part of ["trunk", "crown"] as const) {
        const mesh = new THREE.InstancedMesh(style[part], part === "trunk" ? style.bark : style.leaf, chunk.length);
        mesh.name = `reconstructed-canopy-${part}/${key}/${start / batchSize}`;
        mesh.userData = { part, tile: key, reconstructionIds: chunk.map(r => r.id), positionSource: "illustrative-within-imagery-envelope" };
        chunk.forEach((r, i) => {
          dummy.position.set(r.x, r.y! + r.heightM * (part === "trunk" ? .25 : .65), r.z);
          const horizontalScale = part === "trunk" ? Math.min(1, r.radiusM / .2) : r.radiusM;
          dummy.scale.set(horizontalScale, r.heightM * (part === "trunk" ? .5 : .35), horizontalScale);
          dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
          if (part === "crown") mesh.setColorAt(i, vegetationColor(r.id));
        });
        mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingBox(); mesh.computeBoundingSphere(); mesh.frustumCulled = true;
        mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh);
      }
    }
  }
  const counts: Record<Reason, number> = { rendered: 0, boundary: 0, excluded: 0, "explicit-crown": 0, "reconstruction-overlap": 0, "no-ground-data": 0, capacity: 0 };
  for (const r of records) counts[r.reason]++;
  const stats = { patches: patches.length, evaluatedCells, counts, skippedPatches, tiles: tiles.size, meshes: group.children.length };
  group.userData = { records, stats, patches, style: VEGETATION_STYLE_PROVENANCE,
    positionSource: "illustrative-within-imagery-envelope", dimensionsSource: "illustrative-not-measured",
    policy: { spacingM: spacing, radiusRangeM: radii, heightRangeM: heights, maxCells, maxTrees, seed: "patch-id-world-grid-fnv1a-v1",
      patchProfiles: patches.filter(p => p.illustrativeProfile).map(p => ({ id: p.id, profile: p.illustrativeProfile,
        spacingM: options.spacingM ?? RIVERBANK_DETAIL.spacingM, radiusRangeM: options.radiusRangeM ?? RIVERBANK_DETAIL.radiusRangeM })) },
    attributions: [...new Set(patches.map(p => p.source.attribution))],
    limitations: "Only envelopes observed in imagery; internal centres/counts/density/radii/heights reconstructed, not individual observations. Capture period is a view label, not verified per-patch acquisition metadata. No placement beyond supplied envelopes." };
  return { group, records, stats };
}
