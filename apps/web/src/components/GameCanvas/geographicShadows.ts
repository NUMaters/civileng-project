import * as THREE from "three";

/** Translate light and target together so sunlight direction stays constant while the shadow map follows play. */
export function followGeographicShadows(light: THREE.DirectionalLight, focus: THREE.Vector3, force = false) {
  if (!force && light.target.position.distanceToSquared(focus) < 150 * 150) return false;
  light.target.position.copy(focus);
  light.position.copy(focus).add(new THREE.Vector3(-360, 650, 300));
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
  return true;
}
