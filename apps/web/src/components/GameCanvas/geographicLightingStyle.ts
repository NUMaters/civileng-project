/** Art direction, not surveyed illumination. Keep the existing two lights/shadow pass,
 * sun direction, geometry, exposure pipeline and all gameplay values independent. */
export const GEOGRAPHIC_LIGHTING_STYLE = {
  exposure: 0.95,
  background: "#70cff1",
  fog: { color: "#b0dfe9", near: 2200, far: 4200 },
  hemisphere: { sky: "#d8efff", ground: "#6c8291", intensity: 0.60 },
  sun: { color: "#fff9ef", intensity: 2.5 },
  provenance: "Illustrative vivid daylight palette; no change to source elevations, measured geometry or actual weather claims",
} as const;
