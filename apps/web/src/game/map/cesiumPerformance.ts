export type CesiumPerformanceSettings = {
  readonly maximumScreenSpaceError: number;
  readonly cacheBytes: number;
  readonly resolutionScale: number;
};

const MOBILE_MAXIMUM_SCREEN_SPACE_ERROR: number = 32;
const DESKTOP_MAXIMUM_SCREEN_SPACE_ERROR: number = 16;
const MOBILE_CACHE_BYTES: number = 128 * 1024 * 1024;
const DESKTOP_CACHE_BYTES: number = 256 * 1024 * 1024;
const MOBILE_RESOLUTION_SCALE: number = 0.8;
const DESKTOP_RESOLUTION_SCALE: number = 1;

export function getCesiumPerformanceSettings(isMobile: boolean): CesiumPerformanceSettings {
  if (isMobile) {
    return {
      maximumScreenSpaceError: MOBILE_MAXIMUM_SCREEN_SPACE_ERROR,
      cacheBytes: MOBILE_CACHE_BYTES,
      resolutionScale: MOBILE_RESOLUTION_SCALE,
    };
  }

  return {
    maximumScreenSpaceError: DESKTOP_MAXIMUM_SCREEN_SPACE_ERROR,
    cacheBytes: DESKTOP_CACHE_BYTES,
    resolutionScale: DESKTOP_RESOLUTION_SCALE,
  };
}
