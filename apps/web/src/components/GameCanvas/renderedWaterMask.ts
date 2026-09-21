import * as THREE from "three";

export const WATER_MASK_BUCKET_METERS = 8;
export const WATER_MASK_MAX_CANDIDATES = 64;
export const WATER_MASK_MAX_QUERY_BUCKETS = 4;
export const WATER_MASK_EDGE_EPSILON = 1e-4;
const MAX_BUCKETS = 262_144;
const MAX_TRIANGLES = 131_072;
const MAX_REGISTRATIONS = 4_000_000;
const MAX_TYPED_BYTES = 16 * 1024 * 1024;

export type WaterMaskBounds = Readonly<{ minX: number; minZ: number; maxX: number; maxZ: number }>;
export type WaterMaskClassification = "water" | "dry" | "unknown";
export type RenderedWaterMask = Readonly<{
  classify(x: number, z: number): WaterMaskClassification;
  classifyFootprint(minX: number, minZ: number, maxX: number, maxZ: number): WaterMaskClassification;
  stats: Readonly<{
    meshes: number; triangles: number; degenerateTriangles: number; outsideTriangles: number;
    invalidInputs: number; buckets: number; occupiedBuckets: number; overflowBuckets: number;
    maxCandidates: number; triangleReferences: number; registrations: number;
    triangleBytes: number; bucketCountBytes: number; bucketOffsetBytes: number; referenceBytes: number;
    retainedTypedArrayBytes: number; buildScratchTypedArrayBytes: number; peakTypedArrayBytes: number;
  }>;
}>;

/** Static CPU footprint of ALL supplied water meshes, not just stage-eligible
 * river polygons. Holes/no-data omitted from the mesh remain absent; ribbons
 * may fill them. "dry" means no emitted water, NOT valid terrain or safe land.
 * Callers must independently require ground-data coverage.
 *
 * Coordinates are world XZ at construction. Query ignores Y/stage/visibility;
 * rebuild after geometry, drawRange or world-XZ transform changes. Both indexed
 * and non-indexed triangle lists are supported. Malformed data fails closed
 * (unknown throughout); zero-area projected triangles have no footprint.
 * Multi-material geometry is unsupported and also fails closed.
 *
 * One point lookup, <=64 exact triangle tests; footprint queries cover at most
 * four buckets / 256 tests, including repeated references. No cache, raycaster, GPU or query-time
 * allocations. Overflow buckets are unknown, never truncated. Finite bounds
 * define where absence of triangles is meaningful. Outside is always unknown.
 * Setup budgets throw RangeError instead of building a partial dry mask.
 */
