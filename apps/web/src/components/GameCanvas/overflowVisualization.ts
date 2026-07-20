import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  HeightReference,
  Math as CesiumMath,
  PolylineGlowMaterialProperty,
  Viewer,
} from "cesium";
import type { OverflowSite } from "../../features/disaster/services/floodSimulation";

const ENTITY_PREFIX = "overflow-";
const LEGACY_FLOOD_ZONE_PREFIX = "flood-zone-";

/**
 * 決壊（越水）地点を明示し、そこから市街地方向へ浸水が広がる様子を描く。
 * 無関係な固定エリアの浸水表示は使わない。
 */
export function syncOverflowVisualization(
  viewer: Viewer,
  sites: readonly OverflowSite[],
  floodDepthMeters: number,
  floodedAreaPercent: number,
): void {
  clearLegacyFloodZones(viewer);

  const activeIds = new Set(sites.map((site) => site.id));
  for (const entity of [...viewer.entities.values]) {
    if (!entity.id.startsWith(ENTITY_PREFIX)) {
      continue;
    }
    const siteId = siteIdFromEntityId(entity.id);
    if (siteId !== undefined && !activeIds.has(siteId)) {
      viewer.entities.remove(entity);
    }
  }

  if (sites.length === 0) {
    viewer.scene.requestRender();
    return;
  }

  const depthScale = Math.max(0.35, Math.min(1.5, 0.35 + floodDepthMeters * 0.75));
  const areaScale = Math.max(0.2, Math.sqrt(Math.max(floodedAreaPercent, 1) / 100));
  const intensitySum = sites.reduce((sum, site) => sum + site.intensity, 0) || 1;

  for (const site of sites) {
    const heading = CesiumMath.toRadians(site.outflowHeadingDegrees);
    const share = site.intensity / intensitySum;
    const reach =
      120 +
      site.intensity * 280 * depthScale +
      floodedAreaPercent * 4.5 * share * areaScale;

    // --- 決壊口（氾濫の元）---
    upsertEllipse(viewer, `${ENTITY_PREFIX}breach-core-${site.id}`, {
      longitude: site.longitude,
      latitude: site.latitude,
      major: 22 + site.intensity * 16,
      minor: 14 + site.intensity * 10,
      rotation: heading,
      height: 0.45 + site.intensity * 0.4,
      fill: Color.fromCssColorString("#ff5a3c").withAlpha(0.72 + site.intensity * 0.2),
      outline: Color.fromCssColorString("#ffe0d4").withAlpha(0.95),
      outlineWidth: 3,
    });
    upsertEllipse(viewer, `${ENTITY_PREFIX}breach-ring-${site.id}`, {
      longitude: site.longitude,
      latitude: site.latitude,
      major: 36 + site.intensity * 24,
      minor: 28 + site.intensity * 16,
      rotation: heading,
      height: 0.2,
      fill: Color.fromCssColorString("#ff8a4a").withAlpha(0.18 + site.intensity * 0.12),
      outline: Color.fromCssColorString("#ffb089").withAlpha(0.85),
      outlineWidth: 2,
    });

    // --- 決壊口から伸びる浸水域（流出方向に偏った楕円）---
    const inundationCenter = offsetLonLat(
      site.longitude,
      site.latitude,
      Math.sin(heading) * (reach * 0.48),
      Math.cos(heading) * (reach * 0.48),
    );
    upsertEllipse(viewer, `${ENTITY_PREFIX}inundation-${site.id}`, {
      longitude: inundationCenter.longitude,
      latitude: inundationCenter.latitude,
      major: reach,
      minor: reach * (0.42 + site.intensity * 0.12),
      rotation: heading,
      height: Math.max(0.1, floodDepthMeters * 0.28 * (0.55 + site.intensity * 0.45)),
      fill: Color.fromCssColorString("#1aa0d4").withAlpha(
        0.2 + Math.min(0.38, floodDepthMeters * 0.14) + site.intensity * 0.12,
      ),
      outline: Color.fromCssColorString("#8ad8ff").withAlpha(0.55),
      outlineWidth: 2,
    });

    // 手前の濃いプルーム（決壊直後の勢い）
    const plumeCenter = offsetLonLat(
      site.longitude,
      site.latitude,
      Math.sin(heading) * (reach * 0.22),
      Math.cos(heading) * (reach * 0.22),
    );
    upsertEllipse(viewer, `${ENTITY_PREFIX}plume-${site.id}`, {
      longitude: plumeCenter.longitude,
      latitude: plumeCenter.latitude,
      major: 70 + site.intensity * 140 * depthScale,
      minor: 36 + site.intensity * 70 * depthScale,
      rotation: heading,
      height: Math.max(0.12, floodDepthMeters * 0.32 * site.intensity),
      fill: Color.fromCssColorString("#1490c8").withAlpha(0.28 + site.intensity * 0.28),
      outline: Color.fromCssColorString("#b8f0ff").withAlpha(0.5),
      outlineWidth: 2,
    });

    // --- 流出ストリーク（決壊口 → 浸水域の先端）---
    for (let streak = 0; streak < 4; streak += 1) {
      const side = (streak - 1.5) * (14 + site.intensity * 12);
      const start = offsetLonLat(
        site.longitude,
        site.latitude,
        Math.sin(heading) * 6 + Math.cos(heading) * side * 0.35,
        Math.cos(heading) * 6 - Math.sin(heading) * side * 0.35,
      );
      const end = offsetLonLat(
        site.longitude,
        site.latitude,
        Math.sin(heading) * (reach * 0.92) + Math.cos(heading) * side,
        Math.cos(heading) * (reach * 0.92) - Math.sin(heading) * side,
      );
      const streakId = `${ENTITY_PREFIX}streak-${site.id}-${streak}`;
      const positions = Cartesian3.fromDegreesArray([
        start.longitude,
        start.latitude,
        end.longitude,
        end.latitude,
      ]);
      const existing = viewer.entities.getById(streakId);
      const width = 5 + site.intensity * 7 + floodDepthMeters * 2;
      const material = new PolylineGlowMaterialProperty({
        glowPower: 0.3,
        taperPower: 0.45,
        color: Color.fromCssColorString("#e7fbff").withAlpha(0.42 + site.intensity * 0.4),
      });
      if (existing?.polyline !== undefined) {
        existing.polyline.positions = new ConstantProperty(positions);
        existing.polyline.width = new ConstantProperty(width);
        existing.polyline.material = material;
      } else {
        viewer.entities.add({
          id: streakId,
          polyline: {
            positions,
            width: new ConstantProperty(width),
            clampToGround: true,
            material,
          },
        });
      }
    }
  }

  viewer.scene.requestRender();
}

