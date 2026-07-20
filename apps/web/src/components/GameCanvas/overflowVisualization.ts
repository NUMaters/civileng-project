import {
  Cartesian3,
  Color,
  ConstantProperty,
  HeightReference,
  Math as CesiumMath,
  PolylineGlowMaterialProperty,
  Viewer,
} from "cesium";
import type { OverflowSite } from "../../features/disaster/services/floodSimulation";

const ENTITY_PREFIX = "overflow-";

/**
 * 局所越水を岸から市街地方向へ広がるプルームと流出ストリークで描画する。
 */
export function syncOverflowVisualization(
  viewer: Viewer,
  sites: readonly OverflowSite[],
  floodDepthMeters: number,
): void {
  for (const entity of [...viewer.entities.values]) {
    if (entity.id.startsWith(ENTITY_PREFIX)) {
      viewer.entities.remove(entity);
    }
  }

  if (sites.length === 0) {
    viewer.scene.requestRender();
    return;
  }

  const depthScale = Math.max(0.35, Math.min(1.4, 0.4 + floodDepthMeters * 0.7));

  for (const [index, site] of sites.entries()) {
    const heading = CesiumMath.toRadians(site.outflowHeadingDegrees);
    const plumeLength = 90 + site.intensity * 220 * depthScale;
    const plumeWidth = 45 + site.intensity * 110 * depthScale;
    const center = offsetLonLat(
      site.longitude,
      site.latitude,
      Math.sin(heading) * (plumeLength * 0.42),
      Math.cos(heading) * (plumeLength * 0.42),
    );

    viewer.entities.add({
      id: `${ENTITY_PREFIX}plume-${site.id}`,
      position: Cartesian3.fromDegrees(center.longitude, center.latitude),
      ellipse: {
        semiMajorAxis: plumeLength,
        semiMinorAxis: plumeWidth,
        rotation: heading,
        height: Math.max(0.08, floodDepthMeters * 0.22 * site.intensity),
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        material: Color.fromCssColorString("#1aa8e0").withAlpha(0.22 + site.intensity * 0.34),
        outline: true,
        outlineColor: Color.fromCssColorString("#b8f0ff").withAlpha(0.45 + site.intensity * 0.35),
        outlineWidth: 2,
      },
    });

    // 越水口（岸の割れ目）
    viewer.entities.add({
      id: `${ENTITY_PREFIX}breach-${site.id}`,
      position: Cartesian3.fromDegrees(site.longitude, site.latitude, 1.2),
      ellipse: {
        semiMajorAxis: 18 + site.intensity * 22,
        semiMinorAxis: 10 + site.intensity * 12,
        rotation: heading,
        height: 0.2 + site.intensity * 0.35,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        material: Color.fromCssColorString("#7ad8ff").withAlpha(0.55 + site.intensity * 0.3),
        outline: true,
        outlineColor: Color.WHITE.withAlpha(0.7),
      },
    });

    // 市街地側へ伸びる流出ストリーク（3 本）
    for (let streak = 0; streak < 3; streak += 1) {
      const side = (streak - 1) * (12 + site.intensity * 10);
      const start = offsetLonLat(
        site.longitude,
        site.latitude,
        Math.sin(heading) * 8 + Math.cos(heading) * side,
        Math.cos(heading) * 8 - Math.sin(heading) * side,
      );
      const end = offsetLonLat(
        site.longitude,
        site.latitude,
        Math.sin(heading) * (70 + site.intensity * 160 * depthScale) + Math.cos(heading) * side * 1.4,
        Math.cos(heading) * (70 + site.intensity * 160 * depthScale) - Math.sin(heading) * side * 1.4,
      );
      viewer.entities.add({
        id: `${ENTITY_PREFIX}streak-${site.id}-${streak}`,
        polyline: {
          positions: Cartesian3.fromDegreesArray([
            start.longitude,
            start.latitude,
            end.longitude,
            end.latitude,
          ]),
          width: new ConstantProperty(6 + site.intensity * 8),
          clampToGround: true,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.28,
            taperPower: 0.4,
            color: Color.fromCssColorString("#e7fbff").withAlpha(0.4 + site.intensity * 0.4),
          }),
        },
      });
    }

    void index;
  }

  viewer.scene.requestRender();
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
