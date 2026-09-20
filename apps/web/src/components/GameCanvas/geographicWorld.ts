import * as THREE from "three";
import { createGeographicBuildingMaterial, BUILDING_DECORATION_PROVENANCE } from "./geographicBuildingMaterial";
import { groundY } from "./dioramaSpace";
import {
  koriyamaGeoToLocal,
  taggedHeightMeters,
  isGeodataBridge,
  KORIYAMA_ATTRIBUTION,
  type GeoPoint,
  type GeodataFeature,
  type KoriyamaGeodata,
  type LocalPoint,
} from "./koriyamaGeodata";
import { KORIYAMA_PLATEAU_ATTRIBUTION, type KoriyamaPlateauGeodata, type PlateauBuilding } from "./koriyamaPlateauGeodata";

export type GeographicFeature = GeodataFeature | PlateauBuilding;

/** The provider must identify its evidence; supplying a number alone is not provenance. */
export type GeographicBuildingHeight = {
  meters: number;
  source: string;
  estimated?: boolean;
  sourceId?: string;
  method?: string;
};
export type GeographicWorldOptions = {
  /** Decorative classification colors only; does not change source geometry. */
  polygonSurfaceColor?: (feature: GeographicFeature) => string | undefined;
  plateau?: KoriyamaPlateauGeodata;
  /** Local metres, inclusive. Clip before any elevation sampling. */
  localBounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Optional global X/Z grid spacing in metres, for draping and detecting interior DEM gaps. */
  surfaceGridSpacing?: number;
  /** Building base sampler only; default groundY is synthetic, not surveyed elevation. */
  groundSampler?: (x: number, z: number) => number | null;
  /** Absolute surface Y at each polygon/ribbon vertex. Caller owns consistency with its terrain. */
  surfaceSampler?: (x: number, z: number, layer: GeographicSurfaceLayer, feature: GeographicFeature) => number | null;
  tileSize?: number;
  maxBatchVertices?: number;
  buildingHeightProvider?: (feature: GeographicFeature) => GeographicBuildingHeight | null | undefined;
  /** Uniform visual fallback only. Set to zero to show unknown buildings as footprints. */
  provisionalBuildingHeight?: number;
};
export type GeographicWorldStats = {
  buildings: number;
  unknownHeights: number;
  estimatedHeights: number;
  sourceHeights: number;
  heightSources: Record<string, number>;
  tiles: number;
  batches: number;
  vertices: number;
  peakBufferedVertices: number;
  suppressedOsmBuildings: number;
  plateauModelHeights: number;
  excludedByBounds: number;
  skippedNoDataBuildings: number;
  skippedNoDataTriangles: number;
};
export type GeographicWorld = THREE.Group & {
  /** World-space positions; no transform required for the river shader. Owned by group meshes. */
  waterGeometries: THREE.BufferGeometry[];
  waterMeshes: THREE.Mesh[];
  stats: GeographicWorldStats;
};
type Layer = "building" | "campus" | "water" | "waterway" | "road" | "rail" | "bridge-road" | "bridge-rail";
export type GeographicSurfaceLayer = Exclude<Layer, "building">;
type Buffer = { layer: Layer; tx: number; tz: number; positions: number[]; normals: number[]; colors: number[]; uvs: number[]; riverStageEligible: boolean; sourceIds: Set<string> };
type Point = LocalPoint & { u?: number; v?: number };
const COLORS = ["#528dce", "#718da9", "#cf7857", "#68a7cf", "#df9369"].map((c) => new THREE.Color(c));
const WALL_COLOR = new THREE.Color("#f6e8c9");
const SURFACE_COLORS: Record<Exclude<Layer, "building">, THREE.Color> = {
  campus: new THREE.Color("#9bd675"), water: new THREE.Color("#4dbada"),
  waterway: new THREE.Color("#4dbada"), road: new THREE.Color("#ded0af"),
  rail: new THREE.Color("#656b87"), "bridge-road": new THREE.Color("#f0b677"),
  "bridge-rail": new THREE.Color("#858bb0"),
};
const BUFFER_BUDGET = 65_536;
// groundY is a synthetic valley in [0,9], NOT a DEM. Surface lifts are visual assumptions.
const SURFACE_Y = { campus: 9.04, water: 9.10, waterway: 9.10, road: 9.22, rail: 9.27, "bridge-road": 9.65, "bridge-rail": 9.70 };
const validHeight = (h: number) => Number.isFinite(h) && h > 0;
const validElevation = (h: number | null): h is number => h !== null && Number.isFinite(h);

