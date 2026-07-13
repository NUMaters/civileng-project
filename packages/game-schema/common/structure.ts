export type StructureType =
  "levee" | "retention-basin" | "drainage-pump" | "revetment" | "channel-dredging";

export type StructureDefinition = {
  id: StructureType;
  displayName: string;
};
