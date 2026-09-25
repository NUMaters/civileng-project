/** Actual OSM geometry; elevations and visual extrusion dimensions are not supplied. */
export const KORIYAMA_GEODATA_URL = "/geodata/koriyama/features.geojson";
export const KORIYAMA_ATTRIBUTION = {
  text: "© OpenStreetMap contributors",
  url: "https://www.openstreetmap.org/copyright",
} as const;
export const KORIYAMA_ORIGIN = { longitude: 140.3837, latitude: 37.3655 } as const;
export type GeoPoint = [longitude: number, latitude: number];
export type LocalPoint = { x: number; y: number; z: number };
export type GeodataKind = "building" | "road" | "rail" | "waterway" | "water" | "campus";
export type GeodataProperties = {
  kind: GeodataKind;
  version: number;
  timestamp: string;
  [key: string]: string | number;
};
export type GeodataGeometry =
  | { type: "MultiPolygon"; coordinates: GeoPoint[][][] }
  | { type: "MultiLineString"; coordinates: GeoPoint[][] };
export type GeodataFeature = {
  type: "Feature";
  id: string;
  properties: GeodataProperties;
  geometry: GeodataGeometry;
};
export type KoriyamaGeodata = {
  type: "FeatureCollection";
  bbox: [west: number, south: number, east: number, north: number];
  features: GeodataFeature[];
};
export type LocalGeodataFeature = Omit<GeodataFeature, "geometry"> & {
  provenance: {
    positionSource: "OpenStreetMap";
    sourceId: string;
    sourceVersion: number;
    sourceTimestamp: string;
    heightMeters: number | null;
    heightSource: "osm-height-tag-unverified" | "unknown";
    elevationSource: "none";
  };
  geometry:
    | { type: "MultiPolygon"; coordinates: LocalPoint[][][] }
    | { type: "MultiLineString"; coordinates: LocalPoint[][] };
};

const LAT_METERS = 110_540;
const LON_METERS = 111_320 * Math.cos((KORIYAMA_ORIGIN.latitude * Math.PI) / 180);
/** Matches dioramaSpace exactly: metres, east +X, north -Z. Y=0 is an arbitrary flat datum. */
export function koriyamaGeoToLocal([longitude, latitude]: GeoPoint): LocalPoint {
  return {
    x: (longitude - KORIYAMA_ORIGIN.longitude) * LON_METERS,
    y: 0,
    z: -(latitude - KORIYAMA_ORIGIN.latitude) * LAT_METERS,
  };
}

/** Polygon[0] is the exterior; remaining rings are holes and must not be filled. */
export function toLocalGeodataFeature(feature: GeodataFeature): LocalGeodataFeature {
  const geometry =
    feature.geometry.type === "MultiPolygon"
      ? {
          type: "MultiPolygon" as const,
          coordinates: feature.geometry.coordinates.map((polygon) =>
            polygon.map((ring) => ring.map(koriyamaGeoToLocal)),
          ),
        }
      : {
          type: "MultiLineString" as const,
          coordinates: feature.geometry.coordinates.map((line) => line.map(koriyamaGeoToLocal)),
        };
  const heightMeters = taggedHeightMeters(feature);
  return {
    ...feature,
    geometry,
    provenance: {
      positionSource: "OpenStreetMap",
      sourceId: feature.id,
      sourceVersion: feature.properties.version,
      sourceTimestamp: feature.properties.timestamp,
      heightMeters,
      heightSource: heightMeters === null ? "unknown" : "osm-height-tag-unverified",
      elevationSource: "none",
    },
  };
}

/** OSM height in metres only. Missing, feet-based or ambiguous values stay unknown. */
export function taggedHeightMeters(feature: GeodataFeature): number | null {
  const height = feature.properties.height;
  if (typeof height !== "string" || !/^\d+(?:\.\d+)?(?:\s*m)?$/.test(height)) return null;
  const metres = Number.parseFloat(height);
  return Number.isFinite(metres) && metres > 0 ? metres : null;
}

/** Bridge segments remain roads/rails; bridge tags do not provide deck height. */
export function isGeodataBridge(feature: GeodataFeature): boolean {
  return typeof feature.properties.bridge === "string" && feature.properties.bridge !== "no";
}
