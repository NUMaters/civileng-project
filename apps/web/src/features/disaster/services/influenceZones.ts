import type { PlacedStructure } from "../../construction";

/**
 * 施設影響圏の幾何。
 * 丸一律ではなく、治水の役割に合わせた形にする。
 */
export type InfluenceZoneGeometry =
  | {
      /** 堤防・護岸・河道掘削: 堤体／掘削線（向き+90°）に沿った帯 */
      kind: "strip";
      lengthMeters: number;
      widthMeters: number;
    }
  | {
      /** 遊水地: 貯留域の楕円 */
      kind: "ellipse";
      majorMeters: number;
      minorMeters: number;
    }
  | {
      /** 排水機場: 市街地側へ開く扇形 */
      kind: "fan";
      radiusMeters: number;
      sweepDegrees: number;
    };

export type InfluenceZone = InfluenceZoneGeometry & {
  longitude: number;
  latitude: number;
  headingDegrees: number;
  structureId: string;
  /** 互換・HUD 用の最大到達距離 */
  extentMeters: number;
};

/**
 * 帯状施設（堤防・護岸・河道掘削）の長軸方位。
 *
 * Cesium Box は dimensions=(length,width,height)→(X,Y,Z)。
 * HPR=0 で X=東・Y=北のため、模型の長軸（length）は施設向き +90°。
 * 向き矢印（heading）は法面側＝横断方向を指す。
 */
export function stripLongAxisHeadingDegrees(placementHeadingDegrees: number): number {
  return normalizeDegrees(placementHeadingDegrees + 90);
}

/**
 * 施設種別・向き・配置効率から影響圏ジオメトリを決める。
 * - strip: 長軸＝3D 模型の堤体／掘削線（向き +90°）
 * - ellipse / fan: 主軸＝placement.headingDegrees（施設の正面）
 */
export function resolveInfluenceZone(
  placement: PlacedStructure,
  effectiveness: number,
): InfluenceZone {
  const scale = 0.72 + 0.28 * clamp(effectiveness, 0.15, 1);
  const facingDegrees = normalizeDegrees(placement.headingDegrees);
  const base = {
    longitude: placement.position.longitude,
    latitude: placement.position.latitude,
    structureId: placement.structureId,
  };

  switch (placement.structureId) {
    case "levee": {
      // 堤防線: 堤体に沿って長く、横断は狭い。
      const lengthMeters = 380 * scale;
      const widthMeters = 56 * scale;
      return {
        ...base,
        headingDegrees: stripLongAxisHeadingDegrees(facingDegrees),
        kind: "strip",
        lengthMeters,
        widthMeters,
        extentMeters: Math.hypot(lengthMeters / 2, widthMeters / 2),
      };
    }
    case "revetment": {
      // 護岸: 堤防より短く岸に密着（長軸＝護岸線）。
      const lengthMeters = 220 * scale;
      const widthMeters = 42 * scale;
      return {
        ...base,
        headingDegrees: stripLongAxisHeadingDegrees(facingDegrees),
        kind: "strip",
        lengthMeters,
        widthMeters,
        extentMeters: Math.hypot(lengthMeters / 2, widthMeters / 2),
      };
    }
    case "channel-dredging": {
      // 河道掘削: 掘削線に沿った長いコリドー。
      const lengthMeters = 520 * scale;
      const widthMeters = 88 * scale;
      return {
        ...base,
        headingDegrees: stripLongAxisHeadingDegrees(facingDegrees),
        kind: "strip",
        lengthMeters,
        widthMeters,
        extentMeters: Math.hypot(lengthMeters / 2, widthMeters / 2),
      };
    }
    case "retention-basin": {
      // 遊水地: 貯留面の楕円（長軸＝施設向き）。
      const majorMeters = 300 * scale;
      const minorMeters = 170 * scale;
      return {
        ...base,
        headingDegrees: facingDegrees,
        kind: "ellipse",
        majorMeters,
        minorMeters,
        extentMeters: majorMeters,
      };
    }
    case "drainage-pump": {
      // 排水: 施設が向く側（内水側）へ扇状に効く。
      const radiusMeters = 240 * scale;
      const sweepDegrees = 110;
      return {
        ...base,
        headingDegrees: facingDegrees,
        kind: "fan",
        radiusMeters,
        sweepDegrees,
        extentMeters: radiusMeters,
      };
    }
    default: {
      const radiusMeters = 180 * scale;
      return {
        ...base,
        headingDegrees: facingDegrees,
        kind: "ellipse",
        majorMeters: radiusMeters,
        minorMeters: radiusMeters,
        extentMeters: radiusMeters,
      };
    }
  }
}

