import { geoToWorld } from "./dioramaSpace";

/** 指定された画面範囲。北はビッグパレット周辺、南は日本大学工学部南端まで。 */
export const GAMEPLAY_MAP_GEO_BOUNDS = {
  west: 140.37,
  south: 37.3522,
  east: 140.388,
  north: 37.372,
} as const;

const northWest = geoToWorld(GAMEPLAY_MAP_GEO_BOUNDS.west, GAMEPLAY_MAP_GEO_BOUNDS.north);
const southEast = geoToWorld(GAMEPLAY_MAP_GEO_BOUNDS.east, GAMEPLAY_MAP_GEO_BOUNDS.south);

export const GAMEPLAY_MAP_BOUNDS = {
  minX: northWest.x,
  minZ: northWest.z,
  maxX: southEast.x,
  maxZ: southEast.z,
} as const;
