import { readFileSync } from "node:fs";
import * as THREE from "three";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createGeographicGuidanceAnchors, selectGuidanceAdvice, selectGuidanceProjection } from "./geographicGuidanceAnchors";
import { getDioramaGuidance } from "./dioramaGuidance";
import { createGeographicTerrain } from "./geographicTerrain";
import { createGeographicWorld } from "./geographicWorld";
import { decodeKoriyamaTerrain } from "./koriyamaTerrain";
import type { KoriyamaGeodata } from "./koriyamaGeodata";
import { geoToWorld, worldToGeo } from "./dioramaSpace";
import { pointInPolygonDegrees, resolvePlaceablePosition } from "./riverPlacement";
import { suggestedStructureHeading } from "../../features/disaster/services/hydraulicPlacement";
import { calculateStructureInfluences } from "../../features/disaster/services/floodSimulation";
import { disposeDioramaObject } from "./disposeDioramaObject";

const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
const data: KoriyamaGeodata = JSON.parse(read("features.geojson").toString());
const terrain = createGeographicTerrain(decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, JSON.parse(read("terrain-metadata.json").toString())));
const waterData = { ...data, features: data.features.filter(f => f.properties.kind === "water" || f.properties.kind === "waterway") };
const world = createGeographicWorld(waterData, {
  localBounds: terrain.bounds, groundSampler: terrain.sampleGround, renderedTerrainSurface: terrain.renderedSurface,
  surfaceGridSpacing: 12, surfaceSampler: (x, z) => { const y = terrain.sampleGround(x, z); return y === null ? null : y + 0.35; },
});
const sites = getDioramaGuidance([]);
afterAll(() => { disposeDioramaObject(world); disposeDioramaObject(terrain.group); });

