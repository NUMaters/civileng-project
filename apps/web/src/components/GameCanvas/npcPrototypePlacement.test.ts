import { expect, it } from "vitest";
import { npcs } from "../../features/npc/catalog";
import { isInPlaceableRiverZone } from "./riverPlacement";

it("keeps prototype residents outside the existing construction zone", () => {
  for (const npc of npcs) {
    expect(isInPlaceableRiverZone(npc.position), npc.name).toBe(false);
  }
});

it("gives every NPC a fixed home anchor on the playable map", () => {
  for (const npc of npcs) {
    expect(Number.isFinite(npc.position.longitude), npc.name).toBe(true);
    expect(Number.isFinite(npc.position.latitude), npc.name).toBe(true);
    expect(npc.position.longitude, npc.name).toBeGreaterThan(140.365);
    expect(npc.position.longitude, npc.name).toBeLessThan(140.398);
    expect(npc.position.latitude, npc.name).toBeGreaterThan(37.347);
    expect(npc.position.latitude, npc.name).toBeLessThan(37.388);
  }
});
