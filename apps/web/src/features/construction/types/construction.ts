export type StructureDefinition = {
  id: string;
  displayName: string;
  description: string;
  constructionCost: number;
  constructionTimeSeconds: number;
};

export type GeoPosition = {
  longitude: number;
  latitude: number;
  height: number;
};

export type PlacedStructure = {
  id: string;
  structureId: string;
  position: GeoPosition;
  /** 真北から時計回りの向き（度）。Cesium camera.heading と同系。 */
  headingDegrees: number;
};

export type PlacementResult =
  | { ok: true; placement: PlacedStructure; remainingBudget: number }
  | { ok: false; reason: string };
