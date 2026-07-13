import type { Position } from "../common/position";

export type ClientMovePayload = {
  position: Position;
};

export type ClientPlaceStructurePayload = {
  structureId: string;
  position: Position;
};
