export type CesiumRenderProfile = {
  id: "desktop" | "mobile" | "low";
  targetRenderPixels: number;
  resolutionScaleFloor: number;
  globeMaximumScreenSpaceError: number;
  buildingMaximumScreenSpaceError: number;
  loadBuildings: boolean;
  usePlateauTerrain: boolean;
  imageryMaximumLevel: number;
  dynamicFrameIntervalMs: number;
  overlayFrameIntervalMs: number;
  skyAtmosphere: boolean;
  stormEffects: boolean;
  waterFlowStreakCount: number;
  waterFrameIntervalMs: number;
  waterUseNormalMap: boolean;
  rainMaxDrops: number;
  rainFrameIntervalMs: number;
  rainCanvasDprCap: number;
};

const DESKTOP_PROFILE: CesiumRenderProfile = {
  id: "desktop",
  targetRenderPixels: 1_500_000,
  resolutionScaleFloor: 0.65,
  globeMaximumScreenSpaceError: 4,
  buildingMaximumScreenSpaceError: 16,
  loadBuildings: true,
  usePlateauTerrain: true,
  imageryMaximumLevel: 18,
  dynamicFrameIntervalMs: 1000 / 30,
  overlayFrameIntervalMs: 1000 / 30,
  skyAtmosphere: true,
  stormEffects: true,
  waterFlowStreakCount: 14,
  waterFrameIntervalMs: 1000 / 30,
  waterUseNormalMap: true,
  rainMaxDrops: 110,
  rainFrameIntervalMs: 1000 / 24,
  rainCanvasDprCap: 1.5,
};

const MOBILE_PROFILE: CesiumRenderProfile = {
  id: "mobile",
  targetRenderPixels: 680_000,
  resolutionScaleFloor: 0.4,
  globeMaximumScreenSpaceError: 14,
  buildingMaximumScreenSpaceError: 32,
  loadBuildings: false,
  usePlateauTerrain: false,
  imageryMaximumLevel: 15,
  dynamicFrameIntervalMs: 1000 / 18,
  overlayFrameIntervalMs: 1000 / 12,
  skyAtmosphere: false,
  stormEffects: false,
  waterFlowStreakCount: 4,
  waterFrameIntervalMs: 1000 / 12,
  waterUseNormalMap: false,
  rainMaxDrops: 22,
  rainFrameIntervalMs: 1000 / 12,
  rainCanvasDprCap: 1,
};

let cachedProfile: CesiumRenderProfile | null = null;

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
}

function isLowEndDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return cores <= 4 || memory <= 4;
}

export function resolveCesiumRenderProfile(): CesiumRenderProfile {
  if (isMobileViewport()) {
    return MOBILE_PROFILE;
  }
  if (isLowEndDevice()) {
    return { ...MOBILE_PROFILE, id: "low", loadBuildings: true, buildingMaximumScreenSpaceError: 28 };
  }
  return DESKTOP_PROFILE;
}

export function getCesiumRenderProfile(): CesiumRenderProfile {
  cachedProfile ??= resolveCesiumRenderProfile();
  return cachedProfile;
}

export function resolveCesiumResolutionScale(profile = getCesiumRenderProfile()): number {
  if (typeof window === "undefined") {
    return 1;
  }
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const nativePixels = Math.max(1, window.innerWidth * window.innerHeight * dpr * dpr);
  const budgetScale = Math.sqrt(profile.targetRenderPixels / nativePixels);
  return Math.min(1, Math.max(profile.resolutionScaleFloor, budgetScale));
}
