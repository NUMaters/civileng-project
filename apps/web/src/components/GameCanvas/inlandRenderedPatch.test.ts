import { expect, it } from "vitest";
import { BufferAttribute } from "three";
import { inlandRenderedPatch } from "./inlandRenderedPatch";
import { createInlandWaterMaterial, inlandWaterAlpha } from "./inlandWaterMaterial";

const p = new BufferAttribute(new Float32Array([
  -100, 2, -100, 100, 2, -100, 0, 2, 100,
  10, 2, 10, 14, 2, 10, 10, 2, 14,
  NaN, NaN, NaN,
]), 3);
it("ignores unused capacity and fully faded triangles; anchors inside actual visible geometry", () => {
  const appearance = new BufferAttribute(new Float32Array([1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, NaN, NaN]), 2);
  const patch = inlandRenderedPatch("same-source", p, appearance, 6)!;
  expect(patch.id).toBe("inland:same-source"); expect(patch.vertexCount).toBe(3);
  expect(patch.bounds).toEqual({ minX: 10, maxX: 14, minZ: 10, maxZ: 14, minY: 2, maxY: 2 });
  expect(patch.anchor.x).toBeGreaterThan(10); expect(patch.anchor.z).toBeGreaterThan(10);
  expect(patch.anchor.x + patch.anchor.z).toBeLessThan(24);
  expect(Object.isFrozen(patch)).toBe(true); expect(Object.isFrozen(patch.bounds)).toBe(true);
  expect(inlandRenderedPatch("bad", p, appearance, 7)).toBeNull();
  appearance.array.fill(0); expect(inlandRenderedPatch("hidden", p, appearance, 6)).toBeNull();
});

it("mirrors the unchanged shader alpha, including shallow and edge discard cases", () => {
  expect(inlandWaterAlpha(1, 0)).toBe(0); expect(inlandWaterAlpha(0.04, 1)).toBe(0);
  expect(inlandWaterAlpha(1.8, 1)).toBeCloseTo(0.82);
  expect(inlandWaterAlpha(0.12, 0.5)).toBeCloseTo(0.25 * (0.48 + 0.34 * ((0.08 / 1.76) ** 2 * (3 - 2 * 0.08 / 1.76))));
  expect(inlandWaterAlpha(NaN, 1)).toBe(0);
  const material = createInlandWaterMaterial();
  expect(material.fragmentShader).toContain("edge * smoothstep(0.04, 0.20, depth) * mix(0.48, 0.82, deep)");
  expect(material.fragmentShader).toContain("smoothstep(0.04, 1.8, depth)");
  expect(material.fragmentShader).toContain("if (alpha < 0.003) discard");
  material.dispose();
});
