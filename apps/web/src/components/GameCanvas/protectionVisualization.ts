import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  CornerType,
  HeightReference,
  Math as CesiumMath,
  PolygonHierarchy,
  PolylineGlowMaterialProperty,
  Viewer,
} from "cesium";
import { getHazardMarkerColor } from "../../features/construction/structureVisuals";
import type {
  ProtectedBankSite,
  StructureInfluence,
} from "../../features/disaster/services/floodSimulation";
import {
  fanPolygonDegrees,
  stripCenterlineDegrees,
  type InfluenceZone,
} from "../../features/disaster/services/influenceZones";

const ZONE_PREFIX = "protect-zone-";
const ZONE_AXIS_PREFIX = "protect-zone-axis-";
const BANK_PREFIX = "protect-bank-";

const STRUCTURE_ZONE_COLOR: Record<string, string> = {
  levee: "#3ecf8e",
  revetment: "#e0a03a",
  "retention-basin": "#3aa8d8",
  "drainage-pump": "#5b9cf0",
  "channel-dredging": "#2db89a",
};

/**
 * 施設の影響圏と、弱点地点の抑え込み／越水状態を地図に描く。
 * strip は堤体長軸（向き+90°）、ellipse／fan は施設正面（向き）に追従する。
 */
export function syncProtectionVisualization(
  viewer: Viewer,
  influences: readonly StructureInfluence[],
  bankSites: readonly ProtectedBankSite[],
  options: { showBankSites: boolean },
): void {
  const keepBankIds = new Set(
    options.showBankSites ? bankSites.map((site) => `${BANK_PREFIX}${site.id}`) : [],
  );

  for (const entity of [...viewer.entities.values]) {
    if (entity.id.startsWith(ZONE_PREFIX) || entity.id.startsWith(ZONE_AXIS_PREFIX)) {
      viewer.entities.remove(entity);
    }
    if (entity.id.startsWith(BANK_PREFIX) && !keepBankIds.has(entity.id)) {
      viewer.entities.remove(entity);
    }
  }

  for (const influence of influences) {
    if (!Number.isFinite(influence.longitude) || !Number.isFinite(influence.latitude)) {
      continue;
    }
    // zone.heading と influence.heading を一致させて向きズレを防ぐ。
    const zone: InfluenceZone = {
      ...influence.zone,
      headingDegrees: influence.headingDegrees,
      longitude: influence.longitude,
      latitude: influence.latitude,
    };
    addInfluenceZoneEntity(viewer, { ...influence, zone }, influence.preview === true);
    addHeadingAxis(viewer, influence, zone);
  }

  if (options.showBankSites) {
    for (const site of bankSites) {
      const id = `${BANK_PREFIX}${site.id}`;
      const holding = !site.overflowing && site.protectionStrength >= 0.12;
      const hazardColor = getHazardMarkerColor(site.primaryHazard);
      const fill = holding
        ? Color.fromCssColorString("#3ecf8e").withAlpha(0.28 + site.protectionStrength * 0.35)
        : Color.fromCssColorString(hazardColor.fill).withAlpha(
            0.24 + site.protectionStrength * 0.15,
          );
      const outline = holding
        ? Color.fromCssColorString("#b8ffe0").withAlpha(0.85)
        : Color.fromCssColorString(hazardColor.outline).withAlpha(0.8);
      const radius = holding ? 38 + site.protectionStrength * 28 : 42 + site.protectionStrength * 20;
      const existing = viewer.entities.getById(id);
      const position = Cartesian3.fromDegrees(site.longitude, site.latitude);

      if (existing?.ellipse !== undefined) {
        existing.position = new ConstantPositionProperty(position);
        existing.ellipse.semiMajorAxis = new ConstantProperty(radius);
        existing.ellipse.semiMinorAxis = new ConstantProperty(radius * 0.72);
        existing.ellipse.material = new ColorMaterialProperty(fill);
        existing.ellipse.outlineColor = new ConstantProperty(outline);
        existing.show = true;
        continue;
      }

      viewer.entities.add({
        id,
        position,
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius * 0.72,
          height: 0.55,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          material: fill,
          outline: true,
          outlineColor: outline,
          outlineWidth: 2,
        },
      });
    }
  }
}

