import {
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  HeightReference,
  Math as CesiumMath,
  PolylineGlowMaterialProperty,
  Viewer,
  type Entity,
} from "cesium";
import type { OverflowSite } from "../../features/disaster/services/floodSimulation";

const ENTITY_PREFIX = "overflow-";
const LEGACY_FLOOD_ZONE_PREFIX = "flood-zone-";
/** 決壊・浸水楕円のサイズ／透明度を目標へ寄せる速さ。 */
const VISUAL_LERP_RATE = 2.0;
/** この強度未満のサイトはフェードアウト後に削除する。 */
const REMOVE_INTENSITY = 0.02;

type SiteTarget = {
  site: OverflowSite;
  floodDepthMeters: number;
  floodedAreaPercent: number;
};

type EllipseVisual = {
  entity: Entity;
  longitude: number;
  latitude: number;
  major: number;
  minor: number;
  rotation: number;
  height: number;
  fill: Color;
  outline: Color;
  targetLongitude: number;
  targetLatitude: number;
  targetMajor: number;
  targetMinor: number;
  targetRotation: number;
  targetHeight: number;
  targetFill: Color;
  targetOutline: Color;
};

type StreakVisual = {
  entity: Entity;
  width: number;
  alpha: number;
  targetWidth: number;
  targetAlpha: number;
  startLon: number;
  startLat: number;
  endLon: number;
  endLat: number;
  targetStartLon: number;
  targetStartLat: number;
  targetEndLon: number;
  targetEndLat: number;
  /** 0〜1。決壊から内陸へ流れる位相。 */
  phase: number;
  flowSpeed: number;
};

type SiteHandle = {
  siteId: string;
  intensity: number;
  targetIntensity: number;
  ellipses: EllipseVisual[];
  streaks: StreakVisual[];
  retiring: boolean;
};

type OverflowController = {
  setTarget: (
    sites: readonly OverflowSite[],
    floodDepthMeters: number,
    floodedAreaPercent: number,
  ) => void;
  destroy: () => void;
};

const controllers = new WeakMap<Viewer, OverflowController>();

/**
 * 決壊（越水）地点を明示し、そこから市街地方向へ浸水が広がる様子を描く。
 * サイズ・透明度は毎フレーム補間し、0.25 秒刻みの差し替え段差を出さない。
 */
export function syncOverflowVisualization(
  viewer: Viewer,
  sites: readonly OverflowSite[],
  floodDepthMeters: number,
  floodedAreaPercent: number,
): void {
  clearLegacyFloodZones(viewer);
  let controller = controllers.get(viewer);
  if (controller === undefined) {
    controller = createOverflowController(viewer);
    controllers.set(viewer, controller);
  }
  controller.setTarget(sites, floodDepthMeters, floodedAreaPercent);
}

export function destroyOverflowVisualization(viewer: Viewer): void {
  const controller = controllers.get(viewer);
  if (controller === undefined) {
    return;
  }
  controller.destroy();
  controllers.delete(viewer);
}

/** 旧来の固定浸水ゾーンを除去する。 */
export function clearLegacyFloodZones(viewer: Viewer): void {
  for (const entity of [...viewer.entities.values]) {
    if (entity.id.startsWith(LEGACY_FLOOD_ZONE_PREFIX)) {
      viewer.entities.remove(entity);
    }
  }
}

function createOverflowController(viewer: Viewer): OverflowController {
  const sites = new Map<string, SiteHandle>();
  let lastFrameAt = performance.now();

  const removePreUpdate = viewer.scene.preUpdate.addEventListener(() => {
    if (viewer.isDestroyed()) {
      return;
    }
    const now = performance.now();
    const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
    lastFrameAt = now;
    const alpha = 1 - Math.exp(-VISUAL_LERP_RATE * deltaSeconds);
    let changed = false;

    for (const [siteId, handle] of [...sites.entries()]) {
      handle.intensity = lerp(handle.intensity, handle.targetIntensity, alpha);
      for (const ellipse of handle.ellipses) {
        changed = stepEllipse(ellipse, alpha) || changed;
      }
      for (const streak of handle.streaks) {
        streak.phase = (streak.phase + deltaSeconds * streak.flowSpeed) % 1;
        changed = stepStreak(streak, alpha) || changed;
      }

      if (handle.retiring && handle.intensity <= REMOVE_INTENSITY) {
        removeSiteHandle(viewer, handle);
        sites.delete(siteId);
        changed = true;
      }
    }

    if (changed) {
      viewer.scene.requestRender();
    }
  });

  return {
    setTarget: (nextSites, floodDepthMeters, floodedAreaPercent) => {
      if (viewer.isDestroyed()) {
        return;
      }
      const activeIds = new Set(nextSites.map((site) => site.id));
      for (const [siteId, handle] of sites) {
        if (!activeIds.has(siteId)) {
          handle.targetIntensity = 0;
          handle.retiring = true;
          zeroSiteTargets(handle);
        }
      }

      for (const site of nextSites) {
        const target: SiteTarget = { site, floodDepthMeters, floodedAreaPercent };
        let handle = sites.get(site.id);
        if (handle === undefined) {
          handle = createSiteHandle(viewer, target);
          sites.set(site.id, handle);
        } else {
          handle.retiring = false;
          handle.targetIntensity = site.intensity;
          applySiteTargets(handle, target);
        }
      }
      viewer.scene.requestRender();
    },
    destroy: () => {
      removePreUpdate();
      if (!viewer.isDestroyed()) {
        for (const handle of sites.values()) {
          removeSiteHandle(viewer, handle);
        }
      }
      sites.clear();
    },
  };
}

