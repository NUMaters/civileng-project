import { expect, it } from "vitest";
import type { RenderedTerrainSurface } from "./geographicTerrain";
import { inlandTerrainTriangles } from "./inlandTerrainTriangles";

// Two actual triangle planes meet at x+z=12, with a sharp crest along that
// diagonal. A different fan over their samples underestimates this ridge.
const sample = (x: number, z: number) => x + z <= 12 ? (x + z) / 3 : (24 - x - z) / 3;
const surface: RenderedTerrainSurface = { originX: 0, originZ: 0, maxX: 12, maxZ: 12,
  columns: 1, rows: 1, cellWidth: 12, cellHeight: 12,
  xCoordinates: new Float32Array([0, 12]), zCoordinates: new Float32Array([0, 12]), sampleRenderedGround: sample };

it("splits a 4m footprint at a folded terrain diagonal, preserving height throughout triangle interiors", () => {
  const vertices = inlandTerrainTriangles(surface, 4, 4, 8, 8, sample)!;
  let area = 0;
  for (let i = 0; i < vertices.length; i += 9) {
    const ax = vertices[i]!, ay = vertices[i + 1]!, az = vertices[i + 2]!;
    const bx = vertices[i + 3]!, by = vertices[i + 4]!, bz = vertices[i + 5]!;
    const cx = vertices[i + 6]!, cy = vertices[i + 7]!, cz = vertices[i + 8]!;
    area += Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
    for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10 - a; b++) {
      const u = a / 10, v = b / 10, w = 1 - u - v;
      expect(ay * u + by * v + cy * w).toBeCloseTo(sample(ax * u + bx * v + cx * w, az * u + bz * v + cz * w), 12);
    }
  }
  expect(area).toBeCloseTo(16, 12);
  expect(vertices.length).toBeLessThanOrEqual(40 * 9);
});

it("fails closed for missing terrain, outside domain, and excessive terrain-cell coverage", () => {
  expect(inlandTerrainTriangles(surface, 4, 4, 8, 8, () => null)).toBeNull();
  expect(inlandTerrainTriangles(surface, -1, 4, 3, 8, sample)).toBeNull();
  const dense = { ...surface, xCoordinates: new Float32Array([0, 1, 2, 3, 4, 12]),
    zCoordinates: new Float32Array([0, 1, 2, 3, 4, 12]), columns: 5, rows: 5 };
  expect(inlandTerrainTriangles(dense, 0, 0, 4, 4, sample)).toBeNull();
});

it("rejects nonfinite/reversed footprints and inconsistent mesh-grid metadata", () => {
  for (const box of [[NaN, 4, 8, 8], [4, 4, Infinity, 8], [8, 4, 4, 8], [4, 4, 4, 8]]) {
    expect(inlandTerrainTriangles(surface, box[0]!, box[1]!, box[2]!, box[3]!, sample)).toBeNull();
  }
  for (const altered of [{ ...surface, columns: 2 }, { ...surface, originX: 0.1 },
    { ...surface, cellWidth: NaN }, { ...surface, xCoordinates: new Float32Array([0, NaN]) }]) {
    expect(inlandTerrainTriangles(altered, 4, 4, 8, 8, sample)).toBeNull();
  }
  expect(inlandTerrainTriangles(surface, 4, 4, 8, 8, () => NaN)).toBeNull();
});

it("retains exact domain edges without sampling outside and rejects partial out-of-domain clipping", () => {
  let samples = 0;
  const atEdge = inlandTerrainTriangles(surface, 8, 8, 12, 12, (x, z) => {
    expect(x >= 8 && x <= 12 && z >= 8 && z <= 12).toBe(true); samples++; return sample(x, z);
  });
  expect(atEdge).not.toBeNull(); expect(samples).toBeGreaterThan(0);
  expect(inlandTerrainTriangles(surface, 8, 8, 12.00001, 12, sample)).toBeNull();
});
