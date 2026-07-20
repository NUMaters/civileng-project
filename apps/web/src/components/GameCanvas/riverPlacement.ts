import type { GeoPosition } from "../../features/construction";
import {
  ABUKUMA_PLACEABLE_CORRIDOR,
  ABUKUMA_RIVER_CENTERLINE,
  ABUKUMA_WATER_SURFACE_POLYGON,
  NORMAL_CHANNEL_HALF_WIDTH_M,
  PLACEABLE_CORRIDOR_HALF_WIDTH_M,
  type LonLat,
} from "./abukumaRiverGeometry";

export {
  NORMAL_CHANNEL_HALF_WIDTH_M,
  PLACEABLE_CORRIDOR_HALF_WIDTH_M,
};

export type RiverNearestPoint = {
  longitude: number;
  latitude: number;
  distanceMeters: number;
};

/**
 * 河道＋河岸の配置可能域か（中心線からの距離、またはコリドー／水面ポリゴン内）。
 * 氾濫原（片岸 200 m）や市街地は含めない。
 */
export function isInPlaceableRiverZone(position: GeoPosition): boolean {
  if (pointInPolygonDegrees(position.longitude, position.latitude, ABUKUMA_PLACEABLE_CORRIDOR)) {
    return true;
  }
  // コリドーの角丸近似で漏れた水面縁を救う。
  if (pointInPolygonDegrees(position.longitude, position.latitude, ABUKUMA_WATER_SURFACE_POLYGON)) {
    return true;
  }
  const nearest = nearestPointOnPolyline(
    position.longitude,
    position.latitude,
    ABUKUMA_RIVER_CENTERLINE,
  );
  return nearest.distanceMeters <= PLACEABLE_CORRIDOR_HALF_WIDTH_M;
}

/**
 * 施設ドロップ座標を解決する。
 * - 河道・河岸内: ドロップ位置を維持（河岸に堤防などを置ける）
 * - 河道中央付近のわずかなずれ: 中心線へ軽く寄せる（任意）
 * - それ以外（市街地など）: undefined
 */
export function resolvePlaceablePosition(position: GeoPosition): GeoPosition | undefined {
  const nearest = nearestPointOnPolyline(
    position.longitude,
    position.latitude,
    ABUKUMA_RIVER_CENTERLINE,
  );

  const inWater = pointInPolygonDegrees(
    position.longitude,
    position.latitude,
    ABUKUMA_WATER_SURFACE_POLYGON,
  );
  const inCorridor = pointInPolygonDegrees(
    position.longitude,
    position.latitude,
    ABUKUMA_PLACEABLE_CORRIDOR,
  );

  if (
    !inWater &&
    !inCorridor &&
    nearest.distanceMeters > PLACEABLE_CORRIDOR_HALF_WIDTH_M
  ) {
    return undefined;
  }

  // 本川中央付近だけ、タップずれを中心線へ寄せる。河岸はそのまま残す。
  if (!inWater && nearest.distanceMeters <= NORMAL_CHANNEL_HALF_WIDTH_M * 0.45) {
    return {
      longitude: nearest.longitude,
      latitude: nearest.latitude,
      height: position.height,
    };
  }

  return position;
}

export function nearestPointOnRiverCenterline(
  longitude: number,
  latitude: number,
): RiverNearestPoint {
  return nearestPointOnPolyline(longitude, latitude, ABUKUMA_RIVER_CENTERLINE);
}

export function pointInPolygonDegrees(
  longitude: number,
  latitude: number,
  ring: ReadonlyArray<LonLat>,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const pi = ring[i];
    const pj = ring[j];
    if (pi === undefined || pj === undefined) {
      continue;
    }
    const intersects =
      pi.lat > latitude !== pj.lat > latitude &&
      longitude <
        ((pj.lon - pi.lon) * (latitude - pi.lat)) / (pj.lat - pi.lat + Number.EPSILON) + pi.lon;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function nearestPointOnPolyline(
  longitude: number,
  latitude: number,
  line: ReadonlyArray<LonLat>,
): RiverNearestPoint {
  let best: RiverNearestPoint = {
    longitude: line[0]?.lon ?? longitude,
    latitude: line[0]?.lat ?? latitude,
    distanceMeters: Number.POSITIVE_INFINITY,
  };

  for (let index = 0; index < line.length - 1; index += 1) {
    const start = line[index];
    const end = line[index + 1];
    if (start === undefined || end === undefined) {
      continue;
    }
    const candidate = nearestPointOnSegment(
      longitude,
      latitude,
      start.lon,
      start.lat,
      end.lon,
      end.lat,
    );
    if (candidate.distanceMeters < best.distanceMeters) {
      best = candidate;
    }
  }

  return best;
}

function nearestPointOnSegment(
  longitude: number,
  latitude: number,
  startLon: number,
  startLat: number,
  endLon: number,
  endLat: number,
): RiverNearestPoint {
  const metersPerDegreeLat = 110_540;
  const midLat = (startLat + endLat) * 0.5;
  const metersPerDegreeLon = 111_320 * Math.cos((midLat * Math.PI) / 180);

  const px = (longitude - startLon) * metersPerDegreeLon;
  const py = (latitude - startLat) * metersPerDegreeLat;
  const vx = (endLon - startLon) * metersPerDegreeLon;
  const vy = (endLat - startLat) * metersPerDegreeLat;
  const segmentLengthSquared = vx * vx + vy * vy;
  const t =
    segmentLengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, (px * vx + py * vy) / segmentLengthSquared));

  return {
    longitude: startLon + (t * vx) / metersPerDegreeLon,
    latitude: startLat + (t * vy) / metersPerDegreeLat,
    distanceMeters: Math.hypot(px - vx * t, py - vy * t),
  };
}
