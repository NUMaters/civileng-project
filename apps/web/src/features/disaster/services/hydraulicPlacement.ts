import type { PlacedStructure } from "../../construction";
import {
  ABUKUMA_RIVER_CENTERLINE,
  NORMAL_CHANNEL_HALF_WIDTH_M,
  PLACEABLE_CORRIDOR_HALF_WIDTH_M,
} from "../../../components/GameCanvas/abukumaRiverGeometry";
import { nearestPointOnPolyline } from "../../../components/GameCanvas/riverPlacement";

export type RiverPlacementContext = {
  /** 中心線までの距離（m）。 */
  distanceToCenterlineMeters: number;
  /** 中心線の接線方位（度、北=0・時計回り）。 */
  channelHeadingDegrees: number;
  /** 施設向きと河道の平行度 0〜1（1=完全に川沿い）。 */
  alignmentWithChannel: number;
  /** true なら本川寄りの河道内。 */
  inChannel: boolean;
  /** true なら河岸帯（堤防・護岸の適地）。 */
  onBank: boolean;
};

/**
 * 配置位置の河道幾何コンテキスト（高低差以外）。
 * 施設効果・向きの妥当性に使う。
 */
export function getRiverPlacementContext(
  longitude: number,
  latitude: number,
  headingDegrees: number,
): RiverPlacementContext {
  const nearest = nearestPointOnPolyline(longitude, latitude, ABUKUMA_RIVER_CENTERLINE);
  const channelHeadingDegrees = channelHeadingAtNearest(longitude, latitude);
  const alignmentWithChannel = headingAlignmentScore(headingDegrees, channelHeadingDegrees);
  const distanceToCenterlineMeters = nearest.distanceMeters;
  const inChannel = distanceToCenterlineMeters <= NORMAL_CHANNEL_HALF_WIDTH_M * 0.85;
  const onBank =
    distanceToCenterlineMeters > NORMAL_CHANNEL_HALF_WIDTH_M * 0.55 &&
    distanceToCenterlineMeters <= PLACEABLE_CORRIDOR_HALF_WIDTH_M;

  return {
    distanceToCenterlineMeters,
    channelHeadingDegrees,
    alignmentWithChannel,
    inChannel,
    onBank,
  };
}

/**
 * 施設種別・位置・向き・標高から配置有効率（0.15〜1）を求める。
 * - 堤防・護岸: 河岸＋川平行向き＋相対的に高い天端が有利
 * - 河道掘削: 本川内が有利
 * - 遊水地・排水機場: 河岸〜低地寄りが有利
 */
