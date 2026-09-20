import * as THREE from "three";
import { geoToWorld, worldToGeo } from "./dioramaSpace";
import { sampleKoriyamaTerrain, type KoriyamaTerrain } from "./koriyamaTerrain";

/** A measured ground surface, not bathymetry or bridge-deck geometry. */
export function createGeographicTerrain(terrain: KoriyamaTerrain, spacingMeters = 12) {
  if (!Number.isFinite(spacingMeters) || spacingMeters < 5 || spacingMeters > 100)
    throw new RangeError("Terrain spacing must be between 5 and 100 metres");
  const [west, south, east, north] = terrain.metadata.bounds as [number, number, number, number];
  const a = geoToWorld(west, north), b = geoToWorld(east, south);
  const columns = Math.ceil((b.x - a.x) / spacingMeters);
  const rows = Math.ceil((b.z - a.z) / spacingMeters);
  const sampleGround = (x: number, z: number): number | null => {
    const p = worldToGeo(x, z);
    return sampleKoriyamaTerrain(terrain, p.longitude, p.latitude).localY;
  };
  const group = new THREE.Group();
  group.name = "gsi-measured-terrain";
  group.userData.provenance = {
    source: "GSI DEM", localDatumM: terrain.metadata.localDatumM,
    spacingMeters, verticalExaggeration: 1, missingData: "holes-not-filled",
  };
  const material = new THREE.MeshStandardMaterial({ color: "#91be72", roughness: 0.95 });
  let triangles = 0, missingTriangles = 0;
  // Independent bounded tiles keep frustum culling effective on mobile.
  for (let row = 0; row < rows; row += 32) {
    for (let column = 0; column < columns; column += 32) {
      const width = Math.min(32, columns - column), height = Math.min(32, rows - row);
      const positions: number[] = [], indices: number[] = [], valid: boolean[] = [];
      for (let j = 0; j <= height; j++) for (let i = 0; i <= width; i++) {
        const x = a.x + (b.x - a.x) * (column + i) / columns;
        const z = a.z + (b.z - a.z) * (row + j) / rows;
        const y = sampleGround(x, z);
        // Missing samples have unused vertices; no triangles may reference them.
        positions.push(x, y ?? 0, z); valid.push(y !== null);
      }
      const emit = (x: number, y: number, z: number) => {
        if (valid[x] && valid[y] && valid[z]) { indices.push(x, y, z); triangles++; }
        else missingTriangles++;
      };
      for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
        const p = j * (width + 1) + i;
        emit(p, p + width + 1, p + 1);
        emit(p + 1, p + width + 1, p + width + 2);
      }
      if (!indices.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `ground-${column}-${row}`;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (!group.children.length) material.dispose();
  return { group, sampleGround, bounds: { minX: a.x, minZ: a.z, maxX: b.x, maxZ: b.z },
    stats: { triangles, missingTriangles, tiles: group.children.length } };
}
