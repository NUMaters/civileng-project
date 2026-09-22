import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  attachBasinConstructionMask,
  BASIN_CONSTRUCTION_GLSL,
  BASIN_CONSTRUCTION_MAX_MASKS,
  createBasinConstructionMask,
  createBasinConstructionShape,
} from "./basinConstructionSurface";
import { createGeographicTerrainMaterial } from "./geographicTerrainMaterial";
import { createGeographicWaterMaterial } from "./geographicWater";

const placement = { x: 100, z: -200, headingDegrees: 0, baseY: 12.5 };
const p = (x = 100, y = 13, z = -200) => ({ x, y, z });
type Shader = Parameters<THREE.Material["onBeforeCompile"]>[0];
function compile(material: THREE.Material) {
  const custom = material instanceof THREE.ShaderMaterial ? material : null;
  const shader = {
    uniforms: { ...(custom?.uniforms ?? THREE.ShaderLib.standard.uniforms) },
    vertexShader: custom?.vertexShader ?? THREE.ShaderLib.standard.vertexShader,
    fragmentShader: custom?.fragmentShader ?? THREE.ShaderLib.standard.fragmentShader,
  } as Shader;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe("basin construction mask", () => {
  it("tracks the same intermediate rotation, pop scale and lifted bed as the model", () => {
    const mask = createBasinConstructionMask();
    mask.update([placement]);
    const centers = mask.uniforms.maskCenter.value;
    const levels = mask.uniforms.maskLevels.value;
    for (const angle of [0, -0.17, -0.42, -Math.PI / 5]) {
      for (const scale of [0.9, 1, 1.12]) {
        const baseY = placement.baseY + (scale - 1) * 24;
        mask.updateTransform(0, placement.x, placement.z, angle, baseY, scale);
        const transform = new THREE.Matrix4().compose(new THREE.Vector3(placement.x, baseY, placement.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), new THREE.Vector3(scale, scale, scale));
        expect(mask.contains(new THREE.Vector3(31, 1, 0).applyMatrix4(transform))).toBe(true);
        expect(mask.contains(new THREE.Vector3(33, 1, 0).applyMatrix4(transform))).toBe(false);
        expect(mask.shouldDiscard(new THREE.Vector3(0, 8.9, 0).applyMatrix4(transform), "water")).toBe(true);
        expect(mask.shouldDiscard(new THREE.Vector3(0, 9.1, 0).applyMatrix4(transform), "water")).toBe(false);
        const floor = mask.raycastFloor(new THREE.Ray(new THREE.Vector3(placement.x, 100, placement.z), new THREE.Vector3(0, -1, 0)));
        expect(floor!.y).toBeCloseTo(baseY + 0.2 * scale);
      }
    }
    expect(mask.uniforms.maskCenter.value).toBe(centers);
    expect(mask.uniforms.maskLevels.value).toBe(levels);
    mask.update([]);
    mask.updateTransform(0, 0, 0, 0, 0, 1);
    expect(mask.contains(p())).toBe(false);
  });
  it("uses main's baseY exactly once and separates terrain cut from source overtopping", () => {
    const mask = createBasinConstructionMask();
    expect(mask.update([placement])).toBeUndefined();
    expect(mask.status).toEqual({ ok: true, count: 1 });
    expect(mask.uniforms.maskLevels.value[0].toArray()).toEqual([12.7, 21.5, 1]);
    expect(mask.contains(p())).toBe(true);
    expect(mask.shouldDiscard(p(100, 12.69), "terrain")).toBe(false);
    expect(mask.shouldDiscard(p(100, 12.7), "terrain")).toBe(false);
    expect(mask.shouldDiscard(p(100, 12.71), "terrain")).toBe(true);
    expect(mask.shouldDiscard(p(100, 21.49), "water")).toBe(true);
    expect(mask.shouldDiscard(p(100, 21.5), "water")).toBe(false);
    expect(mask.shouldDiscard(p(100, 30), "water")).toBe(false);
    expect(mask.shouldDiscard(p(133, 13), "terrain")).toBe(false);
    expect(mask.shouldDiscard(p(133, 13), "water")).toBe(false);
    // The lower inlet and outlet corridors outside the inner pool stay untouched.
    expect(mask.contains(p(100, 13, -228))).toBe(false);
    expect(mask.contains(p(140, 13, -200))).toBe(false);
  });

  it("matches quadratic pool corners, not a circular or rectangular approximation", () => {
    const mask = createBasinConstructionMask();
    mask.update([{ ...placement, x: 0, z: 0 }]);
    expect(mask.contains({ x: 32, y: 0, z: 14 })).toBe(true);
    expect(mask.contains({ x: 24, y: 0, z: 22 })).toBe(true);
    expect(mask.contains({ x: 32, y: 0, z: 22 })).toBe(false);
    // Quadratic corner midpoint is (30,20); the circle of radius 8 excludes it.
    expect(mask.contains({ x: 29.999, y: 0, z: 19.999 })).toBe(true);
    expect(mask.contains({ x: 30.001, y: 0, z: 20.001 })).toBe(false);
    const shape = createBasinConstructionShape();
    for (const point of shape.getPoints(32)) {
      // Avoid machine-precision ambiguity directly on the analytic boundary.
      expect(mask.contains({ x: point.x * 0.999999, y: 0, z: point.y * 0.999999 })).toBe(true);
    }
  });

  it.each([0, 37, 90, 155, 270, -450])(
    "uses model rotation -heading (%s degrees)",
    (headingDegrees) => {
      const mask = createBasinConstructionMask();
      mask.update([{ ...placement, headingDegrees }]);
      const transform = new THREE.Matrix4().makeRotationY(
        -THREE.MathUtils.degToRad(headingDegrees),
      );
      transform.setPosition(placement.x, placement.baseY, placement.z);
      for (const [x, z, expected] of [
        [31, 0, true],
        [0, 21, true],
        [31, 21, false],
        [33, 0, false],
      ] as const) {
        const world = new THREE.Vector3(x, 1, z).applyMatrix4(transform);
        expect(mask.contains(world)).toBe(expected);
      }
    },
  );

  it("unions overlapping placements with independent bed/crest levels", () => {
    const mask = createBasinConstructionMask();
    mask.update([placement, { ...placement, baseY: 30 }, { ...placement, x: 300 }]);
    expect(mask.shouldDiscard(p(100, 25), "water")).toBe(true);
    expect(mask.shouldDiscard(p(100, 25), "terrain")).toBe(true);
    expect(mask.contains(p(300))).toBe(true);
    expect(mask.contains(p(200))).toBe(false);
  });

  it("includes preview snapshots, replaces membership, and keeps live uniform identities", () => {
    const mask = createBasinConstructionMask();
    const uniform = mask.uniforms.maskCenter,
      array = uniform.value,
      vector = array[0];
    const preview = { ...placement };
    mask.update([preview]);
    preview.x = 1000;
    expect(mask.contains(p())).toBe(true); // copied snapshot, not caller-owned state
    mask.update([{ ...placement, x: 300 }]);
    expect(mask.contains(p())).toBe(false);
    expect(mask.contains(p(300))).toBe(true);
    expect(mask.uniforms.maskCenter).toBe(uniform);
    expect(mask.uniforms.maskCenter.value).toBe(array);
    expect(array[0]).toBe(vector);
    mask.update([]);
    expect(mask.contains(p(300))).toBe(false);
    expect(mask.status).toEqual({ ok: true, count: 0 });
  });

  it("supports 64 masks and disables all on overflow or invalid input without throwing", () => {
    const mask = createBasinConstructionMask();
    mask.update(Array.from({ length: 64 }, (_, i) => ({ ...placement, x: i * 100 })));
    expect(mask.status).toEqual({ ok: true, count: 64 });
    expect(mask.contains(p(6300))).toBe(true);
    mask.update(Array.from({ length: 65 }, () => placement));
    expect(mask.status).toEqual({ ok: false, reason: "capacity", count: 0, requested: 65 });
    expect(mask.contains(p(6300))).toBe(false);
    for (const invalid of [
      { x: NaN },
      { z: Infinity },
      { baseY: NaN },
      { headingDegrees: Infinity },
    ]) {
      mask.update([placement]);
      mask.update([placement, { ...placement, ...invalid }]);
      expect(mask.status).toEqual({
        ok: false,
        reason: "invalid-placement",
        count: 0,
        requested: 2,
      });
      expect(mask.contains(p())).toBe(false);
    }
    mask.update([placement]);
    expect(mask.contains(p())).toBe(true);
    expect(mask.contains(p(NaN))).toBe(false);
    expect(mask.shouldDiscard(p(100, NaN), "terrain")).toBe(false);
  });
});

describe("basin bed picking", () => {
  it("returns the nearest positive bed intersection without mutating the ray", () => {
    const mask = createBasinConstructionMask();
    mask.update([placement, { ...placement, baseY: 20 }]);
    const ray = new THREE.Ray(new THREE.Vector3(100, 50, -200), new THREE.Vector3(0, -1, 0));
    const copy = ray.clone();
    expect(mask.raycastFloor(ray)?.toArray()).toEqual([100, 20.2, -200]);
    expect(ray.equals(copy)).toBe(true);
    mask.update([]);
    expect(mask.raycastFloor(ray)).toBeNull();
  });

  it("tests each plane against its own rotated footprint, not the union", () => {
    const mask = createBasinConstructionMask();
    mask.update([placement, { ...placement, x: 300, baseY: 40, headingDegrees: 90 }]);
    const ray = new THREE.Ray(new THREE.Vector3(100, 50, -200), new THREE.Vector3(0, -1, 0));
    expect(mask.raycastFloor(ray)?.y).toBeCloseTo(12.7);
    ray.origin.set(300, 50, -169);
    expect(mask.raycastFloor(ray)?.y).toBeCloseTo(40.2);
    ray.origin.set(331, 50, -200);
    expect(mask.raycastFloor(ray)).toBeNull();
  });

  it("handles oblique rays, rejects corners, parallel/backward rays and invalid input", () => {
    const mask = createBasinConstructionMask();
    mask.update([{ x: 0, z: 0, headingDegrees: 0, baseY: 0 }]);
    const ray = new THREE.Ray(
      new THREE.Vector3(-10, 10.2, 0),
      new THREE.Vector3(1, -1, 0).normalize(),
    );
    const hit = mask.raycastFloor(ray)!;
    expect(hit.x).toBeCloseTo(0);
    expect(hit.y).toBeCloseTo(0.2);
    for (const [origin, direction] of [
      [
        [31, 10, 21],
        [0, -1, 0],
      ],
      [
        [0, 10, 0],
        [1, 0, 0],
      ],
      [
        [0, 10, 0],
        [0, 1, 0],
      ],
      [
        [0, 0.2, 0],
        [0, -1, 0],
      ],
      [
        [NaN, 10, 0],
        [0, -1, 0],
      ],
      [
        [0, 10, 0],
        [0, NaN, 0],
      ],
    ]) {
      expect(
        mask.raycastFloor(
          new THREE.Ray(
            new THREE.Vector3().fromArray(origin),
            new THREE.Vector3().fromArray(direction),
          ),
        ),
      ).toBeNull();
    }
  });
});

describe("basin material integration", () => {
  it("composes actual terrain relief and shares mutable mask uniforms across recompiles", () => {
    const material = createGeographicTerrainMaterial(),
      mask = createBasinConstructionMask();
    const key = material.customProgramCacheKey();
    expect(mask.attach(material, "terrain")).toBeUndefined();
    const shader = compile(material);
    expect(mask.attachments[0].ok).toBe(true);
    expect(material.customProgramCacheKey()).toContain(key);
    expect(shader.fragmentShader).toContain("sourceSlope");
    expect(shader.uniforms.groundSlopeRange).toBeDefined();
    expect(shader.fragmentShader).toContain(
      "if (basinConstructionDiscardTerrain(vBasinConstructionWorld)) discard;",
    );
    expect(shader.vertexShader).toContain("modelMatrix * vec4(transformed, 1.0)");
    expect(shader.uniforms.maskCenter).toBe(mask.uniforms.maskCenter);
    mask.update([placement]);
    expect(shader.uniforms.basinMaskCount.value).toBe(1);
    expect(compile(material).uniforms.maskLevels).toBe(mask.uniforms.maskLevels);
    material.dispose();
  });

  it("supports the actual custom river shader and does not attach to independent stored water", () => {
    const source = createGeographicWaterMaterial(),
      stored = new THREE.MeshBasicMaterial();
    const mask = createBasinConstructionMask();
    const originalVertex = source.vertexShader,
      storedHook = stored.onBeforeCompile;
    mask.attach(source, "water");
    const shader = compile(source);
    expect(mask.attachments[0].ok).toBe(true);
    expect(shader.vertexShader).toBe(originalVertex);
    expect(shader.fragmentShader).toContain(
      "if (basinConstructionDiscardWater(waterWorldPosition)) discard;",
    );
    expect(shader.fragmentShader).toContain("riverStructureShadow()");
    expect(shader.uniforms.time).toBe(source.uniforms.time);
    expect(stored.onBeforeCompile).toBe(storedHook);
    expect(source.depthTest).toBe(true);
    expect(source.depthWrite).toBe(true);
    source.dispose();
    stored.dispose();
  });

  it("preserves dynamic prior cache keys and can restore prior hooks", () => {
    const material = new THREE.MeshStandardMaterial();
    let version = 1;
    material.customProgramCacheKey = () => `prior-${version}`;
    const previousCompile = material.onBeforeCompile,
      previousKey = material.customProgramCacheKey;
    const handle = attachBasinConstructionMask(material, "terrain", createBasinConstructionMask());
    expect(material.customProgramCacheKey()).toContain("prior-1");
    version = 2;
    expect(material.customProgramCacheKey()).toContain("prior-2");
    handle.dispose();
    handle.dispose();
    expect(material.onBeforeCompile).toBe(previousCompile);
    expect(material.customProgramCacheKey).toBe(previousKey);
    material.dispose();
  });

  it("reports duplicate attachment and unsupported custom shader hooks explicitly", () => {
    const material = new THREE.ShaderMaterial({
      vertexShader: "void main(){gl_Position=vec4(0.);}",
      fragmentShader: "void main(){gl_FragColor=vec4(1.);}",
    });
    const mask = createBasinConstructionMask();
    mask.attach(material, "water");
    mask.attach(material, "terrain");
    expect(mask.attachments[1]).toEqual({ ok: false, reason: "already-attached" });
    const shader = compile(material);
    expect(mask.attachments[0]).toEqual({ ok: false, reason: "unsupported-shader-hooks" });
    expect(shader.fragmentShader).toBe(material.fragmentShader);
    material.dispose();
  });

  it("exports bounded GLSL with the CPU transform, shape and independent thresholds", () => {
    expect(BASIN_CONSTRUCTION_MAX_MASKS).toBe(64);
    expect(BASIN_CONSTRUCTION_GLSL).toContain("vec4 maskCenter[64]");
    expect(BASIN_CONSTRUCTION_GLSL).toContain("vec3 maskLevels[64]");
    expect(BASIN_CONSTRUCTION_GLSL).toContain(
      "maskCenter[i].z * delta.x - maskCenter[i].w * delta.y",
    );
    expect(BASIN_CONSTRUCTION_GLSL).toContain("edge.x + edge.y >= 1.0");
    expect(BASIN_CONSTRUCTION_GLSL).toContain("world.y > maskLevels[i].x");
    expect(BASIN_CONSTRUCTION_GLSL).toContain("world.y < maskLevels[i].y");
    expect(BASIN_CONSTRUCTION_GLSL).not.toContain("time");
  });
});
