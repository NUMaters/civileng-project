import * as THREE from "three";
import { GEOGRAPHIC_MATERIAL_PALETTE } from "./geographicMaterialPalette";

/** Optical readability, not a land classification or elevation correction.
 * sin(inclination) keeps gentle measured slopes legible. The former 1-normal.y
 * ramp was insensitive near horizontal ground, beginning at about 11.5deg.
 */
export const GEOGRAPHIC_TERRAIN_RELIEF_STYLE = {
  startDegrees: 3,
  fullDegrees: 18,
  slopeMultiplier: [0.64, 0.76, 0.70] as const,
  broadVariation: 0.012,
  grainVariation: 0.006,
} as const;

/** Decorative ground treatment only: neither satellite classification nor observed vegetation. */
export function createGeographicTerrainMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: GEOGRAPHIC_MATERIAL_PALETTE.ground, roughness: 0.92 });
  material.name = "geographic-ground-relief";
  material.userData.provenance = "Illustrative ground palette and actual-normal slope tint; no observed vegetation or land-use inference; DEM vertices and normals unchanged";
  material.customProgramCacheKey = () => "geographic-ground-relief-v3-measured-slope";
  material.onBeforeCompile = shader => {
    const style = GEOGRAPHIC_TERRAIN_RELIEF_STYLE;
    shader.uniforms.groundSlopeRange = { value: new THREE.Vector2(
      Math.sin(THREE.MathUtils.degToRad(style.startDegrees)), Math.sin(THREE.MathUtils.degToRad(style.fullDegrees))) };
    shader.uniforms.groundSlopeMultiplier = { value: new THREE.Vector3(...style.slopeMultiplier) };
    shader.uniforms.groundVariation = { value: new THREE.Vector2(style.broadVariation, style.grainVariation) };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
varying vec2 vGroundPosition;
varying vec3 vGroundNormal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vGroundPosition = (modelMatrix * vec4(position, 1.0)).xz;
// Terrain uses identity scale: source normal controls tint, never synthetic elevation.
vGroundNormal = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
varying vec2 vGroundPosition;
varying vec3 vGroundNormal;
uniform vec2 groundSlopeRange;
uniform vec3 groundSlopeMultiplier;
uniform vec2 groundVariation;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
// Fixed world-space variation remains continuous across terrain tiles and cameras.
vec2 groundP = vGroundPosition;
float broadTone = sin(groundP.x * 0.023 + sin(groundP.y * 0.017) * 1.7)
  * sin(groundP.y * 0.031 - groundP.x * 0.009);
float grainFade = 1.0 - smoothstep(0.6, 2.5, length(fwidth(groundP)));
float grain = sin(groundP.x * 1.3 + groundP.y * 0.7)
  * sin(groundP.y * 1.1 - groundP.x * 0.4) * grainFade;
diffuseColor.rgb *= 1.0 + broadTone * groundVariation.x + grain * groundVariation.y;
// sin(inclination) resolves the measured gentle banks instead of squaring away
// their relief near normal.y=1. Continuous, world-normal based, no height bands,
// changed source normals, synthetic bank geometry or camera-dependent tint.
float sourceSlope = length(normalize(vGroundNormal).xz);
float slopeTone = smoothstep(groundSlopeRange.x, groundSlopeRange.y, sourceSlope);
diffuseColor.rgb *= mix(vec3(1.0), groundSlopeMultiplier, slopeTone);`);
  };
  return material;
}
