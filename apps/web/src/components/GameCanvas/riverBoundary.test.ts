import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRiverBoundaryResolver, type RiverBoundarySite } from "./riverBoundary";
import { createRiverSurfaceSampler } from "./riverSurface";
import * as THREE from "three";
import { createGeographicWorld } from "./geographicWorld";
import { createRiverStageController } from "./riverStage";
import { worldToGeo } from "./dioramaSpace";
import { koriyamaGeoToLocal, type GeoPoint, type KoriyamaGeodata } from "./koriyamaGeodata";
import { listOverflowCandidates } from "../../features/disaster/services/overflowBankSites";

const geo = (x: number, z: number): GeoPoint => { const p = worldToGeo(x, z); return [p.longitude, p.latitude]; };
const rectangle = (x0: number, z0: number, x1: number, z1: number) =>
  [geo(x0, z0), geo(x1, z0), geo(x1, z1), geo(x0, z1), geo(x0, z0)];
function data(id = "relation/18504988", water = "river"): KoriyamaGeodata {
  return { type: "FeatureCollection", bbox: [140, 37, 141, 38], features: [{ type: "Feature", id,
    properties: { kind: "water", water, version: 1, timestamp: "test" },
    geometry: { type: "MultiPolygon", coordinates: [[rectangle(-100, -100, 0, 100), rectangle(-70, -20, -50, 20)]] } }] };
}
function site(x = 60, z = 0, heading = 90): RiverBoundarySite {
  return { id: "test", ...worldToGeo(x, z), outflowHeadingDegrees: heading, primaryHazard: "overtopping", intensity: 1 };
}

