import * as THREE from "three";
import { createVegetationStyleResources, vegetationColor, VEGETATION_STYLE_PROVENANCE } from "./geographicVegetationStyle";
import { createGeographicWorld } from "./geographicWorld";
import { koriyamaGeoToLocal, type GeodataFeature } from "./koriyamaGeodata";
import type { KoriyamaLandcover, LandcoverFeature } from "./koriyamaLandcover";
import type { BridgeBounds } from "./geographicBridges";

/** Display-only precedence: all lifts stay below the road layer's 0.12 m. */
export function landcoverSurfaceLift(feature: LandcoverFeature) {
  const category = feature.properties.category;
  if (category === "leisure:pitch") return 0.09;
  if (category.startsWith("landuse:") || category.startsWith("natural:")) return 0.06;
  return 0.03;
}

export function landcoverDisplayColor(feature: LandcoverFeature) {
  const { category, surface } = feature.properties;
  if (category === "leisure:pitch") {
    if (surface === "grass" || surface === "artificial_turf") return "#72b875";
    if (surface === "asphalt" || surface === "concrete") return "#96a6a6";
    return "#d5bc8c";
  }
  if (category === "landuse:grass" || category === "natural:grassland") return "#80b95b";
  if (category === "natural:wood" || category === "landuse:forest") return "#578653";
  // Park boundaries include paving/buildings: this is a subtle classification tint,
  // not a claim that the entire polygon is grass or observed canopy.
  return "#a7bd8a";
}

export function createGeographicLandcover(data: KoriyamaLandcover, options: {
  bounds: BridgeBounds; groundSampler: (x: number, z: number) => number | null;
}) {
  const byId = new Map(data.features.map(feature => [feature.id, feature]));
  const surfaces: GeodataFeature[] = data.features.flatMap(feature => feature.geometry.type === "MultiPolygon" ? [{
    ...feature, properties: { ...feature.properties, kind: "campus" as const }, geometry: feature.geometry,
  }] : []);
  const group = new THREE.Group(); group.name = "geographic-landcover";
  const cover = createGeographicWorld({ type: "FeatureCollection", bbox: data.bbox, features: surfaces }, {
    localBounds: options.bounds, surfaceGridSpacing: 12,
    groundSampler: options.groundSampler,
    surfaceSampler: (x, z, _layer, feature) => {
      const ground = options.groundSampler(x, z);
      return ground === null ? null : ground + landcoverSurfaceLift(byId.get(feature.id)!);
    },
    polygonSurfaceColor: feature => landcoverDisplayColor(byId.get(feature.id)!),
  });
  cover.name = "mapped-landcover-boundaries";
  group.add(cover);
  const trees: { id: string; x: number; y: number; z: number; height: number; heightSource: string }[] = [];
  let skippedTrees = 0;
  for (const feature of data.features) {
    if (feature.geometry.type !== "Point" || feature.properties.kind !== "tree") continue;
    const p = koriyamaGeoToLocal(feature.geometry.coordinates), b = options.bounds;
    const ground = p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ ? null : options.groundSampler(p.x, p.z);
    if (ground === null || !Number.isFinite(ground)) { skippedTrees++; continue; }
    const raw = String(feature.properties.height ?? "");
    const tagged = /^\d+(?:\.\d+)?(?:\s*m)?$/.test(raw) ? Number.parseFloat(raw) : NaN;
    const known = Number.isFinite(tagged) && tagged > 0 && tagged <= 100;
    trees.push({ id: feature.id, x: p.x, y: ground, z: p.z, height: known ? tagged : 7,
      heightSource: known ? "osm-height-tag-unverified" : "illustrative-default-7m" });
  }
  if (trees.length) {
    const style = createVegetationStyleResources();
    const trunks = new THREE.InstancedMesh(style.trunk, style.bark, trees.length);
    const crowns = new THREE.InstancedMesh(style.crown, style.leaf, trees.length);
    trunks.name = "mapped-tree-trunks"; crowns.name = "mapped-tree-crowns";
    const dummy = new THREE.Object3D();
    trees.forEach((tree, i) => {
      dummy.position.set(tree.x, tree.y + tree.height * 0.25, tree.z);
      dummy.scale.set(1, tree.height * 0.5, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = tree.y + tree.height * 0.65;
      dummy.scale.set(tree.height * 0.28, tree.height * 0.35, tree.height * 0.28);
      dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
      crowns.setColorAt(i, vegetationColor(tree.id));
    });
    for (const mesh of [trunks, crowns]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    }
  }
  group.userData = { source: "OpenStreetMap", style: VEGETATION_STYLE_PROVENANCE, treeRecords: trees, skippedTrees,
    surfaceSourceIds: surfaces.map(feature => feature.id), surfacePrecedence: "park 0.03m < vegetation 0.06m < pitch 0.09m < roads 0.12m; display offsets, not measured heights",
    limitations: "Source boundaries/tree points only; colors, crown shapes and default heights illustrative. Park extents are not continuous grass/canopy. No invented tree positions." };
  return { group, stats: { trees: trees.length, skippedTrees, surfaces: surfaces.length, surfaceBatches: cover.stats.batches } };
}
