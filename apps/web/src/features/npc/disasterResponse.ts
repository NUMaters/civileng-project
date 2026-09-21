import { npcCatalog } from "./catalog";
import type { NpcDefinition } from "./types";
import type { FloodSimulationState } from "../disaster/services/floodSimulation";

/** Reports only the nearby hazard flags the simulation actually holds, not invented road/house damage. */
export function disasterResponse(
  npc: NpcDefinition,
  state: Pick<FloodSimulationState, "phase" | "overflowSites">,
) {
  const settings = npcCatalog.disaster;
  const active =
    state.phase === "disaster"
      ? state.overflowSites
          .filter((site) => site.intensity >= settings.activeIntensity)
          .filter((site) => distanceMeters(npc.position, site) <= settings.nearbyRadiusMeters)
          .sort((a, b) => b.intensity - a.intensity)
      : [];
  const hazard = active[0]?.primaryHazard;
  const kind =
    hazard === "erosion"
      ? "erosion"
      : hazard === "inlandPonding"
        ? "inland"
        : hazard === "capacityShortage"
          ? "capacity"
          : active.length
            ? "overflow"
            : "calm";
  const tip = settings.tips[npc.kind];
  return { status: settings.messages[kind], tip: tip.text, factIds: tip.factIds, kind };
}
function distanceMeters(
  a: { longitude: number; latitude: number },
  b: { longitude: number; latitude: number },
): number {
  const radians = Math.PI / 180;
  const radius = 6_371_000;
  const deltaLat = (b.latitude - a.latitude) * radians;
  const deltaLon = (b.longitude - a.longitude) * radians;
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(deltaLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
