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
  PolylineDashMaterialProperty,
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
import {
  listOverflowCandidates,
  type OverflowCandidate,
} from "../../features/disaster/services/overflowBankSites";

const ZONE_PREFIX = "protect-zone-";
const ZONE_AXIS_PREFIX = "protect-zone-axis-";
const BANK_PREFIX = "protect-bank-";
const TARGET_PREFIX = "weakness-target-";
const OUTCOME_PREFIX = "facility-outcome-";
const OUTCOME_LINK_PREFIX = "facility-outcome-link-";
const OUTCOME_WATER_PREFIX = "facility-water-effect-";

const STRUCTURE_ZONE_COLOR: Record<string, string> = {
  levee: "#3ecf8e",
  revetment: "#e0a03a",
  "retention-basin": "#3aa8d8",
  "drainage-pump": "#5b9cf0",
  "channel-dredging": "#2db89a",
};

const COVERAGE_ZONE_COLOR: Record<StructureInfluence["coverageTone"], string> = {
  good: "#3ecf8e",
  warn: "#e0b040",
  bad: "#e07060",
};

/** 静的な影響圏を洪水更新ごとに remove/add しないための描画指紋。 */
const staticVisualKeys = new WeakMap<Viewer, string>();

/**
 * 施設の影響圏と、弱点地点の抑え込み／越水状態を地図に描く。
 * strip は堤体長軸（向き+90°）、ellipse／fan は施設正面（向き）に追従する。
 */
