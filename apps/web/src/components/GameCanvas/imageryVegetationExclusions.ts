import { koriyamaGeoToLocal, type KoriyamaGeodata } from "./koriyamaGeodata";
import type { KoriyamaPlateauGeodata } from "./koriyamaPlateauGeodata";
import type { KoriyamaLandcover } from "./koriyamaLandcover";
import type { VegetationExclusion } from "./imageryVegetation";

/** Source geometry only; same display-width defaults as geographicWorld (5/2/3m).
 * All source road/rail bends retained, including bridges. No snapping, simplifying or rerouting.
 * Existing OSM trees use a disclosed 2m duplicate-centre tolerance, not measured crown radius.
 */
export function createImageryVegetationExclusions(osm: KoriyamaGeodata, plateau: KoriyamaPlateauGeodata, landcover: KoriyamaLandcover): VegetationExclusion[] {
  const result: VegetationExclusion[] = [];
  for (const feature of [...osm.features, ...plateau.features]) {
    const kind = feature.properties.kind;
    if (!["building", "water", "waterway", "road", "rail"].includes(kind)) continue;
    const category = kind === "waterway" ? "water" : kind as "building" | "water" | "road" | "rail";
    if (feature.geometry.type === "MultiPolygon") {
      for (const polygon of feature.geometry.coordinates) result.push({ sourceId: feature.id, kind: category,
        geometry: { type: "polygon", rings: polygon.map(ring => ring.map(koriyamaGeoToLocal)) } });
    } else {
      const raw = "width" in feature.properties ? feature.properties.width : undefined;
      const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?(?:\s*m)?$/.test(raw) ? Number.parseFloat(raw) : NaN;
      const width = Number.isFinite(value) && value > 0 ? value : kind === "road" ? 5 : kind === "rail" ? 2 : 3;
      for (const line of feature.geometry.coordinates) result.push({ sourceId: feature.id, kind: category,
        geometry: { type: "corridor", points: line.map(koriyamaGeoToLocal), halfWidthM: width / 2 } });
    }
  }
  for (const feature of landcover.features) if (feature.geometry.type === "Point" && feature.properties.kind === "tree") {
    result.push({ sourceId: feature.id, kind: "existing-tree",
      geometry: { type: "disc", centre: koriyamaGeoToLocal(feature.geometry.coordinates), radiusM: 2 } });
  }
  return result;
}