function lineWidth(feature: GeographicFeature) {
  const raw = isOsmFeature(feature) ? feature.properties.width : undefined;
  const tagged = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?(?:\s*m)?$/.test(raw) ? Number.parseFloat(raw) : NaN;
  return validHeight(tagged) ? tagged : feature.properties.kind === "road" ? 5 : feature.properties.kind === "rail" ? 2 : 3;
}

function inLocalBounds(feature: GeographicFeature, bounds: NonNullable<GeographicWorldOptions["localBounds"]>) {
  const geoBounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const lines = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates.flatMap((p) => p.slice(0, 1)) : feature.geometry.coordinates;
  for (const line of lines) for (const p of line) {
    geoBounds[0] = Math.min(geoBounds[0], p[0]); geoBounds[1] = Math.min(geoBounds[1], p[1]);
    geoBounds[2] = Math.max(geoBounds[2], p[0]); geoBounds[3] = Math.max(geoBounds[3], p[1]);
  }
  const a = koriyamaGeoToLocal([geoBounds[0], geoBounds[3]]), b = koriyamaGeoToLocal([geoBounds[2], geoBounds[1]]);
  const pad = feature.geometry.type === "MultiLineString" ? lineWidth(feature) / 2 : 0;
  return b.x + pad >= bounds.minX && a.x - pad <= bounds.maxX && b.z + pad >= bounds.minZ && a.z - pad <= bounds.maxZ;
}

function isOsmFeature(feature: GeographicFeature): feature is GeodataFeature {
  return "version" in feature.properties;
}

/** Bundled OSM identity, not a proximity/width guess or a surveyed river boundary.
 * The unnamed relation contains the named Abukuma centerlines; the other bundled
 * river polygons belong to Sasahara/Yata. Re-audit this ID when refreshing assets.
 */
export function isAbukumaWater(feature: GeographicFeature): boolean {
  if (!isOsmFeature(feature)) return false;
  const p = feature.properties;
  const named = p["name:ja"] === "阿武隈川" || p.name === "阿武隈川";
  return (p.kind === "water" && p.water === "river" && feature.geometry.type === "MultiPolygon" &&
    (feature.id === "relation/18504988" || named)) ||
    (p.kind === "waterway" && p.waterway === "river" && feature.geometry.type === "MultiLineString" && named);
}

function buildingHeight(feature: GeographicFeature, options: GeographicWorldOptions) {
  const metadata = !isOsmFeature(feature) ? {
    measuredHeightMeters: feature.properties.heightMeters,
    measuredHeightSource: feature.properties.heightSource,
    modelHeightMeters: feature.properties.modelHeightMeters,
    datasetYear: feature.properties.datasetYear,
    sourceId: feature.id,
  } : {};
  const override = options.buildingHeightProvider?.(feature);
  if (override && validHeight(override.meters) && override.source !== "unknown" && override.source.trim()) return { ...metadata, ...override, unknown: false };
  if (!isOsmFeature(feature) && validHeight(feature.properties.modelHeightMeters)) {
    return { ...metadata, meters: feature.properties.modelHeightMeters, source: feature.properties.modelHeightSource,
      method: feature.properties.modelHeightMethod, unknown: false, estimated: false };
  }
  // Metadata supplied by the adapter can carry PLATEAU height without losing its source/method.
  const p = feature.properties;
  if (typeof p.heightMeters === "number" && validHeight(p.heightMeters) &&
      typeof p.heightSource === "string" && p.heightSource !== "unknown" && p.heightSource.trim()) {
    return { ...metadata, meters: p.heightMeters, source: p.heightSource, unknown: false,
      estimated: /estimated|provisional/.test(p.heightSource), sourceId: feature.id,
      method: typeof p.heightMethod === "string" ? p.heightMethod : undefined };
  }
  const tagged = isOsmFeature(feature) ? taggedHeightMeters(feature) : null;
  if (tagged !== null) return { meters: tagged, source: "osm-height-tag-unverified", unknown: false, estimated: false };
  const meters = options.provisionalBuildingHeight ?? 6;
  return { ...metadata, meters, source: meters > 0 ? "provisional-uniform-height" : "unknown-footprint-only", unknown: true, estimated: meters > 0 };
}

