import * as THREE from "three";

/** Decorative ground treatment only: neither satellite classification nor observed vegetation. */
export function createGeographicTerrainMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: "#79af60", roughness: 0.95 });
  material.name = "geographic-ground-relief";
  material.userData.provenance = "Illustrative ground color variation; no observed vegetation or land-use inference; DEM vertices unchanged";
  material.customProgramCacheKey = () => "geographic-ground-relief-v1";
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
varying vec2 vGroundPosition;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vGroundPosition = (modelMatrix * vec4(position, 1.0)).xz;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
varying vec2 vGroundPosition;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
// Fixed world-space variation remains continuous across terrain tiles and cameras.
vec2 groundP = vGroundPosition;
float broadTone = sin(groundP.x * 0.023 + sin(groundP.y * 0.017) * 1.7)
  * sin(groundP.y * 0.031 - groundP.x * 0.009);
float grainFade = 1.0 - smoothstep(0.6, 2.5, length(fwidth(groundP)));
float grain = sin(groundP.x * 1.3 + groundP.y * 0.7)
  * sin(groundP.y * 1.1 - groundP.x * 0.4) * grainFade;
diffuseColor.rgb *= 1.0 + broadTone * 0.085 + grain * 0.025;`);
  };
  return material;
}
