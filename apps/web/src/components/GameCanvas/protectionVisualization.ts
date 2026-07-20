import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  HeightReference,
  Viewer,
} from "cesium";
import type {
  ProtectedBankSite,
  StructureInfluence,
} from "../../features/disaster/services/floodSimulation";

const ZONE_PREFIX = "protect-zone-";
const BANK_PREFIX = "protect-bank-";

const STRUCTURE_ZONE_COLOR: Record<string, string> = {
  levee: "#3ecf8e",
  revetment: "#6bc4a0",
  "retention-basin": "#3aa8d8",
  "drainage-pump": "#5b9cf0",
  "channel-dredging": "#2db89a",
};

/**
 * 施設の影響圏と、弱点地点の抑え込み／越水状態を地図に描く。
 * 配置した瞬間から「川のどこに効いているか」が分かるようにする。
 */
export function syncProtectionVisualization(
  viewer: Viewer,
  influences: readonly StructureInfluence[],
  bankSites: readonly ProtectedBankSite[],
  options: { showBankSites: boolean },
): void {
  const keepZoneIds = new Set(influences.map((item) => `${ZONE_PREFIX}${item.placementId}`));
  const keepBankIds = new Set(
    options.showBankSites ? bankSites.map((site) => `${BANK_PREFIX}${site.id}`) : [],
  );

  for (const entity of [...viewer.entities.values]) {
    if (entity.id.startsWith(ZONE_PREFIX) && !keepZoneIds.has(entity.id)) {
      viewer.entities.remove(entity);
    }
    if (entity.id.startsWith(BANK_PREFIX) && !keepBankIds.has(entity.id)) {
      viewer.entities.remove(entity);
    }
  }

  for (const influence of influences) {
    const id = `${ZONE_PREFIX}${influence.placementId}`;
    const colorHex = STRUCTURE_ZONE_COLOR[influence.structureId] ?? "#58d5a1";
    const fill = Color.fromCssColorString(colorHex).withAlpha(0.14);
    const outline = Color.fromCssColorString(colorHex).withAlpha(0.7);
    const existing = viewer.entities.getById(id);
    if (!Number.isFinite(influence.longitude) || !Number.isFinite(influence.latitude)) {
      continue;
    }
    const radius = Number.isFinite(influence.radiusMeters)
      ? Math.max(20, influence.radiusMeters)
      : 180;
    const position = Cartesian3.fromDegrees(influence.longitude, influence.latitude);

    if (existing?.ellipse !== undefined) {
      existing.position = new ConstantPositionProperty(position);
      existing.ellipse.semiMajorAxis = new ConstantProperty(radius);
      existing.ellipse.semiMinorAxis = new ConstantProperty(radius);
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
        semiMinorAxis: radius,
        height: 0.35,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        material: fill,
        outline: true,
        outlineColor: outline,
        outlineWidth: 1,
      },
    });
  }

  if (options.showBankSites) {
    for (const site of bankSites) {
      const id = `${BANK_PREFIX}${site.id}`;
      const holding = !site.overflowing && site.protectionStrength >= 0.12;
      const fill = holding
        ? Color.fromCssColorString("#3ecf8e").withAlpha(0.28 + site.protectionStrength * 0.35)
        : Color.fromCssColorString("#ff8b6b").withAlpha(0.22 + site.protectionStrength * 0.15);
      const outline = holding
        ? Color.fromCssColorString("#b8ffe0").withAlpha(0.85)
        : Color.fromCssColorString("#ffd0c4").withAlpha(0.75);
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

  viewer.scene.requestRender();
}
