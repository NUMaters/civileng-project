import type { GeoPosition } from "../common/geo-position";

export type PlayerMovePayload = {
  position: GeoPosition;
};

export type ConstructionPlacePayload = {
  structureId: string;
  position: GeoPosition;
  headingDegrees: number;
  /** クライアント仮 ID。サーバーが確定 ID を返すまで追跡用。 */
  clientPlacementId?: string;
};

export type SessionStatePayload = {
  playerId: string;
  players: SessionPlayerSnapshot[];
  placements: SessionPlacementSnapshot[];
};

export type SessionPlayerSnapshot = {
  playerId: string;
  position: GeoPosition | null;
};

export type SessionPlacementSnapshot = {
  id: string;
  structureId: string;
  position: GeoPosition;
  headingDegrees: number;
  placedBy: string;
};

export type PlayerJoinedPayload = {
  playerId: string;
};

export type PlayerLeftPayload = {
  playerId: string;
};

export type ConstructionPlacedPayload = SessionPlacementSnapshot;

export type SessionPongPayload = {
  clientTime?: number;
  serverTime: number;
};

/** @deprecated Use PlayerMovePayload */
export type ClientMovePayload = PlayerMovePayload;

/** @deprecated Use ConstructionPlacePayload */
export type ClientPlaceStructurePayload = ConstructionPlacePayload;