type Bounds = [number, number, number, number];
function footprintBounds(polygons: GeoPoint[][][]): Bounds {
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) for (const p of polygon[0] ?? []) {
    bounds[0] = Math.min(bounds[0], p[0]); bounds[1] = Math.min(bounds[1], p[1]);
    bounds[2] = Math.max(bounds[2], p[0]); bounds[3] = Math.max(bounds[3], p[1]);
  }
  return bounds;
}
const intersectsBounds = (a: Bounds, b: Bounds) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
function insideRing(p: GeoPoint, ring: GeoPoint[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const insidePolygon = (p: GeoPoint, polygon: GeoPoint[][]) => insideRing(p, polygon[0]!) && !polygon.slice(1).some((ring) => insideRing(p, ring));
function segmentsTouch(a: GeoPoint, b: GeoPoint, c: GeoPoint, d: GeoPoint) {
  const cross = (p: GeoPoint, q: GeoPoint, r: GeoPoint) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
      Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) return false;
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}
function footprintsTouch(a: GeoPoint[][][], b: GeoPoint[][][]) {
  for (const pa of a) for (const pb of b) {
    if (!pa[0]?.length || !pb[0]?.length) continue;
    if (pa[0].some((p) => insidePolygon(p, pb)) || pb[0].some((p) => insidePolygon(p, pa))) return true;
    for (const ra of pa) for (const rb of pb) for (let i = 1; i < ra.length; i++) for (let j = 1; j < rb.length; j++) {
      if (segmentsTouch(ra[i - 1]!, ra[i]!, rb[j - 1]!, rb[j]!)) return true;
    }
  }
  return false;
}

/** Spatial candidates followed by actual ring intersection, including holes. */
function combineBuildings(data: KoriyamaGeodata | KoriyamaPlateauGeodata, plateau?: KoriyamaPlateauGeodata) {
  const suppressed: string[] = [];
  if (!plateau) return { features: data.features as GeographicFeature[], suppressed };
  const index = new Map<string, { feature: PlateauBuilding; bounds: Bounds }[]>();
  function keys(bounds: Bounds) {
    const keys: string[] = [];
    for (let x = Math.floor(bounds[0] * 1000); x <= Math.floor(bounds[2] * 1000); x++) {
      for (let z = Math.floor(bounds[1] * 1000); z <= Math.floor(bounds[3] * 1000); z++) keys.push(`${x}/${z}`);
    }
    return keys;
  }
  for (const feature of plateau.features) {
    const entry = { feature, bounds: footprintBounds(feature.geometry.coordinates) };
    for (const key of keys(entry.bounds)) {
      const bucket = index.get(key) ?? []; bucket.push(entry); index.set(key, bucket);
    }
  }
  const features: GeographicFeature[] = [];
  const plateauIds = new Set(plateau.features.map((f) => f.id));
  for (const feature of data.features) {
    if (plateauIds.has(feature.id)) continue;
    let overlaps = false;
    if (isOsmFeature(feature) && feature.properties.kind === "building" && feature.geometry.type === "MultiPolygon") {
      const bounds = footprintBounds(feature.geometry.coordinates);
      const checked = new Set<string>();
      for (const key of keys(bounds)) {
        for (const entry of index.get(key) ?? []) {
          if (checked.has(entry.feature.id)) continue;
          checked.add(entry.feature.id);
          if (intersectsBounds(bounds, entry.bounds) && footprintsTouch(feature.geometry.coordinates, entry.feature.geometry.coordinates)) { overlaps = true; break; }
        }
        if (overlaps) break;
      }
    }
    if (overlaps) suppressed.push(feature.id); else features.push(feature);
  }
  features.push(...plateau.features);
  return { features, suppressed };
}

/** Sutherland-Hodgman clipping of a triangle preserves holes already cut by triangulation. */
function clip(points: Point[], axis: "x" | "z", boundary: number, keepAbove: boolean): Point[] {
  const result: Point[] = [];
  let a = points.at(-1)!;
  if (!a) return result;
  let insideA = keepAbove ? a[axis] >= boundary : a[axis] <= boundary;
  for (const b of points) {
    const insideB = keepAbove ? b[axis] >= boundary : b[axis] <= boundary;
    if (insideA !== insideB) {
      const t = (boundary - a[axis]) / (b[axis] - a[axis]);
      const point: Point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      if (a.u !== undefined && b.u !== undefined) point.u = a.u + (b.u - a.u) * t;
      if (a.v !== undefined && b.v !== undefined) point.v = a.v + (b.v - a.v) * t;
      point[axis] = boundary;
      result.push(point);
    }
    if (insideB) result.push(b);
    a = b; insideA = insideB;
  }
  return result;
}

/**
 * Rendering only: source X/Z, polygon holes and line vertices are never procedurally relocated.
 * Returns a Group directly, with waterMeshes/waterGeometries for the caller's river material.
 * All geometry/materials belong to descendants; the existing disposeObject traversal is sufficient.
 * Absolute elevations, road widths, bridge clearance and fallback heights are NOT measured data.
 * Default surface Y is 9.04 campus, 9.10 water, 9.22 road, 9.27 rail, 9.65/9.70 bridges,
 * above the existing synthetic groundY range [0,9]. Override BOTH samplers when replacing terrain.
 * For water at 0.4, supply surfaceSampler returning 0.4 for water/waterway, and matching terrain.
 * Render these waterMeshes instead of the old procedural river ribbon, never alongside it.
 * PLATEAU extrusion uses modelHeightMeters (LOD1 Z extent); measuredHeight stays separate metadata.
 * localBounds is applied before samplers. A clipped building retains its source walls only (open cut).
 * With surfaceGridSpacing, surfaces and building support checks use a global X/Z grid; rendered
 * heights are sampled at grid intersections, not interpolated from the original sparse ring alone.
 * No-data detection is discrete (vertices and centroids), not a proof of continuous DEM coverage.
 */
export function createGeographicWorld(data: KoriyamaGeodata | KoriyamaPlateauGeodata, options: GeographicWorldOptions = {}): GeographicWorld {
  const tileSize = options.tileSize ?? 512;
  const maxVertices = options.maxBatchVertices ?? 32_766;
  const bounds = options.localBounds;
  const spacing = options.surfaceGridSpacing;
  if ((bounds && (!Object.values(bounds).every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ)) ||
      (spacing !== undefined && (!Number.isFinite(spacing) || spacing < 0.25))) throw new RangeError("Invalid local bounds or surface grid spacing (minimum 0.25m)");
  if (!Number.isFinite(tileSize) || tileSize < 16 || !Number.isInteger(maxVertices) || maxVertices < 3 || maxVertices > BUFFER_BUDGET ||
      (options.provisionalBuildingHeight !== undefined && (!Number.isFinite(options.provisionalBuildingHeight) || options.provisionalBuildingHeight < 0))) {
    throw new RangeError("Invalid geographic tile, batch or provisional-height limits");
  }
  const group = new THREE.Group() as GeographicWorld;
  group.name = "geographic-world";
  group.waterGeometries = []; group.waterMeshes = [];
  const stats: GeographicWorldStats = { buildings: 0, unknownHeights: 0, estimatedHeights: 0, sourceHeights: 0,
    heightSources: {}, tiles: 0, batches: 0, vertices: 0, peakBufferedVertices: 0,
    suppressedOsmBuildings: 0, plateauModelHeights: 0, excludedByBounds: 0, skippedNoDataBuildings: 0, skippedNoDataTriangles: 0 };
  group.stats = stats;
  const heightRecords: Record<string, ReturnType<typeof buildingHeight>> = {};
  const bridgeRecords: { id: string; kind: string; bridge: unknown; layer: unknown }[] = [];
  function bounded<T extends KoriyamaGeodata | KoriyamaPlateauGeodata>(collection: T): T {
    if (!bounds) return collection;
    const features = collection.features.filter((feature) => inLocalBounds(feature, bounds));
    stats.excludedByBounds += collection.features.length - features.length;
    return { ...collection, features } as T;
  }
  const combined = combineBuildings(bounded(data), options.plateau ? bounded(options.plateau) : undefined);
  stats.suppressedOsmBuildings = combined.suppressed.length;
  const sampleGround = options.groundSampler ?? groundY;
  const sampleSurface = options.surfaceSampler ?? ((_x: number, _z: number, layer: GeographicSurfaceLayer) => SURFACE_Y[layer]);
  group.userData = {
    buildingDecoration: BUILDING_DECORATION_PROVENANCE,
    attributions: [KORIYAMA_ATTRIBUTION, KORIYAMA_PLATEAU_ATTRIBUTION],
    suppressedOsmBuildingIds: combined.suppressed,
    buildingDeduplication: "OSM footprint intersects or touches PLATEAU footprint; PLATEAU preferred; not an identity match",
    groundSource: options.groundSampler ? "caller-provided-ground-sampler" : "groundY-synthetic-not-DEM",
    surfaceSource: options.surfaceSampler ? "caller-provided-surface-sampler" : "synthetic-surface-datum-9m",
    localBounds: bounds ?? null, surfaceGridSpacing: spacing ?? null,
    noDataPolicy: "Clip before sampling. Null/nonfinite ground skips entire building or surface triangle; no elevation fallback. Vertices and triangle centroids checked; use DEM-cell-scale grid spacing to resolve interior gaps.",
    heightSemantics: "PLATEAU 2020 extrusion=modelHeightMeters/LOD1 Z bounds; measuredHeightMeters stored separately; no DEM or bridge/rail elevations",
    coordinateSystem: "Koriyama origin 140.3837,37.3655; metres; east +X, north -Z",
    assumptions: [options.groundSampler ? "building-base-on-caller-ground-sampler" : "groundY-synthetic-not-DEM",
      options.surfaceSampler ? "surface-elevation-from-caller-sampler" : "surface-datum-above-synthetic-ground-9m-not-elevation", "bridge-deck-height-provisional-not-measured",
      "untagged-road-rail-waterway-widths-stylized", "unknown-building-height-provisional-unless-disabled",
      "OSM-height-tags-unverified", "PLATEAU-height-is-source-representative-height-not-exact-current-roof"],
    buildingHeights: heightRecords, bridges: bridgeRecords, stats, tileSize, maxBatchVertices: maxVertices,
  };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, side: THREE.DoubleSide });
  const buildingMaterial = createGeographicBuildingMaterial();
  const waterMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, side: THREE.DoubleSide });
  const buffers = new Map<string, Buffer>();
  const tiles = new Set<string>();
  let buffered = 0;
  function flush(buffer: Buffer) {
    const count = buffer.positions.length / 3;
    if (!count) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffer.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffer.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffer.colors, 3));
    if (buffer.layer === "building") geometry.setAttribute("facadeUv", new THREE.Float32BufferAttribute(buffer.uvs, 2));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const water = buffer.layer === "water" || buffer.layer === "waterway";
    const mesh = new THREE.Mesh(geometry, water ? waterMaterial : buffer.layer === "building" ? buildingMaterial : material);
    mesh.name = `geographic-${buffer.layer}/${buffer.tx}/${buffer.tz}/${stats.batches}`;
    mesh.userData = { layer: buffer.layer, tile: [buffer.tx, buffer.tz], tileSize,
      riverStageEligible: buffer.riverStageEligible, sourceIds: [...buffer.sourceIds],
      bridge: buffer.layer.startsWith("bridge-"), elevationSource: buffer.layer === "building" ? group.userData.groundSource : group.userData.surfaceSource };
    mesh.frustumCulled = true;
    mesh.receiveShadow = !water; mesh.castShadow = buffer.layer === "building";
    group.add(mesh);
    if (water) { group.waterGeometries.push(geometry); group.waterMeshes.push(mesh); }
    stats.batches++; stats.vertices += count; buffered -= count;
    buffer.positions = []; buffer.normals = []; buffer.colors = []; buffer.uvs = [];
    buffer.sourceIds.clear();
  }
  function emit(buffer: Buffer, a: Point, b: Point, c: Point, color: THREE.Color, sourceId?: string) {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-10) return;
    if (buffer.positions.length / 3 + 3 > maxVertices) flush(buffer);
    if (buffered + 3 > BUFFER_BUDGET) {
      let largest = buffer;
      for (const candidate of buffers.values()) if (candidate.positions.length > largest.positions.length) largest = candidate;
      flush(largest);
    }
    if (sourceId) buffer.sourceIds.add(sourceId);
    for (const p of [a, b, c]) {
      buffer.positions.push(p.x, p.y, p.z);
      buffer.normals.push(nx / length, ny / length, nz / length);
      buffer.colors.push(color.r, color.g, color.b);
      if (buffer.layer === "building") buffer.uvs.push(p.u ?? 0, p.v ?? 0);
    }
    buffered += 3; stats.peakBufferedVertices = Math.max(stats.peakBufferedVertices, buffered);
  }
  function boundedPolygon(points: Point[]) {
    if (!bounds) return points;
    let result = clip(points, "x", bounds.minX, true);
    result = clip(result, "x", bounds.maxX, false);
    result = clip(result, "z", bounds.minZ, true);
    return clip(result, "z", bounds.maxZ, false);
  }
  function tileTriangle(layer: Layer, a: Point, b: Point, c: Point, color: THREE.Color, feature?: GeographicFeature) {
    const minX = Math.floor(Math.min(a.x, b.x, c.x) / tileSize), maxX = Math.floor(Math.max(a.x, b.x, c.x) / tileSize);
    const minZ = Math.floor(Math.min(a.z, b.z, c.z) / tileSize), maxZ = Math.floor(Math.max(a.z, b.z, c.z) / tileSize);
    for (let tx = minX; tx <= maxX; tx++) for (let tz = minZ; tz <= maxZ; tz++) {
      let polygon = [a, b, c];
      if (minX !== maxX || minZ !== maxZ) {
        polygon = clip(polygon, "x", tx * tileSize, true);
        polygon = clip(polygon, "x", (tx + 1) * tileSize, false);
        polygon = clip(polygon, "z", tz * tileSize, true);
        polygon = clip(polygon, "z", (tz + 1) * tileSize, false);
      }
      if (polygon.length < 3) continue;
      const riverStageEligible = feature !== undefined && isAbukumaWater(feature);
      const key = `${layer}/${tx}/${tz}/${riverStageEligible ? "abukuma" : "static"}`;
      let buffer = buffers.get(key);
      if (!buffer) {
        buffer = { layer, tx, tz, positions: [], normals: [], colors: [], uvs: [], riverStageEligible, sourceIds: new Set() };
        buffers.set(key, buffer); tiles.add(`${tx}/${tz}`);
      }
      for (let i = 1; i < polygon.length - 1; i++) emit(buffer, polygon[0]!, polygon[i]!, polygon[i + 1]!, color, feature?.id);
    }
  }
  function triangle(layer: Layer, a: Point, b: Point, c: Point, color: THREE.Color) {
    const points = boundedPolygon([a, b, c]);
    for (let i = 1; i < points.length - 1; i++) tileTriangle(layer, points[0]!, points[i]!, points[i + 1]!, color);
  }
  function planarTriangles(a: Point, b: Point, c: Point, visit: (a: Point, b: Point, c: Point) => void) {
    const polygon = boundedPolygon([a, b, c]);
    if (polygon.length < 3) return;
    function fan(points: Point[]) {
      for (let i = 1; i < points.length - 1; i++) {
        const a = points[0]!, b = points[i]!, c = points[i + 1]!;
        if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) > 1e-10) visit(a, b, c);
      }
    }
    if (!spacing) { fan(polygon); return; }
    const minX = Math.floor(Math.min(...polygon.map((p) => p.x)) / spacing), maxX = Math.floor(Math.max(...polygon.map((p) => p.x)) / spacing);
    const minZ = Math.floor(Math.min(...polygon.map((p) => p.z)) / spacing), maxZ = Math.floor(Math.max(...polygon.map((p) => p.z)) / spacing);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      let cell = clip(polygon, "x", x * spacing, true);
      cell = clip(cell, "x", (x + 1) * spacing, false);
      cell = clip(cell, "z", z * spacing, true);
      fan(clip(cell, "z", (z + 1) * spacing, false));
    }
  }
  const centroid = (a: Point, b: Point, c: Point): Point => ({ x: (a.x + b.x + c.x) / 3, y: 0, z: (a.z + b.z + c.z) / 3 });
  function surfaceTriangle(layer: GeographicSurfaceLayer, a: Point, b: Point, c: Point, color: THREE.Color, feature: GeographicFeature) {
    planarTriangles(a, b, c, (a, b, c) => {
      const points = [a, b, c, centroid(a, b, c)];
      const ys = points.map((p) => sampleSurface(p.x, p.z, layer, feature));
      if (ys.some((y) => !validElevation(y)) || (options.groundSampler && points.some((p) => !validElevation(sampleGround(p.x, p.z))))) {
        stats.skippedNoDataTriangles++; return;
      }
      tileTriangle(layer, { ...a, y: ys[0] as number }, { ...b, y: ys[1] as number }, { ...c, y: ys[2] as number }, color, feature);
    });
  }
  // Order references only, never clone all geographic coordinates or allocate a mesh per feature.
  // Spatial locality avoids repeatedly flushing small batches when source IDs are geographically mixed.
  const ordered = combined.features.map((feature) => {
    const first = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates[0]?.[0]?.[0] : feature.geometry.coordinates[0]?.[0];
    const p = first ? koriyamaGeoToLocal(first) : { x: 0, z: 0 };
    return { feature, tx: Math.floor(p.x / tileSize), tz: Math.floor(p.z / tileSize) };
  }).sort((a, b) => a.tx - b.tx || a.tz - b.tz);
  for (const { feature } of ordered) {
    const kind = feature.properties.kind;
    if (feature.geometry.type === "MultiPolygon") {
      if (kind !== "building" && kind !== "campus" && kind !== "water") continue;
      const height = kind === "building" ? buildingHeight(feature, options) : null;
      let hash = 0;
      for (let i = 0; i < feature.id.length; i++) hash = (Math.imul(hash, 31) + feature.id.charCodeAt(i)) >>> 0;
      const overrideColor = kind !== "building" ? options.polygonSurfaceColor?.(feature) : undefined;
      const color = kind === "building" ? COLORS[hash % COLORS.length]! : overrideColor ? new THREE.Color(overrideColor) : SURFACE_COLORS[kind];
      const prepared: { rings: Point[][]; roofs: [Point, Point, Point][]; base: number }[] = [];
      let noData = false;
      for (const polygon of feature.geometry.coordinates) {
        const rings = polygon.map((ring) => {
          const points = ring.map(koriyamaGeoToLocal);
          if (points.length > 1 && points[0]!.x === points.at(-1)!.x && points[0]!.z === points.at(-1)!.z) points.pop();
          return points;
        });
        if (!rings[0] || rings[0].length < 3) continue;
        let base = -Infinity;
        const roofs: [Point, Point, Point][] = [];
        const flat = rings.flat();
        const shapeRings = rings.map((ring) => ring.map((p) => new THREE.Vector2(p.x, -p.z)));
        const faces = THREE.ShapeUtils.triangulateShape(shapeRings[0]!, shapeRings.slice(1));
        for (const [ia, ib, ic] of faces) {
          const a = flat[ia!]!, b = flat[ib!]!, c = flat[ic!]!;
          if (kind !== "building") surfaceTriangle(kind, a, b, c, color, feature);
          else planarTriangles(a, b, c, (a, b, c) => {
            roofs.push([a, b, c]);
            for (const p of [a, b, c, centroid(a, b, c)]) {
              const y = sampleGround(p.x, p.z);
              if (!validElevation(y)) noData = true;
              else base = Math.max(base, y);
            }
          });
        }
        if (roofs.length) prepared.push({ rings, roofs, base: base + 0.08 });
      }
      // Preflight every clipped polygon before emitting anything: no partial building on missing DEM.
      if (height && noData) { stats.skippedNoDataBuildings++; continue; }
      if (height && prepared.length) {
        heightRecords[feature.id] = height; stats.buildings++;
        if (height.unknown) stats.unknownHeights++;
        if (height.estimated) stats.estimatedHeights++;
        if (!height.unknown && !height.estimated) stats.sourceHeights++;
        if (height.source === "plateau-lod1-z-bounds") stats.plateauModelHeights++;
        stats.heightSources[height.source] = (stats.heightSources[height.source] ?? 0) + 1;
      }
      for (const { rings, roofs, base } of prepared) {
        const top = base + height!.meters;
        const roofPoint = (p: Point): Point => ({ ...p, y: top, u: p.x - rings[0]![0]!.x, v: p.z - rings[0]![0]!.z });
        for (const [a, b, c] of roofs) triangle("building", roofPoint(a), roofPoint(b), roofPoint(c), color);
        if (height!.meters > 0) {
          for (const ring of rings) for (let i = 0; i < ring.length; i++) {
            const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
            // Anchor to original edge, BEFORE local-bounds and tile clipping. Metres, not normalized UV.
            const length = Math.hypot(b.x - a.x, b.z - a.z);
            const ab = { ...a, y: base, u: 0, v: 0 }, bb = { ...b, y: base, u: length, v: 0 };
            const at = { ...a, y: top, u: 0, v: height!.meters }, bt = { ...b, y: top, u: length, v: height!.meters };
            triangle("building", ab, bb, bt, WALL_COLOR);
            triangle("building", ab, bt, at, WALL_COLOR);
          }
        }
      }
    } else {
      if (!isOsmFeature(feature)) continue;
      if (kind !== "road" && kind !== "rail" && kind !== "waterway") continue;
      const bridge = (kind === "road" || kind === "rail") && isGeodataBridge(feature);
      const layer: Layer = bridge ? (kind === "road" ? "bridge-road" : "bridge-rail") : kind;
      if (bridge) bridgeRecords.push({ id: feature.id, kind, bridge: feature.properties.bridge, layer: feature.properties.layer });
      const width = lineWidth(feature);
      for (const line of feature.geometry.coordinates) {
        for (let i = 1; i < line.length; i++) {
          const a = koriyamaGeoToLocal(line[i - 1]!), b = koriyamaGeoToLocal(line[i]!);
          const length = Math.hypot(b.x - a.x, b.z - a.z);
          if (length < 1e-8) continue;
          const dx = -(b.z - a.z) / length * width / 2, dz = (b.x - a.x) / length * width / 2;
          const surfacePoint = (x: number, z: number) => ({ x, y: 0, z });
          const al = surfacePoint(a.x + dx, a.z + dz), ar = surfacePoint(a.x - dx, a.z - dz);
          const bl = surfacePoint(b.x + dx, b.z + dz), br = surfacePoint(b.x - dx, b.z - dz);
          surfaceTriangle(layer, al, bl, ar, SURFACE_COLORS[layer], feature);
          surfaceTriangle(layer, ar, bl, br, SURFACE_COLORS[layer], feature);
        }
      }
    }
  }
  for (const buffer of buffers.values()) flush(buffer);
  stats.tiles = tiles.size;
  // Empty inputs still have no unattached disposable resources.
  if (!group.children.some((m) => (m as THREE.Mesh).material === material)) material.dispose();
  if (!group.children.some((m) => (m as THREE.Mesh).material === buildingMaterial)) buildingMaterial.dispose();
  if (!group.waterMeshes.length) waterMaterial.dispose();
  return group;
}
