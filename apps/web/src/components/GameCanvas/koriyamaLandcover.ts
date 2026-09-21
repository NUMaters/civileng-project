import { koriyamaGeoToLocal, KORIYAMA_ATTRIBUTION, type GeoPoint, type LocalPoint } from "./koriyamaGeodata";

export const KORIYAMA_LANDCOVER_URL = "/geodata/koriyama/landcover.geojson";
export const KORIYAMA_LANDCOVER_ATTRIBUTION = KORIYAMA_ATTRIBUTION;
export type LandcoverCategory = "tree" | `landuse:${"grass" | "forest" | "meadow" | "recreation_ground" | "farmland" | "orchard" | "allotments"}` |
  `natural:${"wood" | "scrub" | "grassland"}` | `leisure:${"park" | "garden" | "pitch" | "sports_centre"}`;
export type LandcoverProperties = {
  kind: "landcover" | "tree";
  category: LandcoverCategory;
  version: number;
  timestamp: string;
  [key: string]: string | number;
};
export type LandcoverFeature = {
  type: "Feature";
  id: string;
  properties: LandcoverProperties;
  geometry: { type: "MultiPolygon"; coordinates: GeoPoint[][][] } | { type: "Point"; coordinates: GeoPoint };
};
export type KoriyamaLandcover = {
  type: "FeatureCollection";
  bbox: [number, number, number, number];
  features: LandcoverFeature[];
};
export type LocalLandcoverFeature = Omit<LandcoverFeature, "geometry"> & {
  geometry: { type: "MultiPolygon"; coordinates: LocalPoint[][][] } | { type: "Point"; coordinates: LocalPoint };
  provenance: {
    positionSource: "OpenStreetMap"; sourceId: string; sourceVersion: number; sourceTimestamp: string;
    elevationSource: "none"; treeHeightSource: "not-verified";
    vegetationCoverage: "mapped-tag-not-verified-continuous-vegetation";
  };
};

/** Exterior ring first, then holes. Y=0 is only the local datum, never an inferred terrain/tree height.
 * A park or sports centre is a mapped facility boundary; do not scatter trees within it as facts.
 * Only Point features represent mapped individual tree positions. Surface/species tags stay unverified.
 */
export function toLocalLandcoverFeature(feature: LandcoverFeature): LocalLandcoverFeature {
  return { ...feature, geometry: feature.geometry.type === "Point"
    ? { type: "Point", coordinates: koriyamaGeoToLocal(feature.geometry.coordinates) }
    : { type: "MultiPolygon", coordinates: feature.geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(koriyamaGeoToLocal))) },
  provenance: { positionSource: "OpenStreetMap", sourceId: feature.id, sourceVersion: feature.properties.version,
    sourceTimestamp: feature.properties.timestamp, elevationSource: "none", treeHeightSource: "not-verified",
    vegetationCoverage: "mapped-tag-not-verified-continuous-vegetation" } };
}