export function createRenderedWaterMask(meshes: readonly THREE.Mesh[], bounds: WaterMaskBounds): RenderedWaterMask {
  const { minX, minZ, maxX, maxZ } = bounds;
  if (![minX, minZ, maxX, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ)
    throw new RangeError("Water mask requires finite, nonempty geographic bounds");
  const originX = Math.floor(minX / WATER_MASK_BUCKET_METERS), originZ = Math.floor(minZ / WATER_MASK_BUCKET_METERS);
  const columns = Math.floor(maxX / WATER_MASK_BUCKET_METERS) - originX + 1;
  const rows = Math.floor(maxZ / WATER_MASK_BUCKET_METERS) - originZ + 1, bucketCount = columns * rows;
  if (![originX, originZ, columns, rows, bucketCount].every(Number.isSafeInteger) || bucketCount > MAX_BUCKETS)
    throw new RangeError("Water mask geographic bucket budget exceeded");

  let invalidInputs = 0, degenerateTriangles = 0, outsideTriangles = 0, triangleCount = 0;
  const point = new THREE.Vector3();
  // Do not update source objects/matrices. Compose a read-only world snapshot,
  // respecting explicitly managed local matrices as well as normal Object3Ds.
  const descriptors = [...new Set(meshes)].map(mesh => {
    const matrix = new THREE.Matrix4();
    let object: THREE.Object3D | null = mesh;
    while (object) {
      const local = object.matrixAutoUpdate ? new THREE.Matrix4().compose(object.position, object.quaternion, object.scale) : object.matrix;
      matrix.premultiply(local); object = object.parent;
    }
    return { mesh, matrix };
  });

  // Two passes avoid a retained object per triangle and a large JS staging list.
  function visit(write?: Float64Array): void {
    let target = 0;
    for (const { mesh, matrix } of descriptors) {
      const geometry = mesh.geometry, p = geometry.getAttribute("position"), index = geometry.getIndex();
      const count = index?.count ?? p?.count ?? 0, range = geometry.drawRange;
      if (!p || p.itemSize < 3 || !Number.isSafeInteger(p.count) || !Number.isSafeInteger(count) ||
          Array.isArray(mesh.material) || !matrix.elements.every(Number.isFinite) ||
          !Number.isSafeInteger(range.start) || range.start < 0 ||
          !(range.count === Infinity || (Number.isSafeInteger(range.count) && range.count >= 0))) {
        if (!write) invalidInputs++; continue;
      }
      const end = Math.min(count, range.start + range.count);
      for (let i = range.start; i + 2 < end; i += 3) {
        let ax = 0, az = 0, bx = 0, bz = 0, cx = 0, cz = 0, valid = true;
        for (let k = 0; k < 3; k++) {
          const j = index ? index.getX(i + k) : i + k;
          if (!Number.isInteger(j) || j < 0 || j >= p.count) { valid = false; break; }
          point.set(p.getX(j), p.getY(j), p.getZ(j)).applyMatrix4(matrix);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) { valid = false; break; }
          if (k === 0) { ax = point.x; az = point.z; }
          else if (k === 1) { bx = point.x; bz = point.z; }
          else { cx = point.x; cz = point.z; }
        }
        const determinant = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
        if (!valid || !Number.isFinite(determinant)) { if (!write) invalidInputs++; continue; }
        if (determinant === 0) { if (!write) degenerateTriangles++; continue; }
        const e = WATER_MASK_EDGE_EPSILON;
        if (Math.max(ax, bx, cx) < minX - e || Math.min(ax, bx, cx) > maxX + e ||
            Math.max(az, bz, cz) < minZ - e || Math.min(az, bz, cz) > maxZ + e) {
          if (!write) outsideTriangles++; continue;
        }
        if (write) {
          write[target++] = ax; write[target++] = az; write[target++] = bx;
          write[target++] = bz; write[target++] = cx; write[target++] = cz;
        } else if (++triangleCount > MAX_TRIANGLES) throw new RangeError("Water mask triangle budget exceeded");
      }
    }
  }
  visit();
  // Float64 preserves supplied coordinates/transforms at the 0.1mm tolerance;
  // do not quantize to bucket centres or downcast a Float64 source attribute.
  const triangles = new Float64Array(triangleCount * 6); visit(triangles);
  const counts = new Uint32Array(bucketCount); // setup scratch: exact, unsaturated counts
  let registrations = 0;
  function bucketsForTriangle(i: number, store: boolean, offsets?: Uint32Array, references?: Uint32Array): void {
    const e = WATER_MASK_EDGE_EPSILON, p = i * 6;
    const x0 = Math.max(0, Math.floor((Math.min(triangles[p]!, triangles[p + 2]!, triangles[p + 4]!) - e) / WATER_MASK_BUCKET_METERS) - originX);
    const x1 = Math.min(columns - 1, Math.floor((Math.max(triangles[p]!, triangles[p + 2]!, triangles[p + 4]!) + e) / WATER_MASK_BUCKET_METERS) - originX);
    const z0 = Math.max(0, Math.floor((Math.min(triangles[p + 1]!, triangles[p + 3]!, triangles[p + 5]!) - e) / WATER_MASK_BUCKET_METERS) - originZ);
    const z1 = Math.min(rows - 1, Math.floor((Math.max(triangles[p + 1]!, triangles[p + 3]!, triangles[p + 5]!) + e) / WATER_MASK_BUCKET_METERS) - originZ);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const bucket = z * columns + x;
      if (!store) {
        if (++registrations > MAX_REGISTRATIONS) throw new RangeError("Water mask setup registration budget exceeded");
        counts[bucket]!++;
      } else if (sizes[bucket]! <= WATER_MASK_MAX_CANDIDATES) {
        references![offsets![bucket]! + counts[bucket]!] = i; counts[bucket]!++;
      }
    }
  }
  for (let i = 0; i < triangleCount; i++) bucketsForTriangle(i, false);
  const sizes = new Uint8Array(bucketCount), offsets = new Uint32Array(bucketCount + 1);
  let occupiedBuckets = 0, overflowBuckets = 0, maxCandidates = 0, referenceCount = 0;
  for (let b = 0; b < bucketCount; b++) {
    const count = counts[b]!;
    if (count) occupiedBuckets++;
    maxCandidates = Math.max(maxCandidates, count);
    offsets[b] = referenceCount;
    sizes[b] = Math.min(WATER_MASK_MAX_CANDIDATES + 1, count);
    if (count > WATER_MASK_MAX_CANDIDATES) overflowBuckets++;
    else referenceCount += count;
  }
  offsets[bucketCount] = referenceCount;
  const retainedBytes = triangles.byteLength + sizes.byteLength + offsets.byteLength + referenceCount * 4;
  if (retainedBytes + counts.byteLength > MAX_TYPED_BYTES) throw new RangeError("Water mask typed-array memory budget exceeded");
  const references = new Uint32Array(referenceCount);
  counts.fill(0); // reuse setup counts as insertion cursors, no extra staging array
  for (let i = 0; i < triangleCount; i++) bucketsForTriangle(i, true, offsets, references);
  const stats = Object.freeze({ meshes: descriptors.length, triangles: triangleCount, degenerateTriangles, outsideTriangles,
    invalidInputs, buckets: bucketCount, occupiedBuckets, overflowBuckets, maxCandidates, triangleReferences: referenceCount, registrations,
    triangleBytes: triangles.byteLength, bucketCountBytes: sizes.byteLength, bucketOffsetBytes: offsets.byteLength, referenceBytes: references.byteLength,
    retainedTypedArrayBytes: retainedBytes, buildScratchTypedArrayBytes: counts.byteLength, peakTypedArrayBytes: retainedBytes + counts.byteLength });
  // Report typed-array storage exactly. JS objects, temporary Matrix4/Vector3
  // instances and allocator overhead are intentionally NOT claimed as measured.
  // Separate factory scope ensures descriptor/source meshes and setup scratch
  // are not retained by the query closure.
  return makeMask({ minX, minZ, maxX, maxZ }, originX, originZ, columns, triangles, sizes, offsets, references, stats);
}