function addInfluenceZoneEntity(
  viewer: Viewer,
  influence: StructureInfluence,
  preview: boolean,
): void {
  const id = `${ZONE_PREFIX}${influence.placementId}`;
  const colorHex = STRUCTURE_ZONE_COLOR[influence.structureId] ?? "#58d5a1";
  const fillAlpha = preview ? 0.1 : 0.17;
  const outlineAlpha = preview ? 0.45 : 0.75;
  const fill = Color.fromCssColorString(colorHex).withAlpha(fillAlpha);
  const outline = Color.fromCssColorString(colorHex).withAlpha(outlineAlpha);
  const zone = influence.zone;

  if (zone.kind === "strip") {
    const positions = Cartesian3.fromDegreesArray(stripCenterlineDegrees(zone));
    viewer.entities.add({
      id,
      corridor: {
        positions,
        width: Math.max(24, zone.widthMeters),
        height: 0.32,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        material: fill,
        outline: true,
        outlineColor: outline,
        cornerType: CornerType.ROUNDED,
      },
    });
    return;
  }

  if (zone.kind === "fan") {
    const hierarchy = new PolygonHierarchy(
      Cartesian3.fromDegreesArray(fanPolygonDegrees(zone)),
    );
    viewer.entities.add({
      id,
      polygon: {
        hierarchy,
        height: 0.3,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        material: fill,
        outline: true,
        outlineColor: outline,
        outlineWidth: 1,
      },
    });
    return;
  }

  const major = zone.kind === "ellipse" ? zone.majorMeters : influence.radiusMeters;
  const minor = zone.kind === "ellipse" ? zone.minorMeters : influence.radiusMeters;
  // Cesium ellipse.rotation は北から反時計回り。施設 heading は北から時計回り。
  const rotation = -CesiumMath.toRadians(zone.headingDegrees);
  viewer.entities.add({
    id,
    position: Cartesian3.fromDegrees(influence.longitude, influence.latitude),
    ellipse: {
      semiMajorAxis: Math.max(30, major),
      semiMinorAxis: Math.max(20, minor),
      rotation,
      height: 0.32,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: fill,
      outline: true,
      outlineColor: outline,
      outlineWidth: 1,
    },
  });
}

/** 向きの主軸を細い線で示し、影響圏が施設向きに連動していることを明示する。 */
function addHeadingAxis(
  viewer: Viewer,
  influence: StructureInfluence,
  zone: InfluenceZone,
): void {
  const heading = CesiumMath.toRadians(zone.headingDegrees);
  const length =
    zone.kind === "strip"
      ? zone.lengthMeters * 0.52
      : zone.kind === "ellipse"
        ? zone.majorMeters * 0.55
        : zone.radiusMeters * 0.7;
  const start = offsetLonLat(
    influence.longitude,
    influence.latitude,
    -Math.sin(heading) * length * 0.15,
    -Math.cos(heading) * length * 0.15,
  );
  const end = offsetLonLat(
    influence.longitude,
    influence.latitude,
    Math.sin(heading) * length,
    Math.cos(heading) * length,
  );
  const colorHex = STRUCTURE_ZONE_COLOR[influence.structureId] ?? "#58d5a1";
  viewer.entities.add({
    id: `${ZONE_AXIS_PREFIX}${influence.placementId}`,
    polyline: {
      positions: Cartesian3.fromDegreesArray([
        start.longitude,
        start.latitude,
        end.longitude,
        end.latitude,
      ]),
      width: influence.preview === true ? 2.5 : 3.5,
      clampToGround: true,
      material: new PolylineGlowMaterialProperty({
        glowPower: 0.18,
        color: Color.fromCssColorString(colorHex).withAlpha(
          influence.preview === true ? 0.55 : 0.85,
        ),
      }),
    },
  });
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
