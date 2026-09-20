import { describe, expect, it } from "vitest";
import { getStructureFootprintMeters, getStructureModelParts } from "./structureModels";

const STRUCTURE_IDS = [
  "levee",
  "retention-basin",
  "drainage-pump",
  "revetment",
  "channel-dredging",
] as const;

describe("getStructureModelParts", () => {
  it("5 施設すべてに複数パーツとマテリアル種別がある", () => {
    for (const id of STRUCTURE_IDS) {
      const parts = getStructureModelParts(id);
      expect(parts.length).toBeGreaterThanOrEqual(3);
      for (const part of parts) {
        expect(part.material).toBeTruthy();
        expect(part.centerHeight).toBeGreaterThan(0);
      }
    }
  });

  it("keeps all five silhouettes within the original 25 entity budget", () => {
    expect(STRUCTURE_IDS.flatMap(getStructureModelParts).length).toBeLessThanOrEqual(25);
  });

  it("uses closed, consistently wound, nondegenerate meshes within declared bounds", () => {
    for (const part of STRUCTURE_IDS.flatMap(getStructureModelParts)) {
      if (part.kind !== "mesh") continue;
      const { positions, indices } = part.mesh!;
      const edges = new Map<string, number[]>();
      expect(indices.length % 3).toBe(0);
      for (const [x, y, z] of positions) {
        expect(Math.abs(x)).toBeLessThanOrEqual(part.dimensions!.length / 2 + 1e-9);
        expect(Math.abs(y)).toBeLessThanOrEqual(part.dimensions!.width / 2 + 1e-9);
        expect(Math.abs(z)).toBeLessThanOrEqual(part.dimensions!.height / 2 + 1e-9);
        expect(z + part.centerHeight).toBeGreaterThanOrEqual(0);
      }
      let volume = 0;
      for (let i = 0; i < indices.length; i += 3) {
        const triangle = indices.slice(i, i + 3);
        for (const index of triangle) {
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(positions.length);
        }
        const [a, b, c] = triangle.map((index) => positions[index]);
        const u = b.map((value, axis) => value - a[axis]);
        const v = c.map((value, axis) => value - a[axis]);
        const cross = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ];
        expect(Math.hypot(...cross)).toBeGreaterThan(1e-6);
        volume +=
          a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0]);
        for (let edge = 0; edge < 3; edge += 1) {
          const from = triangle[edge];
          const to = triangle[(edge + 1) % 3];
          const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
          edges.set(key, [...(edges.get(key) ?? []), from < to ? 1 : -1]);
        }
      }
      expect(volume).toBeGreaterThan(0);
      for (const directions of edges.values()) {
        expect(directions).toHaveLength(2);
        expect(directions[0] + directions[1]).toBe(0);
      }
    }
  });

  it("leaves basin water visible inside a substantial continuous rounded rim", () => {
    const parts = getStructureModelParts("retention-basin");
    const berm = parts.find((part) => part.id === "berm")!;
    const pool = parts.find((part) => part.id === "pool")!;
    const waterTop = pool.centerHeight + pool.dimensions!.height / 2;
    expect(berm.dimensions!.height - waterTop).toBeGreaterThanOrEqual(5);
    expect(pool.dimensions!.length).toBeGreaterThan(60);
    expect(pool.dimensions!.width).toBeGreaterThan(40);
    // Every projected triangle avoids the pool center: no accidental lid or solid disk.
    const { positions, indices } = berm.mesh!;
    for (let i = 0; i < indices.length; i += 3) {
      const vertices = indices.slice(i, i + 3).map((index) => positions[index]);
      const sides = vertices.map((a, j) => {
        const b = vertices[(j + 1) % 3];
        return a[0] * b[1] - a[1] * b[0];
      });
      expect(sides.some((side) => side > 0) && sides.some((side) => side < 0)).toBe(true);
    }
  });

  it("gives the levee sloping sides and a supported raised crest", () => {
    const parts = getStructureModelParts("levee");
    const slope = parts.find((part) => part.id === "embankment")!;
    const crest = parts.find((part) => part.id === "crest")!;
    const vertices = slope.mesh!.positions;
    expect(Math.abs(vertices[0][1])).toBeGreaterThan(Math.abs(vertices[4][1]) * 2);
    expect(slope.dimensions!.height).toBeGreaterThanOrEqual(10);
    expect(crest.centerHeight - crest.dimensions!.height / 2).toBe(
      slope.centerHeight + slope.dimensions!.height / 2,
    );
  });

  it("makes the pump building, retaining wall and channel banks visibly raised", () => {
    expect(getStructureFootprintMeters("drainage-pump").height).toBeGreaterThan(18);
    expect(getStructureFootprintMeters("revetment").height).toBeGreaterThan(10);
    const channel = getStructureModelParts("channel-dredging");
    const water = channel.find((part) => part.id === "channel")!;
    for (const bank of channel.filter((part) => part.id.startsWith("bank-"))) {
      expect(
        bank.centerHeight +
          bank.dimensions!.height / 2 -
          water.centerHeight -
          water.dimensions!.height / 2,
      ).toBeGreaterThan(4);
    }
  });

  it("堤防は芝・アスファルト層を含む", () => {
    const materials = getStructureModelParts("levee").map((part) => part.material);
    expect(materials).toContain("grass");
    expect(materials).toContain("asphalt");
    expect(materials).toContain("earth");
  });

  it("堤防のフットプリントはドラッグ用に十分なサイズを持つ", () => {
    const footprint = getStructureFootprintMeters("levee");
    expect(footprint.length).toBeGreaterThan(80);
    expect(footprint.width).toBeGreaterThan(20);
    expect(footprint.height).toBeGreaterThan(5);
  });

  it("bounds every rendered part including offset intake and elevated roof", () => {
    for (const id of STRUCTURE_IDS) {
      const bounds = getStructureFootprintMeters(id);
      for (const part of getStructureModelParts(id)) {
        expect(bounds.length / 2).toBeGreaterThanOrEqual(
          Math.abs(part.offsetEast ?? 0) + (part.dimensions?.length ?? 0) / 2,
        );
        expect(bounds.width / 2).toBeGreaterThanOrEqual(
          Math.abs(part.offsetNorth ?? 0) + (part.dimensions?.width ?? 0) / 2,
        );
        expect(bounds.height).toBeGreaterThanOrEqual(
          part.centerHeight + (part.dimensions?.height ?? 0) / 2,
        );
      }
    }
  });
});
