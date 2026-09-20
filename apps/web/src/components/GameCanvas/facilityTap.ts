export const FACILITY_ROTATION_STEP = 36;
export const FACILITY_TAP_SLOP = 8;
export function nextFacilityHeading(heading: number) {
  return (((heading + FACILITY_ROTATION_STEP) % 360) + 360) % 360;
}
export function facilityPopScale(progress: number) {
  return 1 + Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI) * 0.14;
}
