import * as THREE from "three";

export const BUILDING_DECORATION_PROVENANCE = {
  source: "illustrative-not-surveyed",
  details: "Roof colors, seams and window rows are decorative; not observed materials, openings or floor counts.",
  geometry: "Unchanged footprint, holes and LOD1 model height; no displacement or added geometry.",
} as const;

/** One opaque, texture-free material for every building batch; standard lighting/shadows remain. */
export function createGeographicBuildingMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, side: THREE.DoubleSide });
  material.name = "geographic-building-decoration";
  material.userData.decoration = BUILDING_DECORATION_PROVENANCE;
  material.customProgramCacheKey = () => "geographic-building-decoration-v1";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
attribute vec2 facadeUv;
varying vec2 vFacadeUv;
varying float vRoofMask;
varying float vBuildingDistance;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vFacadeUv = facadeUv;
vRoofMask = step(0.8, abs(normal.y));`)
      .replace("#include <project_vertex>", `#include <project_vertex>
vBuildingDistance = length(mvPosition.xyz);`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
varying vec2 vFacadeUv;
varying float vRoofMask;
varying float vBuildingDistance;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
// Evaluate derivatives outside conditionals, before fract, for stable minification.
vec2 facadeCell = vFacadeUv / vec2(3.2, 3.0);
vec2 facadeAA = max(fwidth(facadeCell), vec2(0.0001));
vec2 facadeBox = abs(fract(facadeCell) - 0.5);
vec2 windowMask = vec2(1.0) - smoothstep(vec2(0.23, 0.26) - facadeAA, vec2(0.23, 0.26) + facadeAA, facadeBox);
vec2 frameMask = vec2(1.0) - smoothstep(vec2(0.28, 0.31) - facadeAA, vec2(0.28, 0.31) + facadeAA, facadeBox);
float detailFade = (1.0 - smoothstep(0.10, 0.35, max(facadeAA.x, facadeAA.y))) * (1.0 - smoothstep(450.0, 1800.0, vBuildingDistance));
float decorativeWindow = windowMask.x * windowMask.y * detailFade * (1.0 - vRoofMask);
float decorativeFrame = frameMask.x * frameMask.y * detailFade * (1.0 - vRoofMask);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72, decorativeFrame);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.28, 0.36), decorativeWindow * 0.88);
float roofCell = vFacadeUv.x / 1.6;
float roofAA = max(fwidth(roofCell), 0.0001);
float roofSeam = 1.0 - smoothstep(0.025 - roofAA, 0.025 + roofAA, abs(fract(roofCell) - 0.5));
diffuseColor.rgb *= 1.0 - 0.13 * roofSeam * vRoofMask * detailFade;`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.38, decorativeWindow);`);
  };
  return material;
}
