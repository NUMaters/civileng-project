import * as THREE from "three";
import { expect, it } from "vitest";
import { createGeographicTerrainMaterial, GEOGRAPHIC_TERRAIN_RELIEF_STYLE } from "./geographicTerrainMaterial";

it("uses a shared texture-free ground treatment without altering measured geometry", () => {
  const material = createGeographicTerrainMaterial();
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms) };
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
  expect(material.transparent).toBe(false);
  expect(material.map).toBeNull();
  expect(material.displacementMap).toBeNull();
  expect(shader.vertexShader).not.toMatch(/transformed\s*[+*\-/]?=/);
  expect(shader.vertexShader).toContain("modelMatrix * vec4(position, 1.0)");
  expect(shader.fragmentShader).toContain("length(fwidth(groundP))");
  expect(shader.vertexShader).toContain("normalize(mat3(modelMatrix) * normal)");
  expect(shader.fragmentShader).toContain("length(normalize(vGroundNormal).xz)");
  expect(shader.fragmentShader).toContain("smoothstep(groundSlopeRange.x, groundSlopeRange.y, sourceSlope)");
  expect(material.customProgramCacheKey()).toBe("geographic-ground-relief-v3-measured-slope");
  expect(material.color).toEqual(new THREE.Color("#82c947"));
  expect(shader.fragmentShader).toContain("#include <lights_physical_fragment>");
  expect(shader.fragmentShader).toContain("#include <colorspace_fragment>");
  expect(material.userData.provenance).toContain("no observed vegetation");
  material.dispose();
});

it("makes measured gentle-bank slopes readable while preserving flat-ground color and bounded contrast", () => {
  const material = createGeographicTerrainMaterial();
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms) };
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
  const range = shader.uniforms.groundSlopeRange!.value as THREE.Vector2;
  const multiplier = shader.uniforms.groundSlopeMultiplier!.value as THREE.Vector3;
  const variation = shader.uniforms.groundVariation!.value as THREE.Vector2;
  for (const name of ["groundSlopeRange", "groundSlopeMultiplier", "groundVariation"]) {
    expect(shader.fragmentShader).toMatch(new RegExp(`uniform vec[23] ${name};`));
  }
  const greenContrast = (degrees: number) => (1 - multiplier.y) * THREE.MathUtils.smoothstep(Math.sin(THREE.MathUtils.degToRad(degrees)), range.x, range.y);
  expect(greenContrast(0)).toBe(0); expect(greenContrast(3)).toBe(0);
  expect(greenContrast(7.25)).toBeGreaterThan(0.045);
  expect(greenContrast(7.25)).toBeLessThan(0.055);
  expect(greenContrast(16.42)).toBeGreaterThan(0.23);
  expect(greenContrast(18)).toBeCloseTo(0.24);
  for (let angle = 0; angle <= 90; angle++) {
    expect(greenContrast(angle)).toBeGreaterThanOrEqual(0);
    expect(greenContrast(angle)).toBeLessThanOrEqual(0.24);
  }
  expect(variation.x + variation.y).toBeLessThan(greenContrast(7.25));
  expect(variation.x).toBe(GEOGRAPHIC_TERRAIN_RELIEF_STYLE.broadVariation);
  // StandardMaterial already declares optional texture/camera paths; the
  // relief injection must not add any beyond that unchanged standard shader.
  for (const token of ["sampler2D", "cameraPosition"]) {
    expect(shader.fragmentShader.split(token).length).toBe(THREE.ShaderLib.standard.fragmentShader.split(token).length);
  }
  expect(shader.vertexShader).not.toMatch(/objectNormal\s*[+*\-/]?=/);
  material.dispose();
});
