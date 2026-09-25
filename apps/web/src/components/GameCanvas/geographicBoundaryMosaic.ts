import * as THREE from "three";

type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

const FADE_BANDS = 4;
const groundColors = [0x87a974, 0x7f9f78, 0x91aa87, 0x769477];
const buildingColors = [0xc8d0c9, 0xbcc9c9, 0xd4d3c5, 0xaebfc2];

function hash(column: number, row: number, salt: number) {
  const value = Math.sin(column * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Non-interactive scenery beyond the fixed play area. The near edge retains a
 * simplified town silhouette while successive translucent bands are washed
 * towards the sky colour. Generated blocks are visual continuity, not map data.
 */
export function createGeographicBoundaryMosaic(
  bounds: Bounds,
  sampleGround: (x: number, z: number) => number | null,
  tileSize = 100,
  depth = 800,
) {
  if (![...Object.values(bounds), tileSize, depth].every(Number.isFinite) ||
      bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ || tileSize < 25 || depth < tileSize)
    throw new RangeError("Invalid boundary mosaic options");

  const columns = Math.ceil((bounds.maxX - bounds.minX + depth * 2) / tileSize);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ + depth * 2) / tileSize);
  const originX = bounds.minX - depth;
  const originZ = bounds.minZ - depth;
  const groundBands = Array.from({ length: FADE_BANDS }, () => [] as THREE.Matrix4[]);
  const groundBandColors = Array.from({ length: FADE_BANDS }, () => [] as THREE.Color[]);
  const buildingBands = Array.from({ length: FADE_BANDS }, () => [] as THREE.Matrix4[]);
  const buildingBandColors = Array.from({ length: FADE_BANDS }, () => [] as THREE.Color[]);
  const dummy = new THREE.Object3D();

  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = originX + (column + 0.5) * tileSize;
    const z = originZ + (row + 0.5) * tileSize;
    if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) continue;
    const nearestX = THREE.MathUtils.clamp(x, bounds.minX + 1, bounds.maxX - 1);
    const nearestZ = THREE.MathUtils.clamp(z, bounds.minZ + 1, bounds.maxZ - 1);
    const ground = sampleGround(nearestX, nearestZ) ?? 0;
    const edgeDistance = Math.hypot(x - nearestX, z - nearestZ);
    const band = Math.min(FADE_BANDS - 1, Math.floor(edgeDistance / depth * FADE_BANDS));
    const fade = THREE.MathUtils.clamp(edgeDistance / depth, 0, 1);

    dummy.position.set(x, ground - 2.5 - edgeDistance * 0.008, z);
    dummy.scale.set(tileSize * 1.01, 3, tileSize * 1.01);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    groundBands[band]!.push(dummy.matrix.clone());
    groundBandColors[band]!.push(new THREE.Color(groundColors[(column * 17 + row * 31) % groundColors.length]!).lerp(new THREE.Color(0x8fcfe3), fade * 0.88));

    const buildingCount = hash(column, row, 1) > 0.38 ? 2 : 1;
    for (let index = 0; index < buildingCount; index++) {
      const width = tileSize * (0.18 + hash(column, row, index + 2) * 0.18);
      const length = tileSize * (0.18 + hash(column, row, index + 5) * 0.2);
      const height = 7 + hash(column, row, index + 8) * 18;
      const offsetX = (hash(column, row, index + 11) - 0.5) * tileSize * 0.48;
      const offsetZ = (hash(column, row, index + 14) - 0.5) * tileSize * 0.48;
      dummy.position.set(x + offsetX, ground + height / 2 - edgeDistance * 0.008, z + offsetZ);
      dummy.scale.set(width, height, length);
      dummy.rotation.set(0, hash(column, row, index + 17) > 0.5 ? Math.PI / 2 : 0, 0);
      dummy.updateMatrix();
      buildingBands[band]!.push(dummy.matrix.clone());
      buildingBandColors[band]!.push(new THREE.Color(buildingColors[(column + row + index) % buildingColors.length]!).lerp(new THREE.Color(0xaad4df), fade * 0.82));
    }
  }

  const group = new THREE.Group();
  group.name = "fixed-map-boundary-haze";
  const groundGeometry = new THREE.BoxGeometry(1, 1, 1);
  const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
  const addBand = (kind: "ground" | "building", band: number, matrices: THREE.Matrix4[], colors: THREE.Color[]) => {
    if (!matrices.length) return;
    const opacity = kind === "ground" ? 1 : [0.62, 0.42, 0.24, 0.09][band]!;
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, fog: true,
      transparent: kind === "building", opacity, depthWrite: kind === "ground" || band < 2,
    });
    const mesh = new THREE.InstancedMesh(kind === "ground" ? groundGeometry : buildingGeometry, material, matrices.length);
    mesh.name = `boundary-haze-${kind}-${band}`;
    matrices.forEach((matrix, index) => { mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, colors[index]!); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = false;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  for (let band = 0; band < FADE_BANDS; band++) {
    addBand("ground", band, groundBands[band]!, groundBandColors[band]!);
    addBand("building", band, buildingBands[band]!, buildingBandColors[band]!);
  }
  const sampledHeights = [
    sampleGround(bounds.minX + 1, bounds.minZ + 1),
    sampleGround(bounds.maxX - 1, bounds.minZ + 1),
    sampleGround(bounds.minX + 1, bounds.maxZ - 1),
    sampleGround(bounds.maxX - 1, bounds.maxZ - 1),
  ].filter((height): height is number => height !== null && Number.isFinite(height));
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(10_000, 10_000),
    new THREE.MeshBasicMaterial({ color: 0x70cff1, fog: false }),
  );
  backdrop.name = "boundary-sky-backdrop";
  backdrop.rotation.x = -Math.PI / 2;
  backdrop.position.set((bounds.minX + bounds.maxX) / 2, Math.min(...sampledHeights, 0) - 120, (bounds.minZ + bounds.maxZ) / 2);
  group.add(backdrop);
  group.userData = {
    role: "visual-boundary-only",
    effect: "atmospheric-depth-fade",
    geography: "none",
    playableBounds: { ...bounds },
    tileSize,
    depth,
    fadeBands: FADE_BANDS,
    generatedBuildingCount: buildingBands.reduce((sum, items) => sum + items.length, 0),
    backdrop: "sky-blue",
  };
  return group;
}