function createSiteHandle(viewer: Viewer, target: SiteTarget): SiteHandle {
  const specs = buildEllipseSpecs(target);
  const streakSpecs = buildStreakSpecs(target);
  const ellipses = specs.map((spec) => createEllipseVisual(viewer, spec));
  const streaks = streakSpecs.map((spec, index) =>
    createStreakVisual(viewer, `${ENTITY_PREFIX}streak-${target.site.id}-${index}`, spec),
  );
  return {
    siteId: target.site.id,
    intensity: 0,
    targetIntensity: target.site.intensity,
    ellipses,
    streaks,
    retiring: false,
  };
}

function applySiteTargets(handle: SiteHandle, target: SiteTarget): void {
  const specs = buildEllipseSpecs(target);
  const streakSpecs = buildStreakSpecs(target);
  for (let index = 0; index < handle.ellipses.length; index += 1) {
    const ellipse = handle.ellipses[index]!;
    const spec = specs[index]!;
    ellipse.targetLongitude = spec.longitude;
    ellipse.targetLatitude = spec.latitude;
    ellipse.targetMajor = spec.major;
    ellipse.targetMinor = spec.minor;
    ellipse.targetRotation = spec.rotation;
    ellipse.targetHeight = spec.height;
    ellipse.targetFill = Color.clone(spec.fill);
    ellipse.targetOutline = Color.clone(spec.outline);
  }
  for (let index = 0; index < handle.streaks.length; index += 1) {
    const streak = handle.streaks[index]!;
    const spec = streakSpecs[index]!;
    streak.targetWidth = spec.width;
    streak.targetAlpha = spec.alpha;
    streak.targetStartLon = spec.startLon;
    streak.targetStartLat = spec.startLat;
    streak.targetEndLon = spec.endLon;
    streak.targetEndLat = spec.endLat;
  }
}

function zeroSiteTargets(handle: SiteHandle): void {
  for (const ellipse of handle.ellipses) {
    ellipse.targetMajor = 1;
    ellipse.targetMinor = 1;
    ellipse.targetHeight = 0.05;
    ellipse.targetFill = ellipse.targetFill.withAlpha(0);
    ellipse.targetOutline = ellipse.targetOutline.withAlpha(0);
  }
  for (const streak of handle.streaks) {
    streak.targetWidth = 1;
    streak.targetAlpha = 0;
  }
}