function makeMask(bounds: WaterMaskBounds, originX: number, originZ: number, columns: number,
  triangles: Float64Array, sizes: Uint8Array, offsets: Uint32Array, references: Uint32Array, stats: RenderedWaterMask["stats"]): RenderedWaterMask {
  return Object.freeze({ stats, classify(x: number, z: number): WaterMaskClassification {
    if (!Number.isFinite(x) || !Number.isFinite(z) || stats.invalidInputs ||
        x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return "unknown";
    const bucket = (Math.floor(z / WATER_MASK_BUCKET_METERS) - originZ) * columns + Math.floor(x / WATER_MASK_BUCKET_METERS) - originX;
    const count = sizes[bucket]!;
    if (count > WATER_MASK_MAX_CANDIDATES) return "unknown";
    for (let i = offsets[bucket]!; i < offsets[bucket]! + count; i++) {
      if (inTriangle(triangles, references[i]! * 6, x, z)) return "water";
    }
    return "dry";
  }, classifyFootprint(minX: number, minZ: number, maxX: number, maxZ: number): WaterMaskClassification {
    if (!Number.isFinite(minX) || !Number.isFinite(minZ) || !Number.isFinite(maxX) || !Number.isFinite(maxZ) ||
        stats.invalidInputs || minX > maxX || minZ > maxZ ||
        minX < bounds.minX || minZ < bounds.minZ || maxX > bounds.maxX || maxZ > bounds.maxZ) return "unknown";
    const e = WATER_MASK_EDGE_EPSILON;
    const x0 = Math.floor(Math.max(bounds.minX, minX - e) / WATER_MASK_BUCKET_METERS) - originX;
    const x1 = Math.floor(Math.min(bounds.maxX, maxX + e) / WATER_MASK_BUCKET_METERS) - originX;
    const z0 = Math.floor(Math.max(bounds.minZ, minZ - e) / WATER_MASK_BUCKET_METERS) - originZ;
    const z1 = Math.floor(Math.min(bounds.maxZ, maxZ + e) / WATER_MASK_BUCKET_METERS) - originZ;
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > WATER_MASK_MAX_QUERY_BUCKETS) return "unknown";
    // Unknown takes precedence over an intersection in another bucket. Never
    // certify the complete cell when any touched bucket exceeded its budget.
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (sizes[z * columns + x]! > WATER_MASK_MAX_CANDIDATES) return "unknown";
    }
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const bucket = z * columns + x;
      for (let i = offsets[bucket]!; i < offsets[bucket]! + sizes[bucket]!; i++) {
        if (triangleIntersectsBox(triangles, references[i]! * 6, minX, minZ, maxX, maxZ)) return "water";
      }
    }
    return "dry";
  } });
}

