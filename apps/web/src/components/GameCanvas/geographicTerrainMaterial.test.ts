import * as THREE from "three";
import { expect, it } from "vitest";
import { createGeographicTerrainMaterial } from "./geographicTerrainMaterial";

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
  expect(shader.fragmentShader).toContain("#include <lights_physical_fragment>");
  expect(shader.fragmentShader).toContain("#include <colorspace_fragment>");
  expect(material.userData.provenance).toContain("no observed vegetation");
  material.dispose();
});
