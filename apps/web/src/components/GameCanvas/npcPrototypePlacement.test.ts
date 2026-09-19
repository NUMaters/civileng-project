import { expect, it } from "vitest";
import { npcs } from "../../features/npc/catalog";
import { isInPlaceableRiverZone } from "./riverPlacement";

it("keeps prototype residents outside the existing construction zone", () => {
  for (const npc of npcs) {
    expect(isInPlaceableRiverZone(npc.position), npc.name).toBe(false);
  }
});
