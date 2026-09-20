import type { Mesh } from "three";

export const RIVER_SURFACE_CACHE_LIMIT = 4096;
/** Absolute horizontal distance, in metres; never a shoreline search offset. */
export const RIVER_SURFACE_EDGE_TOLERANCE = 1e-4;
export type RiverSurfaceSampler = ((x: number, z: number) => number | null) & {
  readonly cacheSize: number;
};

type Vertex = { x: number; y: number; z: number };
type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type Triangle = Bounds & { mesh: Mesh; a: Vertex; b: Vertex; c: Vertex; determinant: number };
type Node = Bounds & { triangles?: Triangle[]; left?: Node; right?: Node };
type Hit = { mesh: Mesh; localY: number };

function indexTriangles(triangles: Triangle[]): Node | null {
  if (!triangles.length) return null;
  const bounds: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const t of triangles) {
    bounds.minX = Math.min(bounds.minX, t.minX); bounds.maxX = Math.max(bounds.maxX, t.maxX);
    bounds.minZ = Math.min(bounds.minZ, t.minZ); bounds.maxZ = Math.max(bounds.maxZ, t.maxZ);
  }
  if (triangles.length <= 8) return { ...bounds, triangles };
  const alongX = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ;
  triangles.sort((a, b) => alongX
    ? (a.minX / 2 + a.maxX / 2) - (b.minX / 2 + b.maxX / 2)
    : (a.minZ / 2 + a.maxZ / 2) - (b.minZ / 2 + b.maxZ / 2));
  const middle = Math.floor(triangles.length / 2);
  return { ...bounds, left: indexTriangles(triangles.slice(0, middle))!, right: indexTriangles(triangles.slice(middle))! };
}

function contains(bounds: Bounds, x: number, z: number): boolean {
  const e = RIVER_SURFACE_EDGE_TOLERANCE;
  return x >= bounds.minX - e && x <= bounds.maxX + e && z >= bounds.minZ - e && z <= bounds.maxZ + e;
}

function height(t: Triangle, x: number, z: number): number | null {
  const { a, b, c, determinant } = t;
  const wb = ((x - a.x) * (c.z - a.z) - (z - a.z) * (c.x - a.x)) / determinant;
  const wc = ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x)) / determinant;
  const wa = 1 - wb - wc;
  if (wa >= 0 && wb >= 0 && wc >= 0) return wa * a.y + wb * b.y + wc * c.y;
  // Only numerical boundary tolerance: test actual Euclidean distance to each
  // finite edge, so acute corners cannot extend the tolerance into open water.
  let nearest = RIVER_SURFACE_EDGE_TOLERANCE ** 2;
  let result: number | null = null;
  for (let i = 0; i < 3; i++) {
    const start = i === 0 ? a : i === 1 ? b : c;
    const end = i === 0 ? b : i === 1 ? c : a;
    const dx = end.x - start.x, dz = end.z - start.z;
    const fraction = Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / (dx * dx + dz * dz)));
    const distance = (x - start.x - fraction * dx) ** 2 + (z - start.z - fraction * dz) ** 2;
    if (distance <= nearest) {
      nearest = distance;
      result = (1 - fraction) * start.y + fraction * end.y;
    }
  }
  return result;
}

/** Sample source Abukuma triangles in geographic-world metre coordinates.
 * Only riverStageEligible === true is accepted; no DEM or missing-data fallback.
 * Geometry, drawRange and X/Z stay fixed for this sampler's lifetime. Meshes have
 * identity rotation/scale and zero X/Z translation; only mesh.position.y changes.
 * Coordinates are in their shared parent space (identity world parent in the map).
 * Recreate after rebuilding geometry or changing those transform assumptions.
 * Reads current position.y directly, without requiring a renderer/matrix tick.
 * A setup-time XZ tree handles cold queries; a bounded exact-coordinate LRU caches
 * hits AND misses. No raycaster, scene traversal, or new geometry during sampling.
 */
export function createRiverSurfaceSampler(meshes: readonly Mesh[]): RiverSurfaceSampler {
  const triangles: Triangle[] = [];
  for (const mesh of new Set(meshes)) {
    if (mesh.userData.riverStageEligible !== true) continue;
    const positions = mesh.geometry.getAttribute("position"), indices = mesh.geometry.getIndex();
    if (!positions || positions.itemSize < 3) continue;
    const count = indices?.count ?? positions.count;
    const start = Math.max(0, mesh.geometry.drawRange.start);
    const end = Math.min(count, start + mesh.geometry.drawRange.count);
    for (let i = start; i + 2 < end; i += 3) {
      const vertices: Vertex[] = [];
      for (let j = 0; j < 3; j++) {
        const vertex = indices ? indices.getX(i + j) : i + j;
        if (!Number.isInteger(vertex) || vertex < 0 || vertex >= positions.count) break;
        vertices.push({ x: positions.getX(vertex), y: positions.getY(vertex), z: positions.getZ(vertex) });
      }
      if (vertices.length !== 3 || vertices.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) continue;
      const [a, b, c] = vertices as [Vertex, Vertex, Vertex];
      const determinant = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      if (!Number.isFinite(determinant) || determinant === 0) continue;
      triangles.push({ mesh, a, b, c, determinant,
        minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
        minZ: Math.min(a.z, b.z, c.z), maxZ: Math.max(a.z, b.z, c.z) });
    }
  }
  const root = indexTriangles(triangles);
  const cache = new Map<string, Hit[]>();
  function lookup(node: Node, x: number, z: number, hits: Hit[]): void {
    if (!contains(node, x, z)) return;
    if (node.triangles) {
      for (const triangle of node.triangles) {
        if (!contains(triangle, x, z)) continue;
        const localY = height(triangle, x, z);
        if (localY === null || !Number.isFinite(localY)) continue;
        // At most one height per mesh; all of its triangles share stage translation.
        const existing = hits.find(hit => hit.mesh === triangle.mesh);
        if (existing) existing.localY = Math.max(existing.localY, localY);
        else hits.push({ mesh: triangle.mesh, localY });
      }
    } else {
      if (node.left) lookup(node.left, x, z, hits);
      if (node.right) lookup(node.right, x, z, hits);
    }
  }
  const sample = (x: number, z: number): number | null => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const key = `${x}/${z}`;
    let hits = cache.get(key);
    if (hits === undefined) {
      hits = [];
      if (root) lookup(root, x, z, hits);
      if (cache.size >= RIVER_SURFACE_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    } else cache.delete(key);
    cache.set(key, hits);
    let result: number | null = null;
    for (const hit of hits) {
      if (!hit.mesh.visible || hit.mesh.userData.riverStageEligible !== true) continue;
      const y = hit.localY + hit.mesh.position.y;
      if (Number.isFinite(y)) result = result === null ? y : Math.max(result, y);
    }
    return result;
  };
  return Object.defineProperty(sample, "cacheSize", { get: () => cache.size }) as RiverSurfaceSampler;
}
