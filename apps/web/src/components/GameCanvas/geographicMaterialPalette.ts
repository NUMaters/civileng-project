/** Candidate art direction only, not sampled imagery/materials or land-use evidence.
 * Separate warm roofs, ivory walls, spring ground and cooler crowns without raising
 * exposure. Keep roof slot count/order and ID hashing stable; no geometry changes.
 * Neutral park/pitch classifications, water/storm colors and PR181 lighting stay intact.
 */
export const GEOGRAPHIC_MATERIAL_PALETTE = {
  roofs: ["#367ed0", "#4b718f", "#df694c", "#c85562", "#eda15a"],
  wall: "#fff1db",
  ground: "#82c947",
  mappedGrass: "#83c84c",
  crowns: ["#54ad57", "#76bc44", "#38a96a", "#9acb55"],
  provenance: "Illustrative color separation, not surveyed roof materials, vegetation species or observed land cover",
} as const;