/** 旧来の固定浸水ゾーンを除去する。 */
export function clearLegacyFloodZones(viewer: Viewer): void {
  for (const entity of [...viewer.entities.values]) {
    if (entity.id.startsWith(LEGACY_FLOOD_ZONE_PREFIX)) {
      viewer.entities.remove(entity);
    }
  }
}

export function getBreachDisplayName(siteId: string): string {
  const names: Record<string, string> = {
    "campus-south": "決壊・南",
    "campus-core": "決壊・キャンパス前",
    "campus-north": "決壊・北",
    "mid-east": "決壊・中流",
    "north-bend": "決壊・湾曲部",
  };
  return names[siteId] ?? "決壊地点";
}

function upsertEllipse(
  viewer: Viewer,
  id: string,
  options: {
    longitude: number;
    latitude: number;
    major: number;
    minor: number;
    rotation: number;
    height: number;
    fill: Color;
    outline: Color;
    outlineWidth?: number;
  },
): void {
  const existing = viewer.entities.getById(id);
  const position = Cartesian3.fromDegrees(options.longitude, options.latitude);
  if (existing?.ellipse !== undefined) {
    existing.position = new ConstantPositionProperty(position);
    existing.ellipse.semiMajorAxis = new ConstantProperty(options.major);
    existing.ellipse.semiMinorAxis = new ConstantProperty(options.minor);
    existing.ellipse.rotation = new ConstantProperty(options.rotation);
    existing.ellipse.height = new ConstantProperty(options.height);
    existing.ellipse.material = new ColorMaterialProperty(options.fill);
    existing.ellipse.outlineColor = new ConstantProperty(options.outline);
    existing.ellipse.outlineWidth = new ConstantProperty(options.outlineWidth ?? 2);
    existing.show = true;
    return;
  }
  viewer.entities.add({
    id,
    position,
    ellipse: {
      semiMajorAxis: options.major,
      semiMinorAxis: options.minor,
      rotation: options.rotation,
      height: options.height,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: options.fill,
      outline: true,
      outlineColor: options.outline,
      outlineWidth: options.outlineWidth ?? 2,
    },
  });
}

function siteIdFromEntityId(entityId: string): string | undefined {
  const withoutPrefix = entityId.slice(ENTITY_PREFIX.length);
  const parts = withoutPrefix.split("-");
  if (parts.length < 2) {
    return undefined;
  }
  const kind = parts[0];
  // breach-core-campus-core / inundation-campus-south / streak-campus-core-0
  if (kind === "streak") {
    return parts.slice(1, -1).join("-");
  }
  if (kind === "breach" && (parts[1] === "core" || parts[1] === "ring")) {
    return parts.slice(2).join("-");
  }
  return parts.slice(1).join("-");
}

function offsetLonLat(
  longitude: number,
  latitude: number,
  eastMeters: number,
  northMeters: number,
): { longitude: number; latitude: number } {
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLon = 111_320 * Math.cos(CesiumMath.toRadians(latitude));
  return {
    longitude: longitude + eastMeters / metersPerDegreeLon,
    latitude: latitude + northMeters / metersPerDegreeLat,
  };
}
