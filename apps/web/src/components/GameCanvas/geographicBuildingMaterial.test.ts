import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BUILDING_DECORATION_PROVENANCE, createGeographicBuildingMaterial } from "./geographicBuildingMaterial";

describe("geographic building decoration", () => {
  it("is opaque, texture-free and explicitly illustrative", () => {
    const material = createGeographicBuildingMaterial();
    try {
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(material.vertexColors).toBe(true);
      expect(material.transparent).toBe(false);
      expect(material.depthWrite).toBe(true);
      expect(material.map).toBeNull();
      expect(material.displacementMap).toBeNull();
      expect(material.userData.decoration).toEqual(BUILDING_DECORATION_PROVENANCE);
      expect(material.userData.decoration.source).toBe("illustrative-not-surveyed");
      expect(material.customProgramCacheKey()).toBe("geographic-building-decoration-v1");
    } finally { material.dispose(); }
  });

  it("patches the installed standard shader with filtered facade detail without moving vertices", () => {
    const material = createGeographicBuildingMaterial();
    const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms) };
    try {
      // Hook uses only shader sources/uniforms; renderer-owned compile parameters are not accessed.
      material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
      expect(shader.vertexShader).toContain("attribute vec2 facadeUv;");
      expect(shader.vertexShader).toContain("vRoofMask = step(0.8, abs(normal.y));");
      expect(shader.vertexShader).toContain("#include <project_vertex>");
      expect(shader.vertexShader).not.toMatch(/transformed\s*[+*\-/]?=/);
      expect(shader.fragmentShader).toContain("fwidth(facadeCell)");
      expect(shader.fragmentShader).toContain("smoothstep(450.0, 1800.0, vBuildingDistance)");
      expect(shader.fragmentShader).toContain("#include <lights_physical_fragment>");
      expect(shader.fragmentShader).toContain("#include <colorspace_fragment>");
      expect(shader.fragmentShader.indexOf("float decorativeWindow =")).toBeLessThan(shader.fragmentShader.indexOf("roughnessFactor = mix"));
      expect(shader.fragmentShader).not.toContain("discard");
    } finally { material.dispose(); }
  });
});
