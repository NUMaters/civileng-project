import * as THREE from "three";

export const BASIN_CONSTRUCTION_MAX_MASKS = 64;
export const BASIN_CONSTRUCTION_DATUM_OFFSET = 0.5;
export const BASIN_CONSTRUCTION_BED_Y = 0.2;
export const BASIN_CONSTRUCTION_CREST_Y = 9;
export type BasinConstructionKind = "terrain" | "water";
/** Precomputed world-metre snapshot, basins only. Include preview basins too.
 * baseY is center-ground + 0.5, already computed by main, NOT a
 * footprint maximum, river level, or placement.position.height in another datum.
 */
export type BasinConstructionPlacement = {
  x: number;
  z: number;
  headingDegrees: number;
  baseY: number;
};
type WorldPoint = { x: number; y: number; z: number };
export type BasinConstructionUpdate =
  | { ok: true; count: number }
  | { ok: false; reason: "capacity" | "invalid-placement"; count: 0; requested: number };
export type BasinConstructionMask = {
  uniforms: {
    basinMaskCount: THREE.IUniform<number>;
    maskCenter: THREE.IUniform<THREE.Vector4[]>;
    maskLevels: THREE.IUniform<THREE.Vector3[]>;
  };
  status: BasinConstructionUpdate;
  /** Inspect after compilation for unsupported hooks. No GPU resources owned here. */
  attachments: Array<{ ok: boolean; reason?: string }>;
  attach(material: THREE.Material, kind: BasinConstructionKind): void;
  update(placements: readonly BasinConstructionPlacement[]): void;
  updateTransform(index: number, x: number, z: number, rotationY: number, baseY: number, scale: number): void;
  contains(world: WorldPoint): boolean;
  shouldDiscard(world: WorldPoint, kind: BasinConstructionKind): boolean;
  /** Nearest forward bed-plane intersection, bounded by that basin's own pool. */
  raycastFloor(ray: THREE.Ray): THREE.Vector3 | null;
};

/** Exactly the operational pool's quadratic corner shape: +/-32 by +/-22,
 * 8 m corner extents. Quadratic Bezier corners are NOT circular arcs.
 * Use this shape for a replacement bed/water mesh; it is in local X/Z coordinates.
 */
export function createBasinConstructionShape(): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-24, -22);
  shape.lineTo(24, -22);
  shape.quadraticCurveTo(32, -22, 32, -14);
  shape.lineTo(32, 14);
  shape.quadraticCurveTo(32, 22, 24, 22);
  shape.lineTo(-24, 22);
  shape.quadraticCurveTo(-32, 22, -32, 14);
  shape.lineTo(-32, -14);
  shape.quadraticCurveTo(-32, -22, -24, -22);
  return shape;
}

function poolContains(x: number, z: number): boolean {
  const ax = Math.abs(x),
    az = Math.abs(z);
  if (ax > 32 || az > 22) return false;
  if (ax <= 24 || az <= 14) return true;
  return Math.sqrt(Math.max(0, (32 - ax) / 8)) + Math.sqrt(Math.max(0, (22 - az) / 8)) >= 1;
}

/** Prepend to a fragment shader and merge mask.uniforms by reference.
 * maskCenter = world X/Z, cos(-heading), sin(-heading).
 * maskLevels = world bed Y, world full-berm crest Y, animated uniform scale.
 * At the start of main(): if (basinConstructionDiscardTerrain(world)) discard;
 * or basinConstructionDiscardWater(world) for SOURCE water only.
 * Never attach to the constructed bed, berm, or own stored-water material.
 */
export const BASIN_CONSTRUCTION_GLSL = `
uniform int basinMaskCount;
uniform vec4 maskCenter[64];
uniform vec3 maskLevels[64];
bool basinConstructionInside(vec3 world, int i) {
  vec2 delta = world.xz - maskCenter[i].xy;
  vec2 p = abs(vec2(maskCenter[i].z * delta.x - maskCenter[i].w * delta.y,
    maskCenter[i].w * delta.x + maskCenter[i].z * delta.y)) / maskLevels[i].z;
  if (p.x > 32.0 || p.y > 22.0) return false;
  if (p.x <= 24.0 || p.y <= 14.0) return true;
  vec2 edge = sqrt(max(vec2(0.0), (vec2(32.0, 22.0) - p) / 8.0));
  return edge.x + edge.y >= 1.0;
}
bool basinConstructionContains(vec3 world) {
  for (int i = 0; i < 64; ++i) {
    if (i >= basinMaskCount) break;
    if (basinConstructionInside(world, i)) return true;
  }
  return false;
}
bool basinConstructionDiscardTerrain(vec3 world) {
  for (int i = 0; i < 64; ++i) {
    if (i >= basinMaskCount) break;
    if (world.y > maskLevels[i].x && basinConstructionInside(world, i)) return true;
  }
  return false;
}
bool basinConstructionDiscardWater(vec3 world) {
  for (int i = 0; i < 64; ++i) {
    if (i >= basinMaskCount) break;
    if (world.y < maskLevels[i].y && basinConstructionInside(world, i)) return true;
  }
  return false;
}
`;

