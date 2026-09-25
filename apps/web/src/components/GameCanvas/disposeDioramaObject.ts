import * as THREE from "three";

/** Release resources owned by a scene subtree without removing/reparenting objects.
 * Geometry/material sharing is deduplicated within this call, not across separate roots/calls.
 * Material textures, scene backgrounds and environment textures remain caller-owned.
 * Light.dispose() releases subclass-owned shadow render targets; do not dispose them twice here.
 */
export function disposeDioramaObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if (object instanceof THREE.Light) object.dispose();
    if (mesh.material) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