export function syncProtectionVisualization(
  viewer: Viewer,
  influences: readonly StructureInfluence[],
  bankSites: readonly ProtectedBankSite[],
  options: {
    showBankSites: boolean;
    /**
     * 弱点マーカー。準備／災害中かつ配置操作中のみ出す。
     * 未開始・未配置時は出さない（決壊と紛らわしい）。
     */
    showWeaknessTargets: boolean;
  },
): void {
  const keepBankIds = new Set(
    options.showBankSites ? bankSites.map((site) => `${BANK_PREFIX}${site.id}`) : [],
  );
  const coveredIds = new Set(influences.flatMap((item) => item.coveredSiteIds));
  const adverseIds = new Set(influences.flatMap((item) => item.adverseSiteIds ?? []));
  const staticVisualKey = buildStaticVisualKey(
    influences,
    options.showWeaknessTargets,
    coveredIds,
    adverseIds,
  );
  const rebuildStaticVisuals = staticVisualKeys.get(viewer) !== staticVisualKey;

  for (const entity of [...viewer.entities.values]) {
    if (rebuildStaticVisuals && isStaticProtectionEntity(entity.id)) {
      viewer.entities.remove(entity);
    }
    if (entity.id.startsWith(BANK_PREFIX) && !keepBankIds.has(entity.id)) {
      viewer.entities.remove(entity);
    }
  }

  if (rebuildStaticVisuals && options.showWeaknessTargets) {
    for (const candidate of listOverflowCandidates()) {
      addWeaknessTargetMarker(
        viewer,
        candidate,
        adverseIds.has(candidate.id)
          ? "adverse"
          : coveredIds.has(candidate.id)
            ? "covered"
            : "idle",
      );
    }
  }

  for (const influence of rebuildStaticVisuals ? influences : []) {
    if (!Number.isFinite(influence.longitude) || !Number.isFinite(influence.latitude)) {
      continue;
    }
    const zone: InfluenceZone = {
      ...influence.zone,
      headingDegrees: influence.headingDegrees,
      longitude: influence.longitude,
      latitude: influence.latitude,
    };
    addInfluenceZoneEntity(viewer, { ...influence, zone }, influence.preview === true);
    addHeadingAxis(viewer, influence, zone);
    addOutcomeHalo(viewer, influence);
    addOutcomeLinks(viewer, influence);
  }
  if (rebuildStaticVisuals) {
    staticVisualKeys.set(viewer, staticVisualKey);
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
      const radius = holding
        ? 38 + site.protectionStrength * 28
        : 42 + site.protectionStrength * 20;
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

function isStaticProtectionEntity(id: string): boolean {
  return (
    id.startsWith(ZONE_PREFIX) ||
    id.startsWith(ZONE_AXIS_PREFIX) ||
    id.startsWith(TARGET_PREFIX) ||
    id.startsWith(OUTCOME_PREFIX) ||
    id.startsWith(OUTCOME_LINK_PREFIX) ||
    id.startsWith(OUTCOME_WATER_PREFIX)
  );
}

/** 影響圏・弱点・防護マーカーをすべて消す。 */
export function clearProtectionVisualization(viewer: Viewer): void {
  for (const entity of [...viewer.entities.values]) {
    if (
      entity.id.startsWith(ZONE_PREFIX) ||
      entity.id.startsWith(ZONE_AXIS_PREFIX) ||
      entity.id.startsWith(BANK_PREFIX) ||
      entity.id.startsWith(TARGET_PREFIX) ||
      entity.id.startsWith(OUTCOME_PREFIX) ||
      entity.id.startsWith(OUTCOME_LINK_PREFIX) ||
      entity.id.startsWith(OUTCOME_WATER_PREFIX)
    ) {
      viewer.entities.remove(entity);
    }
  }
  staticVisualKeys.delete(viewer);
}

function buildStaticVisualKey(
  influences: readonly StructureInfluence[],
  showWeaknessTargets: boolean,
  coveredIds: ReadonlySet<string>,
  adverseIds: ReadonlySet<string>,
): string {
  return [
    showWeaknessTargets ? "1" : "0",
    [...coveredIds].sort().join(","),
    [...adverseIds].sort().join(","),
    ...influences.map((influence) =>
      [
        influence.placementId,
        influence.structureId,
        influence.longitude.toFixed(6),
        influence.latitude.toFixed(6),
        influence.headingDegrees.toFixed(1),
        influence.effectiveness.toFixed(2),
        influence.coverageTone,
        influence.preview === true ? "1" : "0",
      ].join(":"),
    ),
  ].join("|");
}

/** 弱点の位置マーカー。影響圏に入ると強調する。 */
function addWeaknessTargetMarker(
  viewer: Viewer,
  candidate: OverflowCandidate,
  status: "idle" | "covered" | "adverse",
): void {
  const covered = status === "covered";
  const adverse = status === "adverse";
  const hazardColor = getHazardMarkerColor(candidate.primaryHazard);
  const fill = Color.fromCssColorString(
    adverse ? "#ef4d4d" : covered ? "#3ecf8e" : hazardColor.fill,
  ).withAlpha(adverse ? 0.5 : covered ? 0.42 : 0.22);
  const outline = Color.fromCssColorString(
    adverse ? "#ffd0c8" : covered ? "#b8ffe0" : hazardColor.outline,
  ).withAlpha(adverse || covered ? 0.95 : 0.7);
  viewer.entities.add({
    id: `${TARGET_PREFIX}${candidate.id}`,
    position: Cartesian3.fromDegrees(candidate.longitude, candidate.latitude),
    ellipse: {
      semiMajorAxis: adverse ? 40 : covered ? 34 : 26,
      semiMinorAxis: adverse ? 30 : covered ? 26 : 20,
      height: 0.4,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: fill,
      outline: true,
      outlineColor: outline,
      outlineWidth: adverse ? 3 : covered ? 2.5 : 1.5,
    },
  });
}

/** 施設足元に判定色を置き、影響圏を見失っても良否が読めるようにする。 */
function addOutcomeHalo(viewer: Viewer, influence: StructureInfluence): void {
  const outcomeTone =
    influence.coverageTone === "good" && influence.adverseSiteIds.length > 0
      ? "warn"
      : influence.coverageTone;
  const colorHex = COVERAGE_ZONE_COLOR[outcomeTone];
  const radius = 22 + influence.effectiveness * 22;
  viewer.entities.add({
    id: `${OUTCOME_PREFIX}${influence.placementId}`,
    position: Cartesian3.fromDegrees(influence.longitude, influence.latitude),
    ellipse: {
      semiMajorAxis: radius,
      semiMinorAxis: radius,
      height: 0.72,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: Color.fromCssColorString(colorHex).withAlpha(outcomeTone === "bad" ? 0.34 : 0.22),
      outline: true,
      outlineColor: Color.fromCssColorString(colorHex).withAlpha(0.95),
      outlineWidth: outcomeTone === "bad" ? 3 : 2,
    },
  });
  addOutcomeWaterRipples(viewer, influence, outcomeTone, radius);
}

/** 施設周辺の水面を、効果＝穏やかな水紋／逆効果＝赤い広がりとして示す。 */
function addOutcomeWaterRipples(
  viewer: Viewer,
  influence: StructureInfluence,
  tone: StructureInfluence["coverageTone"],
  baseRadius: number,
): void {
  const waterColor = tone === "good" ? "#55e0cf" : tone === "bad" ? "#ff6657" : "#f3c65d";
  const radiusMultiplier = tone === "bad" ? 1.7 : tone === "warn" ? 1.35 : 1.1;
  const ringCount = tone === "bad" ? 3 : 2;
  for (let index = 0; index < ringCount; index += 1) {
    const radius = baseRadius * (0.8 + index * 0.42) * radiusMultiplier;
    const alpha = tone === "bad" ? 0.22 - index * 0.045 : 0.18 - index * 0.04;
    viewer.entities.add({
      id: `${OUTCOME_WATER_PREFIX}${influence.placementId}-${index}`,
      position: Cartesian3.fromDegrees(influence.longitude, influence.latitude),
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius * (tone === "bad" ? 0.62 : 0.72),
        height: 0.9 + index * 0.08,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        material: Color.fromCssColorString(waterColor).withAlpha(alpha * 0.28),
        outline: true,
        outlineColor: Color.fromCssColorString(waterColor).withAlpha(alpha),
        outlineWidth: tone === "bad" ? 2.5 : 1.8,
      },
    });
  }
}

/** 施設から対象弱点へ、緑＝恩恵、赤＝干渉の経路を直接つなぐ。 */
function addOutcomeLinks(viewer: Viewer, influence: StructureInfluence): void {
  const candidates = new Map(
    listOverflowCandidates().map((candidate) => [candidate.id, candidate]),
  );
  const links = [
    ...influence.coveredSiteIds.map((id) => ({ id, adverse: false })),
    ...(influence.adverseSiteIds ?? []).map((id) => ({ id, adverse: true })),
  ];
  for (const [index, link] of links.entries()) {
    const candidate = candidates.get(link.id);
    if (candidate === undefined) {
      continue;
    }
    const color = Color.fromCssColorString(link.adverse ? "#ff5f57" : "#57e39f").withAlpha(0.9);
    viewer.entities.add({
      id: `${OUTCOME_LINK_PREFIX}${influence.placementId}-${index}`,
      polyline: {
        positions: Cartesian3.fromDegreesArray([
          influence.longitude,
          influence.latitude,
          candidate.longitude,
          candidate.latitude,
        ]),
        width: link.adverse ? 5 : 4,
        clampToGround: true,
        material: new PolylineDashMaterialProperty({
          color,
          dashLength: link.adverse ? 10 : 22,
          dashPattern: link.adverse ? 0b1111000011110000 : 0b1111111111000000,
        }),
      },
    });
  }
}

function addInfluenceZoneEntity(
  viewer: Viewer,
  influence: StructureInfluence,
  preview: boolean,
): void {
  const id = `${ZONE_PREFIX}${influence.placementId}`;
  const colorHex =
    influence.preview === true || influence.coverageTone !== "good"
      ? COVERAGE_ZONE_COLOR[influence.coverageTone]
      : (STRUCTURE_ZONE_COLOR[influence.structureId] ?? "#58d5a1");
  const fillAlpha = preview ? (influence.coverageTone === "good" ? 0.16 : 0.12) : 0.17;
  const outlineAlpha = preview ? 0.55 : 0.75;
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
    const hierarchy = new PolygonHierarchy(Cartesian3.fromDegreesArray(fanPolygonDegrees(zone)));
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

function addHeadingAxis(viewer: Viewer, influence: StructureInfluence, zone: InfluenceZone): void {
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
  const colorHex =
    influence.preview === true
      ? COVERAGE_ZONE_COLOR[influence.coverageTone]
      : (STRUCTURE_ZONE_COLOR[influence.structureId] ?? "#58d5a1");
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
