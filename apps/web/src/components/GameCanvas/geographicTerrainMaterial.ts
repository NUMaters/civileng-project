import * as THREE from "three";

/** Decorative ground treatment only: neither satellite classification nor observed vegetation. */
export function createGeographicTerrainMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: "#78bc4d", roughness: 0.92 });
  material.name = "geographic-ground-relief";
  material.userData.provenance = "Illustrative ground palette and actual-normal slope tint; no observed vegetation or land-use inference; DEM vertices and normals unchanged";
  material.customProgramCacheKey = () => "geographic-ground-relief-v2-vivid";
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
varying vec2 vGroundPosition;
varying vec3 vGroundNormal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vGroundPosition = (modelMatrix * vec4(position, 1.0)).xz;
// Terrain uses identity scale: source normal controls tint, never synthetic elevation.
vGroundNormal = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
varying vec2 vGroundPosition;
varying vec3 vGroundNormal;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
// Fixed world-space variation remains continuous across terrain tiles and cameras.
vec2 groundP = vGroundPosition;
float broadTone = sin(groundP.x * 0.023 + sin(groundP.y * 0.017) * 1.7)
  * sin(groundP.y * 0.031 - groundP.x * 0.009);
float grainFade = 1.0 - smoothstep(0.6, 2.5, length(fwidth(groundP)));
float grain = sin(groundP.x * 1.3 + groundP.y * 0.7)
  * sin(groundP.y * 1.1 - groundP.x * 0.4) * grainFade;
diffuseColor.rgb *= 1.0 + broadTone * 0.045 + grain * 0.015;
// Gentle color separation only on existing slopes, not invented banks or land classes.
float sourceSlope = 1.0 - clamp(normalize(vGroundNormal).y, 0.0, 1.0);
float slopeTone = smoothstep(0.02, 0.28, sourceSlope);
diffuseColor.rgb *= mix(vec3(1.0), vec3(0.78, 0.90, 0.94), slopeTone * 0.55);`);
  };
  return material;
}