function triangleIntersectsBox(p: Float64Array, i: number, minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  const ax = p[i]!, az = p[i + 1]!, bx = p[i + 2]!, bz = p[i + 3]!, cx = p[i + 4]!, cz = p[i + 5]!;
  let separated = Math.max(ax, bx, cx) < minX || Math.min(ax, bx, cx) > maxX ||
    Math.max(az, bz, cz) < minZ || Math.min(az, bz, cz) > maxZ;
  const centerX = minX + (maxX - minX) / 2, centerZ = minZ + (maxZ - minZ) / 2;
  const halfX = (maxX - minX) / 2, halfZ = (maxZ - minZ) / 2;
  // Separating axes: box X/Z and each triangle-edge normal. This detects thin
  // crossings with no vertex/corner contained, unlike a nine-point mask probe.
  for (let edge = 0; edge < 3 && !separated; edge++) {
    const sx = edge === 0 ? ax : edge === 1 ? bx : cx, sz = edge === 0 ? az : edge === 1 ? bz : cz;
    const ex = edge === 0 ? bx : edge === 1 ? cx : ax, ez = edge === 0 ? bz : edge === 1 ? cz : az;
    const nx = ez - sz, nz = sx - ex;
    const a = (ax - sx) * nx + (az - sz) * nz, b = (bx - sx) * nx + (bz - sz) * nz, c = (cx - sx) * nx + (cz - sz) * nz;
    const center = (centerX - sx) * nx + (centerZ - sz) * nz, radius = halfX * Math.abs(nx) + halfZ * Math.abs(nz);
    separated = Math.max(a, b, c) < center - radius || Math.min(a, b, c) > center + radius;
  }
  if (!separated) return true;
  // For numerical tolerance use true Euclidean distances, not an expanded box
  // or padded SAT axes (which overreach diagonally at acute corners).
  const epsilon2 = WATER_MASK_EDGE_EPSILON ** 2;
  for (let edge = 0; edge < 3; edge++) {
    const sx = edge === 0 ? ax : edge === 1 ? bx : cx, sz = edge === 0 ? az : edge === 1 ? bz : cz;
    const ex = edge === 0 ? bx : edge === 1 ? cx : ax, ez = edge === 0 ? bz : edge === 1 ? cz : az;
    const boxX = Math.max(minX, Math.min(maxX, sx)), boxZ = Math.max(minZ, Math.min(maxZ, sz));
    if ((sx - boxX) ** 2 + (sz - boxZ) ** 2 <= epsilon2) return true;
    const dx = ex - sx, dz = ez - sz, length2 = dx * dx + dz * dz;
    for (let corner = 0; corner < 4; corner++) {
      const x = corner % 2 ? maxX : minX, z = corner >= 2 ? maxZ : minZ;
      const t = Math.max(0, Math.min(1, ((x - sx) * dx + (z - sz) * dz) / length2));
      if ((x - sx - t * dx) ** 2 + (z - sz - t * dz) ** 2 <= epsilon2) return true;
    }
  }
  return false;
}

function inTriangle(p: Float64Array, i: number, x: number, z: number): boolean {
  const ax = p[i]!, az = p[i + 1]!, bx = p[i + 2]!, bz = p[i + 3]!, cx = p[i + 4]!, cz = p[i + 5]!;
  const det = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const b = ((x - ax) * (cz - az) - (z - az) * (cx - ax)) / det;
  const c = ((bx - ax) * (z - az) - (bz - az) * (x - ax)) / det;
  if (b >= 0 && c >= 0 && 1 - b - c >= 0) return true;
  // Euclidean distance to FINITE edges (including endpoints), never a widened
  // barycentric threshold that leaks arbitrarily far beyond acute corners.
  for (let edge = 0; edge < 3; edge++) {
    const sx = edge === 0 ? ax : edge === 1 ? bx : cx, sz = edge === 0 ? az : edge === 1 ? bz : cz;
    const ex = edge === 0 ? bx : edge === 1 ? cx : ax, ez = edge === 0 ? bz : edge === 1 ? cz : az;
    const dx = ex - sx, dz = ez - sz;
    const t = Math.max(0, Math.min(1, ((x - sx) * dx + (z - sz) * dz) / (dx * dx + dz * dz)));
    if ((x - sx - t * dx) ** 2 + (z - sz - t * dz) ** 2 <= WATER_MASK_EDGE_EPSILON ** 2) return true;
  }
  return false;
}
