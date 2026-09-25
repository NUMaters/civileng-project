import * as THREE from "three";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGeographicLandcover, landcoverSurfaceLift } from "./geographicLandcover";
import type { KoriyamaLandcover } from "./koriyamaLandcover";
import { koriyamaGeoToLocal } from "./koriyamaGeodata";
const data: KoriyamaLandcover = JSON.parse(readFileSync(new URL("../../../public/geodata/koriyama/landcover.geojson", import.meta.url), "utf8"));
const [w, s, e, n] = data.bbox;
const a = koriyamaGeoToLocal([w, n]), b = koriyamaGeoToLocal([e, s]);
const bounds = { minX: a.x, minZ: a.z, maxX: b.x, maxZ: b.z };
function dispose(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m);
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
describe("mapped landcover rendering", () => {
  it("orders overlapping landcover below roads with explicit display offsets", () => {
    const polygon = data.features.find(f => f.geometry.type === "MultiPolygon")!;
    const features = (["leisure:park", "landuse:grass", "leisure:pitch"] as const).map((category, i) => ({
      ...polygon, id: `overlap-${i}`, properties: { ...polygon.properties, category },
    }));
    expect(features.map(landcoverSurfaceLift)).toEqual([0.03, 0.06, 0.09]);
    const result = createGeographicLandcover({ ...data, features }, { bounds, groundSampler: () => 0 });
    try {
      const heights = new Set<number>();
      result.group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const positions = object.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) heights.add(Number(positions.getY(i).toFixed(3)));
      });
      expect([...heights].sort()).toEqual([0.03, 0.06, 0.09]);
      expect(Math.max(...heights)).toBeLessThan(0.12);
    } finally { dispose(result.group); }
  });
  it("uses only mapped tree coordinates, in two instanced meshes", () => {
    const result = createGeographicLandcover(data, { bounds, groundSampler: () => 12 });
    try {
      expect(result.stats.trees).toBe(234);
      expect(result.stats.surfaces).toBe(47);
      const crowns = result.group.getObjectByName("mapped-tree-crowns") as THREE.InstancedMesh;
      expect(crowns.count).toBe(234);
      const instances = result.group.children.filter(mesh => mesh instanceof THREE.InstancedMesh);
      expect(instances).toHaveLength(2);
      const sourceTrees = data.features.filter(feature => feature.geometry.type === "Point");
      const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
      for (let i = 0; i < crowns.count; i++) {
        const feature = sourceTrees[i]!;
        if (feature.geometry.type !== "Point") throw new Error("point");
        const p = koriyamaGeoToLocal(feature.geometry.coordinates);
        crowns.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
        expect(position.x).toBeCloseTo(p.x, 3); expect(position.z).toBeCloseTo(p.z, 3);
        expect(position.y).toBeGreaterThan(12);
      }
      expect(result.group.userData.limitations).toContain("default heights illustrative");
    } finally { dispose(result.group); }
  });
  it("does not place trees where ground is missing", () => {
    const result = createGeographicLandcover(data, { bounds, groundSampler: () => null });
    try {
      expect(result.stats.trees).toBe(0); expect(result.stats.skippedTrees).toBe(234);
      expect(result.group.getObjectByName("mapped-tree-crowns")).toBeUndefined();
      expect(result.stats.surfaceBatches).toBe(0);
    } finally { dispose(result.group); }
  });
});