function buildEllipseSpecs(target: SiteTarget) {
  const { site, floodDepthMeters } = target;
  const heading = CesiumMath.toRadians(site.outflowHeadingDegrees);
  const depthScale = Math.max(0.35, Math.min(1.35, 0.4 + floodDepthMeters * 0.55));
  // 決壊点付近のみ。流域全体や市街地全体へ広げない。
  const reach = 38 + site.intensity * 72 * depthScale;

  const inundationCenter = offsetLonLat(
    site.longitude,
    site.latitude,
    Math.sin(heading) * (reach * 0.42),
    Math.cos(heading) * (reach * 0.42),
  );
  const plumeCenter = offsetLonLat(
    site.longitude,
    site.latitude,
    Math.sin(heading) * (reach * 0.2),
    Math.cos(heading) * (reach * 0.2),
  );

  return [
    {
      id: `${ENTITY_PREFIX}breach-core-${site.id}`,
      longitude: site.longitude,
      latitude: site.latitude,
      major: 18 + site.intensity * 12,
      minor: 12 + site.intensity * 8,
      rotation: heading,
      height: 0.45 + site.intensity * 0.4,
      fill: Color.fromCssColorString("#ff5a3c").withAlpha(0.72 + site.intensity * 0.2),
      outline: Color.fromCssColorString("#ffe0d4").withAlpha(0.95),
    },
    {
      id: `${ENTITY_PREFIX}breach-ring-${site.id}`,
      longitude: site.longitude,
      latitude: site.latitude,
      major: 28 + site.intensity * 16,
      minor: 22 + site.intensity * 12,
      rotation: heading,
      height: 0.2,
      fill: Color.fromCssColorString("#ff8a4a").withAlpha(0.18 + site.intensity * 0.12),
      outline: Color.fromCssColorString("#ffb089").withAlpha(0.85),
    },
    {
      id: `${ENTITY_PREFIX}inundation-${site.id}`,
      longitude: inundationCenter.longitude,
      latitude: inundationCenter.latitude,
      major: reach * 0.62,
      minor: reach * (0.28 + site.intensity * 0.06),
      rotation: heading,
      height: Math.max(0.08, floodDepthMeters * 0.16 * (0.55 + site.intensity * 0.45)),
      fill: Color.fromCssColorString("#1aa0d4").withAlpha(
        0.22 + Math.min(0.28, floodDepthMeters * 0.12) + site.intensity * 0.1,
      ),
      outline: Color.fromCssColorString("#8ad8ff").withAlpha(0.4),
    },
    {
      id: `${ENTITY_PREFIX}plume-${site.id}`,
      longitude: plumeCenter.longitude,
      latitude: plumeCenter.latitude,
      major: 28 + site.intensity * 48 * depthScale,
      minor: 16 + site.intensity * 26 * depthScale,
      rotation: heading,
      height: Math.max(0.1, floodDepthMeters * 0.2 * site.intensity),
      fill: Color.fromCssColorString("#1490c8").withAlpha(0.26 + site.intensity * 0.2),
      outline: Color.fromCssColorString("#b8f0ff").withAlpha(0.42),
    },
  ];
}

function buildStreakSpecs(target: SiteTarget) {
  const { site, floodDepthMeters } = target;
  const heading = CesiumMath.toRadians(site.outflowHeadingDegrees);
  const depthScale = Math.max(0.35, Math.min(1.35, 0.4 + floodDepthMeters * 0.55));
  const reach = 38 + site.intensity * 72 * depthScale;
  const specs = [];
  for (let streak = 0; streak < 3; streak += 1) {
    const side = (streak - 1) * (10 + site.intensity * 8);
    const start = offsetLonLat(
      site.longitude,
      site.latitude,
      Math.sin(heading) * 4 + Math.cos(heading) * side * 0.35,
      Math.cos(heading) * 4 - Math.sin(heading) * side * 0.35,
    );
    const end = offsetLonLat(
      site.longitude,
      site.latitude,
      Math.sin(heading) * (reach * 0.88) + Math.cos(heading) * side,
      Math.cos(heading) * (reach * 0.88) - Math.sin(heading) * side,
    );
    specs.push({
      startLon: start.longitude,
      startLat: start.latitude,
      endLon: end.longitude,
      endLat: end.latitude,
      width: 4 + site.intensity * 5 + floodDepthMeters * 1.5,
      alpha: 0.4 + site.intensity * 0.35,
    });
  }
  return specs;
}

function createEllipseVisual(
  viewer: Viewer,
  spec: {
    id: string;
    longitude: number;
    latitude: number;
    major: number;
    minor: number;
    rotation: number;
    height: number;
    fill: Color;
    outline: Color;
  },
): EllipseVisual {
  const visual: EllipseVisual = {
    entity: undefined as unknown as Entity,
    longitude: spec.longitude,
    latitude: spec.latitude,
    major: 1,
    minor: 1,
    rotation: spec.rotation,
    height: 0.05,
    fill: Color.clone(spec.fill).withAlpha(0),
    outline: Color.clone(spec.outline).withAlpha(0),
    targetLongitude: spec.longitude,
    targetLatitude: spec.latitude,
    targetMajor: spec.major,
    targetMinor: spec.minor,
    targetRotation: spec.rotation,
    targetHeight: spec.height,
    targetFill: Color.clone(spec.fill),
    targetOutline: Color.clone(spec.outline),
  };

  visual.entity = viewer.entities.add({
    id: spec.id,
    position: new CallbackPositionProperty(
      () => Cartesian3.fromDegrees(visual.longitude, visual.latitude),
      false,
    ),
    ellipse: {
      semiMajorAxis: new CallbackProperty(() => Math.max(1, visual.major), false),
      semiMinorAxis: new CallbackProperty(() => Math.max(1, visual.minor), false),
      rotation: new CallbackProperty(() => visual.rotation, false),
      height: new CallbackProperty(() => visual.height, false),
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: new ColorMaterialProperty(
        new CallbackProperty(() => Color.clone(visual.fill), false),
      ),
      outline: true,
      outlineColor: new CallbackProperty(() => Color.clone(visual.outline), false),
      outlineWidth: 2,
    },
  });
  return visual;
}

