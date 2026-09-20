import * as THREE from "three";

export const VEGETATION_STYLE_PROVENANCE = "Decorative shared crown shape and ID-based green palette; not observed species or leaf color. Horizontal radius envelope and source centres unchanged.";
export function vegetationHashUnit(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967296;
}
const GREENS = ["#70b45b", "#80ba62", "#5eae70", "#89bb63"];
export function vegetationColor(id: string) {
  return new THREE.Color(GREENS[Math.floor(vegetationHashUnit(id) * GREENS.length)]!);
}

/** Fresh resources per owning group, never global shared GPU objects. 352 crown triangles.
 * Gentle lobes shrink inward from the unit sphere, never beyond the supplied crown radius.
 * Smooth seam/pole normals are welded numerically without changing indexed UV topology.
 */
export function createVegetationStyleResources() {
  const crown = new THREE.SphereGeometry(1, 16, 12), positions = crown.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const lobe = 1 - .035 * (1 + Math.sin(3 * Math.atan2(z, x))) * (1 - y * y);
    positions.setXYZ(i, x * lobe, y, z * lobe);
    const shade = .86 + .14 * (y + 1) / 2;
    colors.set([shade, shade, shade], i * 3);
  }
  crown.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  crown.computeVertexNormals();
  const normals = crown.getAttribute("normal"), shared = new Map<string, { indices: number[]; sum: THREE.Vector3 }>();
  for (let i = 0; i < positions.count; i++) {
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(n => Math.round(n * 1e6)).join("/");
    if (!shared.has(key)) shared.set(key, { indices: [], sum: new THREE.Vector3() });
    const v = shared.get(key)!; v.indices.push(i);
    v.sum.add(new THREE.Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)));
  }
  for (const v of shared.values()) {
    v.sum.normalize();
    for (const i of v.indices) normals.setXYZ(i, v.sum.x, v.sum.y, v.sum.z);
  }
  crown.computeBoundingBox(); crown.computeBoundingSphere();
  return { crown, trunk: new THREE.CylinderGeometry(.15, .2, 1, 8),
    leaf: new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: .82 }),
    bark: new THREE.MeshStandardMaterial({ color: "#886a45", roughness: .95 }) };
}