/** Pool-only rendering correction. Original DEM/river triangles and hydrology
 * stay unchanged. CPU predicates let main filter picking consistently; shader
 * discard does not change raycasting, shadow depth passes, or terrain sampling.
 * The existing bed seals the cut floor. No cut sidewalls are generated here;
 * outer berm intersections remain possible and require a separate earthwork mesh.
 * The 9 m cutoff allows full-crest inundation, NOT physical intake hydraulics:
 * the lowered inlet and open outlet are outside this inner-pool mask.
 */
export function createBasinConstructionMask(): BasinConstructionMask {
  const uniforms = {
    basinMaskCount: { value: 0 },
    maskCenter: {
      value: Array.from({ length: BASIN_CONSTRUCTION_MAX_MASKS }, () => new THREE.Vector4()),
    },
    maskLevels: {
      value: Array.from({ length: BASIN_CONSTRUCTION_MAX_MASKS }, () => new THREE.Vector3()),
    },
  };
  const valid = (p: BasinConstructionPlacement) =>
    [p.x, p.z, p.headingDegrees, p.baseY, p.baseY + 9].every(Number.isFinite);
  const inside = (world: WorldPoint, i: number) => {
    const center = uniforms.maskCenter.value[i];
    const dx = world.x - center.x,
      dz = world.z - center.y;
    const scale = uniforms.maskLevels.value[i].z;
    return poolContains((center.z * dx - center.w * dz) / scale, (center.w * dx + center.z * dz) / scale);
  };
  const mask: BasinConstructionMask = {
    uniforms,
    status: { ok: true, count: 0 },
    attachments: [],
    attach(material, kind) {
      mask.attachments.push(attachBasinConstructionMask(material, kind, mask).status);
    },
    /** Call only when placement/heading/ground snapshots change, including previews.
     * No timestep, storage or river-stage input. Uniform identities remain stable.
     * Failure disables ALL masks (never stale/partial masks) and sets mask.status
     * for the caller to surface; it does not throw or truncate gameplay placements.
     */
    update(placements: readonly BasinConstructionPlacement[]): void {
      const reason =
        placements.length > BASIN_CONSTRUCTION_MAX_MASKS
          ? "capacity"
          : placements.some((p) => !valid(p))
            ? "invalid-placement"
            : null;
      if (reason) {
        uniforms.basinMaskCount.value = 0;
        mask.status = { ok: false, reason, count: 0, requested: placements.length };
        return;
      }
      placements.forEach((p, i) => {
        const angle = -THREE.MathUtils.degToRad(p.headingDegrees % 360);
        uniforms.maskCenter.value[i].set(p.x, p.z, Math.cos(angle), Math.sin(angle));
        const datum = p.baseY;
        uniforms.maskLevels.value[i].set(
          datum + BASIN_CONSTRUCTION_BED_Y,
          datum + BASIN_CONSTRUCTION_CREST_Y,
          1,
        );
      });
      uniforms.basinMaskCount.value = placements.length;
      mask.status = { ok: true, count: placements.length };
    },
    // Match animated model transforms without rebuilding arrays or sampling terrain.
    updateTransform(index, x, z, rotationY, baseY, scale) {
      if (index < 0 || index >= uniforms.basinMaskCount.value || !Number.isInteger(index) ||
          !Number.isFinite(x + z + rotationY + baseY + scale) || scale <= 0) return;
      uniforms.maskCenter.value[index].set(x, z, Math.cos(rotationY), Math.sin(rotationY));
      uniforms.maskLevels.value[index].set(baseY + BASIN_CONSTRUCTION_BED_Y * scale,
        baseY + BASIN_CONSTRUCTION_CREST_Y * scale, scale);
    },
    raycastFloor(ray: THREE.Ray): THREE.Vector3 | null {
      if (
        ![
          ray.origin.x,
          ray.origin.y,
          ray.origin.z,
          ray.direction.x,
          ray.direction.y,
          ray.direction.z,
        ].every(Number.isFinite) ||
        ray.direction.y === 0
      )
        return null;
      let nearest = Infinity;
      for (let i = 0; i < uniforms.basinMaskCount.value; i++) {
        const t = (uniforms.maskLevels.value[i].x - ray.origin.y) / ray.direction.y;
        if (!Number.isFinite(t) || t <= 0 || t >= nearest) continue;
        const hit = {
          x: ray.origin.x + t * ray.direction.x,
          y: uniforms.maskLevels.value[i].x,
          z: ray.origin.z + t * ray.direction.z,
        };
        if (Number.isFinite(hit.x) && Number.isFinite(hit.z) && inside(hit, i)) nearest = t;
      }
      return nearest < Infinity ? ray.at(nearest, new THREE.Vector3()) : null;
    },
    contains(world: WorldPoint): boolean {
      if (![world.x, world.y, world.z].every(Number.isFinite)) return false;
      for (let i = 0; i < uniforms.basinMaskCount.value; i++) if (inside(world, i)) return true;
      return false;
    },
    shouldDiscard(world: WorldPoint, kind: BasinConstructionKind): boolean {
      if (![world.x, world.y, world.z].every(Number.isFinite)) return false;
      for (let i = 0; i < uniforms.basinMaskCount.value; i++) {
        const levels = uniforms.maskLevels.value[i];
        if ((kind === "terrain" ? world.y > levels.x : world.y < levels.y) && inside(world, i))
          return true;
      }
      return false;
    },
  };
  return mask;
}
type Shader = Parameters<THREE.Material["onBeforeCompile"]>[0];
const attachments = new WeakMap<THREE.Material, object>();