describe("source river boundary", () => {
  it("samples actual eligible triangles and follows stage matrices, agreeing with CPU raycasts and holes", () => {
    const source = data();
    source.features.push(...data("basin", "basin").features);
    const world = createGeographicWorld(source, { surfaceSampler: (x, z, _layer, feature) =>
      "water" in feature.properties && feature.properties.water === "basin" ? 20 : 3 + x / 100 + z / 200 });
    try {
      const sample = createRiverSurfaceSampler(world.waterMeshes), stage = createRiverStageController(world.waterMeshes);
      const ray = new THREE.Raycaster(new THREE.Vector3(-20, 100, 30), new THREE.Vector3(0, -1, 0));
      for (const level of [2.2, 5.2, 3.2]) {
        stage.update(level);
        const hit = ray.intersectObjects(world.waterMeshes.filter(m => m.userData.riverStageEligible))[0]!;
        expect(sample(-20, 30)).toBeCloseTo(hit.point.y, 5);
        expect(sample(-20, 30)).toBeCloseTo(2.95 + level - 2.2, 5);
        expect(sample(-60, 0)).toBeNull(); // source island remains a hole
        expect(sample(1, 0)).toBeNull();
        expect(sample(0, 0)).not.toBeNull(); // exact source boundary, not offset inland
      }
      stage.reset();
      expect(sample(-20, 30)).toBeCloseTo(2.95, 5);
      expect(sample(NaN, 0)).toBeNull();
    } finally {
      const materials = new Set<THREE.Material>();
      for (const child of world.children) {
        const mesh = child as THREE.Mesh; mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
      }
      materials.forEach(m => m.dispose());
    }
  });

  it("samples interior source-edge heights rather than using only its endpoints", () => {
    const coordinates: number[] = [];
    for (const [z0, z1, y0, y1] of [[-8, 0, 1, 3], [0, 8, 3, 1]]) {
      coordinates.push(-10, y0!, z0!, 0, y0!, z0!, 0, y1!, z1!, -10, y0!, z0!, 0, y1!, z1!, -10, y1!, z1!);
    }
    const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(coordinates, 3));
    const material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(geometry, material);
    mesh.userData.riverStageEligible = true;
    try {
      const sample = createRiverSurfaceSampler([mesh]);
      const bank = createRiverBoundaryResolver(data(), sample)(site())!;
      expect(bank.edge!.map(p => p.y)).toEqual([1, 2, 3, 2, 1]);
      expect(bank.edge!.map(p => p.z)).toEqual([-8, -4, 0, 4, 8]);
    } finally { geometry.dispose(); material.dispose(); }
  });

  it("intersects the source bank from either side, samples current stage and preserves the island hole", () => {
    let level = 3;
    const resolve = createRiverBoundaryResolver(data(), () => level);
    for (const x of [60, 12, -12]) {
      const bank = resolve(site(x))!;
      expect(bank.sourceId).toBe("relation/18504988");
      expect(bank.anchor.x).toBeCloseTo(0, 6);
      expect(bank.anchor.z).toBeCloseTo(0, 6);
      expect(bank.inland.x).toBeCloseTo(1);
      expect(bank.left.x).toBeCloseTo(0, 6);
      expect(bank.right.x).toBeCloseTo(0, 6);
      expect(Math.abs(bank.right.z - bank.left.z)).toBeCloseTo(16);
      expect(bank.isLand(-60, 0)).toBe(true);
      expect(bank.isLand(-30, 0)).toBe(false);
    }
    level = 5;
    expect(resolve(site())!.left.y).toBe(5);
    // Heading toward the hole must not select its shoreline as an outlet.
    expect(resolve(site(-40, 0, 270))!.anchor.x).toBeCloseTo(-100, 6);
  });

  it("rejects wrong water, pluvial sites, missing water samples, distant and clipped boundaries", () => {
    expect(createRiverBoundaryResolver(data("other"), () => 2)(site())).toBeNull();
    expect(createRiverBoundaryResolver(data("relation/18504988", "basin"), () => 2)(site())).toBeNull();
    const resolve = createRiverBoundaryResolver(data(), () => 2);
    expect(resolve({ ...site(), primaryHazard: "inlandPonding" })).toBeNull();
    expect(resolve(site(1000))).toBeNull();
    expect(resolve({ ...site(), longitude: NaN })).toBeNull();
    for (const value of [null, NaN, Infinity]) expect(createRiverBoundaryResolver(data(), () => value)(site())).toBeNull();
    expect(createRiverBoundaryResolver(data(), (_x, z) => Math.abs(z) < 2 ? null : 2)(site())).toBeNull();
    const clipped = data();
    clipped.bbox = [geo(-100, 100)[0], geo(-100, 100)[1], geo(0, -100)[0], geo(0, -100)[1]];
    expect(createRiverBoundaryResolver(clipped, () => 2)(site())).toBeNull();
  });

  it("anchors actual campus candidates to the Abukuma exterior segment, not the 55m centerline offset", () => {
    const actual = JSON.parse(readFileSync(new URL("../../../public/geodata/koriyama/features.geojson", import.meta.url), "utf8")) as KoriyamaGeodata;
    const resolve = createRiverBoundaryResolver(actual, () => 5);
    for (const id of ["campus-south", "campus-core", "campus-north", "north-bend"]) {
      const candidate = listOverflowCandidates().find(c => c.id === id)!;
      const bank = resolve({ ...candidate, intensity: 1 });
      expect(bank, id).not.toBeNull();
      expect(bank!.sourceId).toBe("relation/18504988");
      const feature = actual.features.find(f => f.id === bank!.sourceId)!;
      if (feature.geometry.type !== "MultiPolygon") throw new Error("Expected source polygon");
      const ring = feature.geometry.coordinates[bank!.polygonIndex]![0]!;
      const a = koriyamaGeoToLocal(ring[bank!.segmentIndex]!), b = koriyamaGeoToLocal(ring[bank!.segmentIndex + 1]!);
      for (const p of [bank!.anchor, bank!.left, bank!.right]) {
        const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
        expect(Math.abs(cross)).toBeLessThan(1e-5);
      }
      const p = koriyamaGeoToLocal([candidate.longitude, candidate.latitude]);
      expect(Math.hypot(p.x - bank!.anchor.x, p.z - bank!.anchor.z)).toBeGreaterThan(1);
    }
  }, 30_000);
});
