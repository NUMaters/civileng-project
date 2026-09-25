import {
  Cartesian3,
  Color,
  CornerType,
  HeightReference,
  Math as CesiumMath,
  PolygonHierarchy,
  type Viewer,
} from "cesium";
import type {
  ProtectedBankSite,
  StructureInfluence,
} from "../../features/disaster/services/floodSimulation";
import {
  fanPolygonDegrees,
  stripCenterlineDegrees,
} from "../../features/disaster/services/influenceZones";

const ZONE_PREFIX = "protect-zone-";
// Also clean up legacy halos, links, axes and weakness markers on scene resync.
const OVERLAY_PREFIXES = [
  ZONE_PREFIX,
  "protect-bank-",
  "facility-outcome-",
  "facility-water-effect-",
];
const PREVIEW_COLORS: Record<StructureInfluence["coverageTone"], string> = {
  good: "#829e95",
  warn: "#b5a17b",
  bad: "#b48b7e",
};
const previewKeys = new WeakMap<Viewer, string>();

/** Only placement previews show range. Completed facilities are represented by their models. */
export function syncProtectionVisualization(
  viewer: Viewer,
  influences: readonly StructureInfluence[],
  _bankSites: readonly ProtectedBankSite[],
  _options: { showBankSites: boolean },
): void {
  // Keep the caller contract without restoring diagnostic bank markers in the scene.
  void _bankSites;
  void _options;
  const previews = influences.filter(
    (influence) =>
      influence.preview === true &&
      Number.isFinite(influence.longitude) &&
      Number.isFinite(influence.latitude),
  );
  // Include geometry changes, but ignore simulation outcomes that do not change the surface.
  const key = JSON.stringify(
    previews.map((influence) => [
      influence.placementId,
      influence.longitude,
      influence.latitude,
      influence.headingDegrees,
      influence.coverageTone,
      influence.zone,
    ]),
  );
  if (previewKeys.get(viewer) === key) return;
  clearProtectionVisualization(viewer);
  for (const influence of previews) addPreviewZone(viewer, influence);
  previewKeys.set(viewer, key);
}

export function clearProtectionVisualization(viewer: Viewer): void {
  for (const entity of [...viewer.entities.values]) {
    if (OVERLAY_PREFIXES.some((prefix) => entity.id.startsWith(prefix))) {
      viewer.entities.remove(entity);
    }
  }
  previewKeys.delete(viewer);
}

function addPreviewZone(viewer: Viewer, influence: StructureInfluence): void {
  const id = `${ZONE_PREFIX}${influence.placementId}`;
  const material = Color.fromCssColorString(PREVIEW_COLORS[influence.coverageTone]).withAlpha(0.12);
  const zone = {
    ...influence.zone,
    longitude: influence.longitude,
    latitude: influence.latitude,
    headingDegrees: influence.headingDegrees,
  };
  const surface = {
    height: 0.32,
    heightReference: HeightReference.RELATIVE_TO_GROUND,
    material,
    outline: false,
  };
  if (zone.kind === "strip") {
    viewer.entities.add({
      id,
      corridor: {
        ...surface,
        positions: Cartesian3.fromDegreesArray(stripCenterlineDegrees(zone)),
        width: zone.widthMeters,
        cornerType: CornerType.BEVELED,
      },
    });
  } else if (zone.kind === "fan") {
    viewer.entities.add({
      id,
      polygon: {
        ...surface,
        hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(fanPolygonDegrees(zone))),
      },
    });
  } else {
    viewer.entities.add({
      id,
      position: Cartesian3.fromDegrees(zone.longitude, zone.latitude),
      ellipse: {
        ...surface,
        semiMajorAxis: zone.majorMeters,
        semiMinorAxis: zone.minorMeters,
        rotation: -CesiumMath.toRadians(zone.headingDegrees),
        granularity: CesiumMath.toRadians(5),
      },
    });
  }
}