/**
 * 弱点地点に対する影響の強さ 0〜1（形に応じた減衰）。
 */
export function influenceStrengthAt(
  zone: InfluenceZone,
  longitude: number,
  latitude: number,
): number {
  const { east, north } = metersOffset(
    zone.longitude,
    zone.latitude,
    longitude,
    latitude,
  );
  const heading = toRadians(zone.headingDegrees);
  // 施設前方 = heading、右 = heading+90°
  const along = east * Math.sin(heading) + north * Math.cos(heading);
  const lateral = east * Math.cos(heading) - north * Math.sin(heading);

  switch (zone.kind) {
    case "strip": {
      const halfLen = zone.lengthMeters / 2;
      const halfWid = zone.widthMeters / 2;
      const alongPenalty =
        Math.abs(along) <= halfLen
          ? 0
          : (Math.abs(along) - halfLen) / Math.max(40, halfLen * 0.35);
      const lateralPenalty = Math.abs(lateral) / Math.max(12, halfWid);
      const score = Math.exp(-(alongPenalty * 1.1 + lateralPenalty * 1.35));
      return clamp(score, 0, 1);
    }
    case "ellipse": {
      const nx = along / Math.max(1, zone.majorMeters);
      const ny = lateral / Math.max(1, zone.minorMeters);
      const r = Math.hypot(nx, ny);
      return clamp(Math.exp(-r * 1.15), 0, 1);
    }
    case "fan": {
      const distance = Math.hypot(along, lateral);
      if (distance < 1) {
        return 1;
      }
      // 扇の中心は施設の正面（+along）。背面はほぼ効かない。
      const bearing = (Math.atan2(lateral, along) * 180) / Math.PI;
      const halfSweep = zone.sweepDegrees / 2;
      const anglePenalty =
        Math.abs(bearing) <= halfSweep
          ? 0
          : (Math.abs(bearing) - halfSweep) / Math.max(18, halfSweep);
      const radialPenalty = distance / Math.max(1, zone.radiusMeters);
      return clamp(Math.exp(-(radialPenalty * 1.05 + anglePenalty * 1.8)), 0, 1);
    }
    default:
      return 0;
  }
}

/** 帯の中心線（描画用）。 */
export function stripCenterlineDegrees(zone: InfluenceZone & { kind: "strip" }): number[] {
  const half = zone.lengthMeters / 2;
  const heading = toRadians(zone.headingDegrees);
  const start = offsetLonLat(
    zone.longitude,
    zone.latitude,
    -Math.sin(heading) * half,
    -Math.cos(heading) * half,
  );
  const end = offsetLonLat(
    zone.longitude,
    zone.latitude,
    Math.sin(heading) * half,
    Math.cos(heading) * half,
  );
  return [start.longitude, start.latitude, end.longitude, end.latitude];
}

/** 扇形ポリゴン（描画用、閉じた lon/lat 列）。 */
export function fanPolygonDegrees(zone: InfluenceZone & { kind: "fan" }): number[] {
  const heading = zone.headingDegrees;
  const half = zone.sweepDegrees / 2;
  const degrees: number[] = [zone.longitude, zone.latitude];
  const steps = 14;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = toRadians(heading - half + zone.sweepDegrees * t);
    const point = offsetLonLat(
      zone.longitude,
      zone.latitude,
      Math.sin(angle) * zone.radiusMeters,
      Math.cos(angle) * zone.radiusMeters,
    );
    degrees.push(point.longitude, point.latitude);
  }
  degrees.push(zone.longitude, zone.latitude);
  return degrees;
}

function metersOffset(
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
): { east: number; north: number } {
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLon = 111_320 * Math.cos(toRadians(fromLat));
  return {
    east: (toLon - fromLon) * metersPerDegreeLon,
    north: (toLat - fromLat) * metersPerDegreeLat,
  };
}

function offsetLonLat(
  longitude: number,
  latitude: number,
  eastMeters: number,
  northMeters: number,
): { longitude: number; latitude: number } {
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLon = 111_320 * Math.cos(toRadians(latitude));
  return {
    longitude: longitude + eastMeters / metersPerDegreeLon,
    latitude: latitude + northMeters / metersPerDegreeLat,
  };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function normalizeDegrees(degrees: number): number {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