describe("static real-geography guidance integration", () => {
  it("caches both legal dry inland-pump anchors against actual polygons, water meshes and DEM", () => {
    const sampleGround = vi.fn(terrain.sampleGround), sampleRenderedGround = vi.fn(terrain.sampleRenderedGround);
    const cache = createGeographicGuidanceAnchors(sites, data, { sampleGround, sampleRenderedGround, waterMeshes: world.waterMeshes });
    for (const id of ["inland-campus", "inland-south"]) {
      const site = sites.find(s => s.id === id)!, entry = cache.get(id)!, anchor = entry.pumpAnchor!;
      expect(anchor).not.toBeNull();
      expect(entry.source).toMatchObject({ longitude: site.longitude, latitude: site.latitude });
      expect(entry.actionProjection).not.toEqual(entry.hazardProjection);
      expect(entry.hazardProjection).toMatchObject(geoToWorld(site.longitude, site.latitude));
      expect(resolvePlaceablePosition(anchor.position)).toEqual(anchor.position);
      expect(anchor.headingDegrees).toBe(suggestedStructureHeading("drainage-pump", anchor.position));
      const point = entry.actionProjection!;
      expect(terrain.sampleGround(point.x, point.z)).not.toBeNull();
      expect(point.groundY).toBe(terrain.sampleRenderedGround(point.x, point.z));
      // Independent geometry checks, not an always-false injected water predicate.
      for (const f of waterData.features) if (f.geometry.type === "MultiPolygon") for (const rings of f.geometry.coordinates) {
        const inside = (ring: typeof rings[number]) => pointInPolygonDegrees(anchor.position.longitude, anchor.position.latitude,
          ring.map(([lon, lat]) => ({ lon, lat })));
        expect(inside(rings[0]!) && !rings.slice(1).some(inside)).toBe(false);
      }
      world.updateMatrixWorld(true);
      expect(new THREE.Raycaster(new THREE.Vector3(point.x, 1000, point.z), new THREE.Vector3(0, -1, 0))
        .intersectObjects(world.waterMeshes, false)).toHaveLength(0);
      expect(selectGuidanceAdvice(entry, site)).toContain("川岸に排水機場を配置");
      console.info("cached actual land anchor", id, JSON.stringify({ source: entry.source, anchor }));
    }
    const calls = [sampleGround.mock.calls.length, sampleRenderedGround.mock.calls.length];
    for (let frame = 0; frame < 120; frame++) for (const site of sites) {
      const entry = cache.get(site.id);
      selectGuidanceProjection(entry, false); selectGuidanceProjection(entry, true);
      selectGuidanceAdvice(entry, site);
    }
    expect([sampleGround.mock.calls.length, sampleRenderedGround.mock.calls.length]).toEqual(calls);
  });

  it("preserves readiness advice and hazard projection after a real positive pump contribution", () => {
    const cache = createGeographicGuidanceAnchors(sites, data, {
      sampleGround: terrain.sampleGround, sampleRenderedGround: terrain.sampleRenderedGround, waterMeshes: world.waterMeshes,
    });
    const entry = cache.get("inland-campus")!, a = entry.pumpAnchor!;
    const ready = getDioramaGuidance(calculateStructureInfluences([{ id: "pump", structureId: a.structureId,
      position: a.position, headingDegrees: a.headingDegrees }])).find(s => s.id === "inland-campus")!;
    expect(ready.hasContribution).toBe(true);
    expect(selectGuidanceAdvice(entry, ready)).toBe(ready.advice);
    expect(selectGuidanceAdvice(entry, ready)).toBe("この地点に効果あり。大雨で確かめよう");
    expect(selectGuidanceProjection(entry, true)).toBe(entry.hazardProjection);
    expect(selectGuidanceProjection(entry, false)).toBe(entry.actionProjection);
  });

  it("fails closed when raw or rendered terrain is absent, without shifting source coordinates", () => {
    for (const missing of ["raw", "rendered"]) {
      const cache = createGeographicGuidanceAnchors(sites, data, {
        sampleGround: missing === "raw" ? () => null : terrain.sampleGround,
        sampleRenderedGround: missing === "rendered" ? () => null : terrain.sampleRenderedGround,
        waterMeshes: world.waterMeshes,
      });
      for (const id of ["inland-campus", "inland-south"]) {
        const entry = cache.get(id)!;
        expect(entry.unavailableReason).toBe("no-legal-bank-anchor");
        expect(selectGuidanceProjection(entry, false)).toBeNull();
        expect(entry.source).toMatchObject(sites.find(s => s.id === id)!);
      }
    }
  });

  it("retains source water holes and rejects rendered non-river water at setup", () => {
    const a = createGeographicGuidanceAnchors(sites, data, {
      sampleGround: terrain.sampleGround, sampleRenderedGround: terrain.sampleRenderedGround, waterMeshes: world.waterMeshes,
    }).get("inland-campus")!.pumpAnchor!;
    const p = geoToWorld(a.position.longitude, a.position.latitude);
    const ring = (radius: number): [number, number][] => [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, z]) => {
      const g = worldToGeo(p.x + x! * radius, p.z + z! * radius); return [g.longitude, g.latitude];
    });
    const fixture: KoriyamaGeodata = { ...data, features: [{ type: "Feature", id: "water-with-island",
      properties: { kind: "water", version: 1, timestamp: "test" }, geometry: { type: "MultiPolygon", coordinates: [[ring(100), ring(2)]] } }] };
    const site = { ...sites.find(s => s.id === "inland-campus")!, longitude: a.position.longitude, latitude: a.position.latitude };
    const options = { sampleGround: terrain.sampleGround, sampleRenderedGround: terrain.sampleRenderedGround, waterMeshes: [] as THREE.Mesh[] };
    expect(createGeographicGuidanceAnchors([site], fixture, options).get(site.id)!.pumpAnchor?.derived).toBe(false);
    // A rendered canal/ribbon inside the source hole is still water. No stage flag required.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.position.set(p.x, 3, p.z); mesh.userData.riverStageEligible = false;
    try {
      const blocked = createGeographicGuidanceAnchors([site], fixture, { ...options, waterMeshes: [mesh] }).get(site.id)!;
      expect(blocked.actionProjection).toBeNull();
      expect(selectGuidanceProjection(blocked, false)).toBeNull();
      expect(selectGuidanceProjection(blocked, true)).toBe(blocked.hazardProjection);
      expect(selectGuidanceAdvice(blocked, { hasContribution: true, advice: "ready" })).toBe("ready");
      expect(mesh.userData.riverStageEligible).toBe(false);
    } finally { disposeDioramaObject(mesh); }
  });
});
