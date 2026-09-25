import { expect, it } from "vitest";
import { disasterResponse } from "./disasterResponse";
import { npcCatalog, npcs } from "./catalog";
import type { OverflowSite } from "../disaster/services/floodSimulation";
import type { NpcDefinition } from "./types";

const resident = npcs[0] as NpcDefinition;
const site: OverflowSite = {
  id: "test",
  ...resident.position,
  intensity: 0.8,
  outflowHeadingDegrees: 0,
  primaryHazard: "overtopping",
};

it("uses the nearby simulation hazard type, not global damage", () => {
  for (const [primaryHazard, kind] of [
    ["overtopping", "overflow"],
    ["erosion", "erosion"],
    ["inlandPonding", "inland"],
    ["capacityShortage", "capacity"],
  ] as const) {
    const result = disasterResponse(resident, {
      phase: "disaster",
      overflowSites: [{ ...site, primaryHazard }],
    });
    expect(result.kind).toBe(kind);
    expect(result.status).toContain("ゲーム");
    expect(result.factIds).toEqual(["FACT-D01"]);
  }
});
it("does not invent local damage when only distant or inactive sites exist", () => {
  expect(
    disasterResponse(resident, {
      phase: "disaster",
      overflowSites: [{ ...site, longitude: site.longitude + 1 }],
    }).kind,
  ).toBe("calm");
  expect(
    disasterResponse(resident, { phase: "disaster", overflowSites: [{ ...site, intensity: 0 }] })
      .kind,
  ).toBe("calm");
  expect(disasterResponse(resident, { phase: "preparation", overflowSites: [site] }).kind).toBe(
    "calm",
  );
});
it("keeps the current hazard report separate from referenced real-world advice", () => {
  const expert = npcs[1] as NpcDefinition;
  const result = disasterResponse(expert, { phase: "disaster", overflowSites: [] });
  expect(result.tip).toContain("現実");
  expect(result.factIds).toEqual(["FACT-D02"]);
  expect(npcCatalog.knowledge.some((fact) => fact.id === "FACT-C01")).toBe(false);
});
