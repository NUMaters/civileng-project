import * as THREE from "three";
import { geoToWorld, worldToGeo } from "./dioramaSpace";
import { sampleKoriyamaTerrain, type KoriyamaTerrain } from "./koriyamaTerrain";
import { createGeographicTerrainMaterial } from "./geographicTerrainMaterial";

export type RenderedTerrainSurface = {
  originX: number;
  originZ: number;
  maxX: number;
  maxZ: number;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  xCoordinates: Float32Array;
  zCoordinates: Float32Array;
  /** Samples the same piecewise-linear triangle surface emitted by the terrain mesh. */
  sampleRenderedGround: (x: number, z: number) => number | null;
};

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
  const vertexColumns = columns + 1, vertexRows = rows + 1;
  const vertexX = new Float32Array(vertexColumns * vertexRows);
  const vertexY = new Float32Array(vertexColumns * vertexRows);
  const vertexZ = new Float32Array(vertexColumns * vertexRows);
  const gridX = new Float32Array(vertexColumns), gridZ = new Float32Array(vertexRows);
  const vertexValid = new Uint8Array(vertexColumns * vertexRows);
  const vertexIndex = (column: number, row: number) => row * vertexColumns + column;
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const i = vertexIndex(column, row);
    const worldX = a.x + (b.x - a.x) * column / columns;
    const worldZ = a.z + (b.z - a.z) * row / rows;
    gridX[column] = worldX; gridZ[row] = worldZ;
    const y = sampleGround(worldX, worldZ);
    vertexX[i] = worldX;
    vertexZ[i] = worldZ;
    if (y !== null && Number.isFinite(y)) { vertexY[i] = y; vertexValid[i] = 1; }
  }
  const findCell = (values: Float32Array, count: number, value: number) => {
    if (!Number.isFinite(value) || value < values[0]! || value > values[count]!) return -1;
    let low = 0, high = count;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (values[middle]! <= value) low = middle;
      else high = middle;
    }
    return Math.min(count - 1, low);
  };
  const interpolateTriangle = (x: number, z: number, ia: number, ib: number, ic: number): number | null => {
    if (!vertexValid[ia] || !vertexValid[ib] || !vertexValid[ic]) return null;
    const ax = vertexX[ia]!, az = vertexZ[ia]!, ay = vertexY[ia]!;
    const bx = vertexX[ib]!, bz = vertexZ[ib]!, by = vertexY[ib]!;
    const cx = vertexX[ic]!, cz = vertexZ[ic]!, cy = vertexY[ic]!;
    const determinant = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
    const wb = ((x - ax) * (cz - az) - (z - az) * (cx - ax)) / determinant;
    const wc = ((bx - ax) * (z - az) - (bz - az) * (x - ax)) / determinant;
    return ay * (1 - wb - wc) + by * wb + cy * wc;
  };
  const sampleRenderedGround = (x: number, z: number): number | null => {
    const column = findCell(gridX, columns, x), row = findCell(gridZ, rows, z);
    if (column < 0 || row < 0) return null;
    const p00 = vertexIndex(column, row), p01 = vertexIndex(column, row + 1);
    const p10 = vertexIndex(column + 1, row), p11 = vertexIndex(column + 1, row + 1);
    const fx = (x - vertexX[p00]!) / (vertexX[p10]! - vertexX[p00]!);
    const fz = (z - vertexZ[p00]!) / (vertexZ[p01]! - vertexZ[p00]!);
    return fx + fz <= 1
      ? interpolateTriangle(x, z, p00, p01, p10)
      : interpolateTriangle(x, z, p10, p01, p11);
  };
  const renderedSurface: RenderedTerrainSurface = {
    originX: vertexX[0]!, originZ: vertexZ[0]!, maxX: gridX[columns]!, maxZ: gridZ[rows]!,
    columns, rows, cellWidth: (gridX[columns]! - gridX[0]!) / columns,
    cellHeight: (gridZ[rows]! - gridZ[0]!) / rows, xCoordinates: gridX, zCoordinates: gridZ, sampleRenderedGround,
  };
  const group = new THREE.Group();
  group.name = "gsi-measured-terrain";
  group.userData.provenance = {
    source: "GSI DEM", localDatumM: terrain.metadata.localDatumM,
    spacingMeters, verticalExaggeration: 1, missingData: "holes-not-filled",
  };
  const material = createGeographicTerrainMaterial();
  let triangles = 0, missingTriangles = 0;
  // Independent bounded tiles keep frustum culling effective on mobile.
  for (let row = 0; row < rows; row += 32) {
    for (let column = 0; column < columns; column += 32) {
      const width = Math.min(32, columns - column), height = Math.min(32, rows - row);
      // One-cell halo supplies ALL incident triangles at tile-edge vertices. This is the same
      // area-weighted normal as a single global mesh, with at most 35*35 temporary vertices.
      const startX = Math.max(0, column - 1), startZ = Math.max(0, row - 1);
      const endX = Math.min(columns, column + width + 1), endZ = Math.min(rows, row + height + 1);
      const stride = endX - startX + 1, haloRows = endZ - startZ + 1;
      const haloPositions = new Float32Array(stride * haloRows * 3);
      const haloValid = new Uint8Array(stride * haloRows);
      const sums = new Float64Array(stride * haloRows * 3);
      const haloIndex = (x: number, z: number) => (z - startZ) * stride + x - startX;
      for (let z = startZ; z <= endZ; z++) for (let x = startX; x <= endX; x++) {
        const source = vertexIndex(x, z), i = haloIndex(x, z);
        haloPositions[i * 3] = vertexX[source]!; haloPositions[i * 3 + 1] = vertexY[source]!; haloPositions[i * 3 + 2] = vertexZ[source]!;
        haloValid[i] = vertexValid[source]!;
      }
      const addNormal = (i: number, nx: number, ny: number, nz: number) => {
        sums[i * 3] = sums[i * 3]! + nx;
        sums[i * 3 + 1] = sums[i * 3 + 1]! + ny;
        sums[i * 3 + 2] = sums[i * 3 + 2]! + nz;
      };
      const accumulate = (a: number, b: number, c: number) => {
        if (!haloValid[a] || !haloValid[b] || !haloValid[c]) return;
        const ax = haloPositions[a * 3]!, ay = haloPositions[a * 3 + 1]!, az = haloPositions[a * 3 + 2]!;
        const ux = haloPositions[b * 3]! - ax, uy = haloPositions[b * 3 + 1]! - ay, uz = haloPositions[b * 3 + 2]! - az;
        const vx = haloPositions[c * 3]! - ax, vy = haloPositions[c * 3 + 1]! - ay, vz = haloPositions[c * 3 + 2]! - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        addNormal(a, nx, ny, nz);
        addNormal(b, nx, ny, nz);
        addNormal(c, nx, ny, nz);
      };
      // Global row/column order makes floating-point accumulation identical on both sides.
      for (let z = startZ; z < endZ; z++) for (let x = startX; x < endX; x++) {
        const p = haloIndex(x, z);
        accumulate(p, p + stride, p + 1);
        accumulate(p + 1, p + stride, p + stride + 1);
      }
      const positions: number[] = [], indices: number[] = [], valid: boolean[] = [];
      const normals: number[] = [];
      for (let j = 0; j <= height; j++) for (let i = 0; i <= width; i++) {
        const h = haloIndex(column + i, row + j);
        // Missing samples have unused vertices; no triangles may reference them.
        positions.push(haloPositions[h * 3]!, haloPositions[h * 3 + 1]!, haloPositions[h * 3 + 2]!); valid.push(haloValid[h] === 1);
        const nx = sums[h * 3]!, ny = sums[h * 3 + 1]!, nz = sums[h * 3 + 2]!;
        const length = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / length, ny / length, nz / length);
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
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `ground-${column}-${row}`;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (!group.children.length) material.dispose();
  return { group, sampleGround, sampleRenderedGround, renderedSurface, bounds: { minX: a.x, minZ: a.z, maxX: b.x, maxZ: b.z },
    stats: { triangles, missingTriangles, tiles: group.children.length } };
}