export function calculateHydraulicEffectiveness(placement: PlacedStructure): number {
  const ctx = getRiverPlacementContext(
    placement.position.longitude,
    placement.position.latitude,
    placement.headingDegrees,
  );
  const structureId = placement.structureId;
  const rawHeight = placement.position.height;
  const heightMeters =
    typeof rawHeight === "number" && Number.isFinite(rawHeight) ? rawHeight : 18;

  let locationScore = 0.45;
  let headingScore = 0.7;
  let elevationScore = 0.75;

  switch (structureId) {
    case "levee":
    case "revetment": {
      // 河岸中央（約 50–65 m）が最適。河道中央や帯外縁は効きにくい。
      const ideal = 55;
      const bankDist = Math.abs(ctx.distanceToCenterlineMeters - ideal);
      locationScore = clamp(1.05 - bankDist / 55, 0.2, 1);
      if (ctx.onBank) {
        locationScore = Math.max(locationScore, 0.72);
      }
      if (ctx.inChannel) {
        locationScore *= 0.55;
      }
      headingScore = 0.35 + 0.65 * ctx.alignmentWithChannel;
      // 河床相当(~18m楕円体高付近)より高いほど堤防として有利（概算）。
      elevationScore = clamp(0.45 + (heightMeters - 16) / 14, 0.35, 1);
      break;
    }
    case "channel-dredging": {
      locationScore = ctx.inChannel
        ? 1
        : clamp(1.1 - ctx.distanceToCenterlineMeters / 70, 0.25, 0.85);
      headingScore = 0.55 + 0.45 * ctx.alignmentWithChannel;
      elevationScore = clamp(1.05 - (heightMeters - 15) / 20, 0.4, 1);
      break;
    }
    case "retention-basin": {
      // 河岸外側寄りの低地で貯留しやすい。
      locationScore = ctx.onBank
        ? clamp(0.55 + (ctx.distanceToCenterlineMeters - 40) / 80, 0.4, 1)
        : clamp(0.9 - ctx.distanceToCenterlineMeters / 120, 0.25, 0.75);
      headingScore = 0.65 + 0.35 * ctx.alignmentWithChannel;
      elevationScore = clamp(1.1 - (heightMeters - 17) / 18, 0.4, 1);
      break;
    }
    case "drainage-pump": {
      locationScore = ctx.onBank || ctx.inChannel ? 0.85 : 0.45;
      headingScore = 0.7;
      elevationScore = clamp(1.05 - (heightMeters - 16) / 22, 0.4, 1);
      break;
    }
    default: {
      locationScore = clamp(1 - ctx.distanceToCenterlineMeters / 140, 0.25, 0.9);
      break;
    }
  }

  // 弱点（低岸）に近いほど局所防護として価値が上がる（後段で candidate 近接でも加算）。
  const combined = locationScore * 0.5 + headingScore * 0.28 + elevationScore * 0.22;
  return clamp(combined, 0.15, 1);
}

/** 施設が弱点地点を守るときの向きボーナス（流出方向に対して横切る堤防が有利）。 */
export function protectionHeadingBonus(
  placement: PlacedStructure,
  outflowHeadingDegrees: number,
): number {
  if (placement.structureId !== "levee" && placement.structureId !== "revetment") {
    return 1;
  }
  // 堤防法線が流出方向に近い（堤体が流れを横切る）ほど良い。
  const normal = normalizeHeading(placement.headingDegrees + 90);
  const align = headingAlignmentScore(normal, outflowHeadingDegrees);
  return 0.7 + 0.45 * align;
}

function channelHeadingAtNearest(longitude: number, latitude: number): number {
  const nearest = nearestPointOnPolyline(longitude, latitude, ABUKUMA_RIVER_CENTERLINE);
  let bestIndex = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ABUKUMA_RIVER_CENTERLINE.length; index += 1) {
    const point = ABUKUMA_RIVER_CENTERLINE[index];
    if (point === undefined) {
      continue;
    }
    const dist = Math.hypot(point.lon - nearest.longitude, point.lat - nearest.latitude);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = index;
    }
  }
  const start = ABUKUMA_RIVER_CENTERLINE[Math.max(0, bestIndex - 1)] ?? ABUKUMA_RIVER_CENTERLINE[0];
  const end =
    ABUKUMA_RIVER_CENTERLINE[Math.min(ABUKUMA_RIVER_CENTERLINE.length - 1, bestIndex + 1)] ??
    start;
  if (start === undefined || end === undefined) {
    return 0;
  }
  return bearingDegrees(start.lon, start.lat, end.lon, end.lat);
}

function headingAlignmentScore(headingA: number, headingB: number): number {
  const delta = Math.abs(smallestAngleDegrees(headingA, headingB));
  // 0° または 180°（平行）が最良。
  const parallelDelta = Math.min(delta, Math.abs(180 - delta));
  return clamp(1 - parallelDelta / 90, 0, 1);
}

function smallestAngleDegrees(a: number, b: number): number {
  let delta = normalizeHeading(a) - normalizeHeading(b);
  delta = ((delta + 540) % 360) - 180;
  return delta;
}

function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function bearingDegrees(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): number {
  const φ1 = (latA * Math.PI) / 180;
  const φ2 = (latB * Math.PI) / 180;
  const Δλ = ((lonB - lonA) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
