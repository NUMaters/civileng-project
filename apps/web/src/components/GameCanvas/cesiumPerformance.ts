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
  dynamicFrameIntervalMs: 1000 / 60,
  overlayFrameIntervalMs: 1000 / 60,
  skyAtmosphere: true,
  stormEffects: true,
  waterFlowStreakCount: 14,
  waterFrameIntervalMs: 1000 / 60,
  waterUseNormalMap: true,
  rainMaxDrops: 110,
  rainFrameIntervalMs: 1000 / 24,
  rainCanvasDprCap: 1.5,
};

const MOBILE_PROFILE: CesiumRenderProfile = {
  id: "mobile",
  // 低解像度化しすぎると、建物の輪郭とHTMLラベルの移動が一緒にぼやける。
  // 60fps固定ではなく、まずスマホでも輪郭が読める描画密度を確保する。
  targetRenderPixels: 860_000,
  resolutionScaleFloor: 0.5,
  globeMaximumScreenSpaceError: 10,
  buildingMaximumScreenSpaceError: 20,
  // 建物の立体感はゲーム体験の中心なので、スマホでもLOD1を表示する。
  // 描画負荷は解像度・SSE・簡略化したエフェクト側で抑える。
  loadBuildings: true,
  usePlateauTerrain: false,
  imageryMaximumLevel: 16,
  dynamicFrameIntervalMs: 1000 / 18,
  // 施設ラベルはHTMLオーバーレイなので、低コストでカメラ移動への追従を改善できる。
  overlayFrameIntervalMs: 1000 / 24,
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
    if (isLowEndDevice()) {
      return { ...MOBILE_PROFILE, loadBuildings: false };
    }
    return MOBILE_PROFILE;
  }
  if (isLowEndDevice()) {
    return {
      ...MOBILE_PROFILE,
      id: "low",
      loadBuildings: true,
      buildingMaximumScreenSpaceError: 24,
    };
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
