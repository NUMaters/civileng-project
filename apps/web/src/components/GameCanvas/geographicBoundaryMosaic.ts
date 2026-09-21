import * as THREE from "three";

type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

/**
 * A low-detail, non-interactive surround for the fixed play area. It deliberately
 * carries no buildings or geographic claims: the softened tiles only prevent the
 * cropped terrain from ending as a hard rectangular void.
 */
export function createGeographicBoundaryMosaic(
  bounds: Bounds,
  sampleGround: (x: number, z: number) => number | null,
  tileSize = 100,
  depth = 400,
) {
  if (![...Object.values(bounds), tileSize, depth].every(Number.isFinite) ||
      bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ || tileSize < 25 || depth < tileSize)
    throw new RangeError("Invalid boundary mosaic options");
  const columns = Math.ceil((bounds.maxX - bounds.minX + depth * 2) / tileSize);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ + depth * 2) / tileSize);
  const originX = bounds.minX - depth;
  const originZ = bounds.minZ - depth;
  const palettes = ["#88aa72", "#78986f", "#91a985", "#6f8c72"];
  const matrices = palettes.map(() => [] as THREE.Matrix4[]);
  const dummy = new THREE.Object3D();
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = originX + (column + 0.5) * tileSize;
    const z = originZ + (row + 0.5) * tileSize;
    if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) continue;
    const nearestX = THREE.MathUtils.clamp(x, bounds.minX + 1, bounds.maxX - 1);
    const nearestZ = THREE.MathUtils.clamp(z, bounds.minZ + 1, bounds.maxZ - 1);
    const ground = sampleGround(nearestX, nearestZ) ?? 0;
    const edgeDistance = Math.hypot(x - nearestX, z - nearestZ);
    dummy.position.set(x, ground - 3 - edgeDistance * 0.012, z);
    dummy.scale.set(tileSize * 0.98, 4, tileSize * 0.98);
    dummy.updateMatrix();
    matrices[(column * 17 + row * 31) % palettes.length]!.push(dummy.matrix.clone());
  }
  const group = new THREE.Group();
  group.name = "fixed-map-boundary-mosaic";
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  matrices.forEach((items, paletteIndex) => {
    if (!items.length) return;
    const material = new THREE.MeshStandardMaterial({
      color: palettes[paletteIndex],
      roughness: 1,
      transparent: true,
      opacity: 0.72,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mesh.name = `boundary-mosaic-${paletteIndex}`;
    items.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  group.userData = {
    role: "visual-boundary-only",
    geography: "none",
    playableBounds: { ...bounds },
    tileSize,
    depth,
  };
  return group;
}
