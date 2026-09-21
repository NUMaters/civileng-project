import { koriyamaGeoToLocal, type GeoPoint, type LocalPoint } from "./koriyamaGeodata";

export const KORIYAMA_PLATEAU_URL = "/geodata/koriyama/plateau-buildings.geojson";
export const KORIYAMA_PLATEAU_ATTRIBUTION = {
  text: "3D都市モデル（Project PLATEAU）郡山市（2020年度）を加工して作成",
  url: "https://www.geospatial.jp/ckan/dataset/plateau-07203-koriyama-shi-2020",
} as const;
export type PlateauBuildingProperties = {
  kind: "building";
  source: "PLATEAU";
  datasetYear: number;
  tile: string;
  buildingId: string;
  name: string | null;
  usage: string | null;
  surveyYear: string | null;
  createdAt: string | null;
  heightMeters: number | null;
  heightSource: "plateau-bldg:measuredHeight" | "unknown";
  heightMethod: string | null;
  modelHeightMeters: number;
  modelHeightSource: "plateau-lod1-z-bounds";
  modelHeightMethod: string | null;
  geometrySource: string | null;
  footprintMethod: "union-of-projected-lod1-mesh-triangles";
  sourceCenter: GeoPoint;
  sourceBounds: [number, number, number, number];
  sourceZMin: number | null;
  sourceZMax: number | null;
  elevationDatum: string;
};
export type PlateauBuilding = {
  type: "Feature";
  id: string;
  properties: PlateauBuildingProperties;
  geometry: { type: "MultiPolygon"; coordinates: GeoPoint[][][] };
};
export type KoriyamaPlateauGeodata = {
  type: "FeatureCollection";
  bbox: [number, number, number, number];
  features: PlateauBuilding[];
};
export type LocalPlateauBuilding = Omit<PlateauBuilding, "geometry"> & {
  geometry: { type: "MultiPolygon"; coordinates: LocalPoint[][][] };
};

/** Actual projected LOD1 rings and source height; no terrain or guessed height fallback. */
export function toLocalPlateauBuilding(building: PlateauBuilding): LocalPlateauBuilding {
  return {
    ...building,
    geometry: {
      type: "MultiPolygon",
      coordinates: building.geometry.coordinates.map((polygon) =>
        polygon.map((ring) => ring.map(koriyamaGeoToLocal)),
      ),
    },
  };
}