/** Attach once per material, sharing one mask across terrain and source water.
 * Composes the previous hook/cache key. Supports standard non-instanced terrain
 * (<project_vertex>) and geographicWater's existing waterWorldPosition varying.
 * Custom shaders without either hook fail visibly through status, not an exception.
 * Recheck status after first compilation; onBeforeCompile runs lazily in Three.
 * dispose() restores prior hooks, leaving material/geometry ownership with caller.
 */
export function attachBasinConstructionMask(
  material: THREE.Material,
  kind: BasinConstructionKind,
  mask: BasinConstructionMask,
) {
  const status: { ok: boolean; reason?: string } = { ok: true };
  const token = {};
  if (attachments.has(material)) {
    return { status: { ok: false, reason: "already-attached" }, dispose() {} };
  }
  const previousCompile = material.onBeforeCompile;
  // Evaluate before replacing onBeforeCompile: Three's default cache key uses it.
  const previousKey = material.customProgramCacheKey();
  const previousCacheKey = material.customProgramCacheKey;
  const compile = function (this: THREE.Material, shader: Shader, renderer: THREE.WebGLRenderer) {
    previousCompile.call(this, shader, renderer);
    const usesWaterPosition =
      /varying\s+vec3\s+waterWorldPosition\s*;/.test(shader.fragmentShader) &&
      /waterWorldPosition\s*=/.test(shader.vertexShader);
    const standard = shader.vertexShader.includes("#include <project_vertex>");
    const main = /void\s+main\s*\(\s*(?:void\s*)?\)\s*\{/;
    if ((!usesWaterPosition && !standard) || !main.test(shader.fragmentShader)) {
      status.ok = false;
      status.reason = "unsupported-shader-hooks";
      return;
    }
    const world = usesWaterPosition ? "waterWorldPosition" : "vBasinConstructionWorld";
    if (!usesWaterPosition) {
      shader.vertexShader =
        "varying vec3 vBasinConstructionWorld;\n" +
        shader.vertexShader.replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvBasinConstructionWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = "varying vec3 vBasinConstructionWorld;\n" + shader.fragmentShader;
    }
    const predicate =
      kind === "terrain" ? "basinConstructionDiscardTerrain" : "basinConstructionDiscardWater";
    shader.fragmentShader =
      BASIN_CONSTRUCTION_GLSL +
      shader.fragmentShader.replace(
        main,
        (match) => `${match}\nif (${predicate}(${world})) discard;`,
      );
    Object.assign(shader.uniforms, mask.uniforms);
    status.ok = true;
    delete status.reason;
  };
  attachments.set(material, token);
  material.onBeforeCompile = compile;
  const cacheKey = () =>
    `${
      previousCacheKey === THREE.Material.prototype.customProgramCacheKey
        ? previousKey
        : previousCacheKey.call(material)
    }|basin-construction-v1-${kind}-64`;
  material.customProgramCacheKey = cacheKey;
  material.needsUpdate = true;
  return {
    status,
    dispose() {
      if (attachments.get(material) !== token) return;
      attachments.delete(material);
      if (material.onBeforeCompile === compile) material.onBeforeCompile = previousCompile;
      if (material.customProgramCacheKey === cacheKey)
        material.customProgramCacheKey = previousCacheKey;
      material.needsUpdate = true;
    },
  };
}
