import type { StructureDefinition as GameStructureDefinition } from "@civilcraft/game-data/types";

/** UI / 配置ロジックで使う施設定義（game-data と互換）。 */
export type StructureDefinition = Pick<
  GameStructureDefinition,
  | "id"
  | "displayName"
  | "description"
  | "constructionCost"
  | "constructionTimeSeconds"
  | "maintenanceCostPerSecond"
  | "role"
  | "hazardAffinity"
>;

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
  /** true のとき仮配置（予算未消費・未同期）。 */
  preview?: boolean;
};

export type PlacementResult =
  | { ok: true; placement: PlacedStructure; remainingBudget: number }
  | { ok: false; reason: string };
