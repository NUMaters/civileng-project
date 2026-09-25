import * as THREE from "three";
import type { OverflowCandidate } from "../../features/disaster/services/overflowBankSites";
import type { KoriyamaGeodata } from "./koriyamaGeodata";
import { geoToWorld } from "./dioramaSpace";
import { pointInPolygonDegrees } from "./riverPlacement";
import { resolveLegalPumpGuidance, type PumpActionAnchor } from "./legalPlacementGuidance";

type Source = Pick<OverflowCandidate, "id" | "longitude" | "latitude" | "primaryHazard">;
type Projection = { x: number; z: number; groundY: number };
export type GeographicGuidanceAnchor = {
  source: Source;
  hazardProjection: Projection | null;
  actionProjection: Projection | null;
  pumpAnchor: PumpActionAnchor | null;
  unavailableReason: "no-legal-bank-anchor" | "no-terrain" | null;
};

/** Once per static geography, NOT per animation frame or readiness change.
 * Original OSM water polygons retain holes; rendered water meshes also reject
 * canals/line ribbons. Both raw DEM and actual rendered terrain must be available.
 * No source edits, GPU resources, new draw calls or effect/score changes.
 */
export function createGeographicGuidanceAnchors(
  sites: readonly Source[], data: KoriyamaGeodata,
  options: {
    sampleGround: (x: number, z: number) => number | null;
    sampleRenderedGround: (x: number, z: number) => number | null;
    waterMeshes: readonly THREE.Mesh[];
  },
): ReadonlyMap<string, GeographicGuidanceAnchor> {
  const water = data.features.flatMap(f => (f.properties.kind === "water" || f.properties.kind === "waterway") && f.geometry.type === "MultiPolygon"
    ? f.geometry.coordinates.map(polygon => polygon.map(ring => ring.map(([lon, lat]) => ({ lon, lat })))) : []);
  // Ray queries are bounded to setup-time candidates. Include ALL rendered water,
  // not only riverStageEligible meshes; never alter eligibility or source geometry.
  const waterMeshes = [...options.waterMeshes];
  let top = -Infinity;
  for (const mesh of waterMeshes) {
    mesh.updateWorldMatrix(true, false);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) top = Math.max(top, mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).max.y);
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  function sampleGround(x: number, z: number) {
    const raw = options.sampleGround(x, z);
    if (raw === null || !Number.isFinite(raw)) return null;
    const rendered = options.sampleRenderedGround(x, z);
    return rendered !== null && Number.isFinite(rendered) ? rendered : null;
  }
  const surface = {
    sampleGround,
    isWater: (p: { longitude: number; latitude: number }) => {
      if (water.some(rings => rings[0] && pointInPolygonDegrees(p.longitude, p.latitude, rings[0]) &&
        !rings.slice(1).some(ring => pointInPolygonDegrees(p.longitude, p.latitude, ring)))) return true;
      if (!Number.isFinite(top)) return false;
      const local = geoToWorld(p.longitude, p.latitude);
      ray.ray.origin.set(local.x, top + 1, local.z);
      return ray.intersectObjects(waterMeshes, false).length > 0;
    },
  };
  const cache = new Map<string, GeographicGuidanceAnchor>();
  for (const site of sites) {
    const source = { ...site }, p = geoToWorld(site.longitude, site.latitude);
    const groundY = sampleGround(p.x, p.z);
    const hazardProjection = groundY === null ? null : { ...p, groundY };
    const pumpAnchor = site.primaryHazard === "inlandPonding" ? resolveLegalPumpGuidance(site, surface).actionAnchor : null;
    const actionProjection = site.primaryHazard !== "inlandPonding" ? hazardProjection : pumpAnchor
      ? { ...geoToWorld(pumpAnchor.position.longitude, pumpAnchor.position.latitude), groundY: pumpAnchor.groundY } : null;
    cache.set(site.id, { source, hazardProjection, actionProjection, pumpAnchor,
      unavailableReason: actionProjection ? null : site.primaryHazard === "inlandPonding" ? "no-legal-bank-anchor" : "no-terrain" });
  }
  return cache;
}

/** Existing contribution/readiness describes the HAZARD, not a new placement task.
 * Unknown geography hides the instruction; a valid hazard can still show readiness.
 * Returns cached objects/strings: no search, sampling or allocation in the draw loop.
 */
export function selectGuidanceProjection(entry: GeographicGuidanceAnchor | undefined, hasContribution: boolean) {
  return (hasContribution ? entry?.hazardProjection : entry?.actionProjection) ?? null;
}
export function selectGuidanceAdvice(entry: GeographicGuidanceAnchor | undefined, site: { hasContribution: boolean; advice: string }) {
  return !site.hasContribution && entry?.pumpAnchor?.derived ? entry.pumpAnchor.advice : site.advice;
}
