import type { GeoPosition } from "../../features/construction/types/construction";
import type { OverflowCandidate } from "../../features/disaster/services/overflowBankSites";
import { getRiverPlacementContext, suggestedStructureHeading } from "../../features/disaster/services/hydraulicPlacement";
import { geoToWorld, worldToGeo } from "./dioramaSpace";
import { nearestPointOnRiverCenterline, PLACEABLE_CORRIDOR_HALF_WIDTH_M, resolvePlaceablePosition } from "./riverPlacement";

type Hazard = Pick<OverflowCandidate, "id" | "longitude" | "latitude" | "primaryHazard">;
export type LegalGuidanceSurface = {
  /** Actual nullable terrain sampler in existing local metre coordinates. */
  sampleGround: (x: number, z: number) => number | null;
  /** Actual water polygons (including holes), not the schematic centreline width.
   * A pump action anchor is on land; do not substitute an always-false fallback.
   */
  isWater: (position: GeoPosition) => boolean;
};
export type PumpActionAnchor = {
  position: GeoPosition;
  headingDegrees: number;
  groundY: number;
  structureId: "drainage-pump";
  derived: boolean;
  advice: string;
};

/** Pure, separate ACTION location; never changes the hazard marker/source coordinates.
 * No simulation optimisation or snapping a player's drop. Uses the same corridor
 * validator and preview heading as the map, plus mandatory terrain/water checks.
 * Searches at most four points on the source-to-centreline segment, retaining the
 * source bank side. Fractions are display inset policy, NOT a second legal radius.
 * Return no anchor if the narrow bank search is water/noData/outside the corridor.
 */
export function resolveLegalPumpGuidance(hazard: Hazard, surface: LegalGuidanceSurface) {
  const source = { ...hazard };
  const result = (reason: "available" | "not-inland-pump" | "invalid-source" | "no-legal-bank-anchor", actionAnchor: PumpActionAnchor | null = null) =>
    ({ source, actionAnchor, reason });
  if (![hazard.longitude, hazard.latitude].every(Number.isFinite) || Math.abs(hazard.longitude) > 180 || Math.abs(hazard.latitude) > 85) return result("invalid-source");
  if (hazard.primaryHazard !== "inlandPonding") return result("not-inland-pump");
  const local = geoToWorld(hazard.longitude, hazard.latitude);
  // Keep the map's existing gameplay height convention separate from actual groundY.
  const original = { ...worldToGeo(local.x, local.z), longitude: hazard.longitude, latitude: hazard.latitude };
  function check(position: GeoPosition, derived: boolean): PumpActionAnchor | null {
    if (!resolvePlaceablePosition(position)) return null;
    const context = getRiverPlacementContext(position.longitude, position.latitude, 0);
    if (!context.onBank || context.inChannel || surface.isWater(position)) return null;
    const p = geoToWorld(position.longitude, position.latitude), ground = surface.sampleGround(p.x, p.z);
    if (ground === null || !Number.isFinite(ground)) return null;
    return { position, groundY: ground, structureId: "drainage-pump", derived,
      headingDegrees: suggestedStructureHeading("drainage-pump", position),
      advice: derived ? "川岸に排水機場を配置（内水地点の川側）" : "この地点に排水機場を配置" };
  }
  const direct = check(original, false);
  if (direct) return result("available", direct);
  const nearest = nearestPointOnRiverCenterline(hazard.longitude, hazard.latitude);
  if (!Number.isFinite(nearest.distanceMeters) || nearest.distanceMeters <= 0) return result("no-legal-bank-anchor");
  for (const fraction of [0.95, 0.9, 0.85, 0.8]) {
    const distance = Math.min(nearest.distanceMeters, PLACEABLE_CORRIDOR_HALF_WIDTH_M * fraction);
    const scale = distance / nearest.distanceMeters;
    const anchor = check({ ...original,
      longitude: nearest.longitude + (hazard.longitude - nearest.longitude) * scale,
      latitude: nearest.latitude + (hazard.latitude - nearest.latitude) * scale,
    }, true);
    if (anchor) return result("available", anchor);
  }
  return result("no-legal-bank-anchor");
}