function createStreakVisual(
  viewer: Viewer,
  id: string,
  spec: {
    startLon: number;
    startLat: number;
    endLon: number;
    endLat: number;
    width: number;
    alpha: number;
  },
): StreakVisual {
  const visual: StreakVisual = {
    entity: undefined as unknown as Entity,
    width: 1,
    alpha: 0,
    targetWidth: spec.width,
    targetAlpha: spec.alpha,
    startLon: spec.startLon,
    startLat: spec.startLat,
    endLon: spec.endLon,
    endLat: spec.endLat,
    targetStartLon: spec.startLon,
    targetStartLat: spec.startLat,
    targetEndLon: spec.endLon,
    targetEndLat: spec.endLat,
    phase: visualUnit(spec.startLon * 1_031 + spec.startLat * 917 + spec.endLon * 53),
    flowSpeed: 0.55 + visualUnit(spec.endLon * 811 + spec.endLat * 673 + spec.width * 17) * 0.45,
  };

  visual.entity = viewer.entities.add({
    id,
    polyline: {
      positions: new CallbackProperty(() => flowingStreakPositions(visual), false),
      width: new CallbackProperty(() => Math.max(1, visual.width), false),
      clampToGround: true,
      material: new PolylineGlowMaterialProperty({
        glowPower: 0.3,
        taperPower: 0.45,
        color: new CallbackProperty(
          () => Color.fromCssColorString("#e7fbff").withAlpha(visual.alpha),
          false,
        ),
      }),
    },
  });
  return visual;
}

/** 決壊→内陸の線上を短いセグメントが流れるように見せる。 */
function flowingStreakPositions(visual: StreakVisual): Cartesian3[] {
  const dx = visual.endLon - visual.startLon;
  const dy = visual.endLat - visual.startLat;
  const head = visual.phase;
  const startT = head;
  const endT = Math.min(1, head + 0.28);
  return Cartesian3.fromDegreesArray([
    visual.startLon + dx * startT,
    visual.startLat + dy * startT,
    visual.startLon + dx * endT,
    visual.startLat + dy * endT,
  ]);
}

function stepEllipse(ellipse: EllipseVisual, alpha: number): boolean {
  const before = ellipse.major + ellipse.fill.alpha;
  ellipse.longitude = lerp(ellipse.longitude, ellipse.targetLongitude, alpha);
  ellipse.latitude = lerp(ellipse.latitude, ellipse.targetLatitude, alpha);
  ellipse.major = lerp(ellipse.major, ellipse.targetMajor, alpha);
  ellipse.minor = lerp(ellipse.minor, ellipse.targetMinor, alpha);
  ellipse.rotation = lerp(ellipse.rotation, ellipse.targetRotation, alpha);
  ellipse.height = lerp(ellipse.height, ellipse.targetHeight, alpha);
  Color.lerp(ellipse.fill, ellipse.targetFill, alpha, ellipse.fill);
  Color.lerp(ellipse.outline, ellipse.targetOutline, alpha, ellipse.outline);
  return Math.abs(ellipse.major + ellipse.fill.alpha - before) > 1e-4;
}

function stepStreak(streak: StreakVisual, alpha: number): boolean {
  const before = streak.width + streak.alpha;
  streak.width = lerp(streak.width, streak.targetWidth, alpha);
  streak.alpha = lerp(streak.alpha, streak.targetAlpha, alpha);
  streak.startLon = lerp(streak.startLon, streak.targetStartLon, alpha);
  streak.startLat = lerp(streak.startLat, streak.targetStartLat, alpha);
  streak.endLon = lerp(streak.endLon, streak.targetEndLon, alpha);
  streak.endLat = lerp(streak.endLat, streak.targetEndLat, alpha);
  return Math.abs(streak.width + streak.alpha - before) > 1e-4;
}

function removeSiteHandle(viewer: Viewer, handle: SiteHandle): void {
  for (const ellipse of handle.ellipses) {
    viewer.entities.remove(ellipse.entity);
  }
  for (const streak of handle.streaks) {
    viewer.entities.remove(streak.entity);
  }
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

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** 0..1 の決定論的な擬似乱数（可視化の位相用。暗号用途ではない）。 */
function visualUnit(seed: number): number {
  const x = Math.sin(seed) * 43_758.545_312_3;
  return x - Math.floor(x);
}
