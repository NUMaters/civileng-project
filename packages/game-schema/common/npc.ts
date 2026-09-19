/** Shared NPC master data. Facts retain the research IDs; source URLs never come from the LLM. */
export type HintLevel = 1 | 2 | 3;
export type NpcHint = {
  level: number;
  answers: string[];
  childAnswers: string[];
  factIds: string[];
};
export type NpcQuestion = { id: string; text: string; hints: NpcHint[] };
export type NpcDefinition = {
  id: string;
  name: string;
  occupation: string;
  kind: "resident" | "experienced";
  /** Facts this NPC is allowed to use outside its level-3 referral. */
  topicFactIds: string[];
  introduction: string;
  persona: string;
  locationLabel: string;
  position: { longitude: number; latitude: number; height: number };
  referralNpcId: string | null;
  questions: NpcQuestion[];
};
export type NpcSource = {
  id: string;
  agency: string;
  title: string;
  url: string;
  section: string;
  year: string;
  checkedOn: string;
};
export type NpcFact = {
  id: string;
  area: string;
  canonicalFact: string;
  limitations: string;
  sourceIds: string[];
  approved: boolean;
  confidence: string;
};
export type NpcCatalog = {
  version: string;
  scenarioId: string;
  enabled: boolean;
  npcs: NpcDefinition[];
  knowledge: NpcFact[];
  sources: NpcSource[];
  disaster: {
    nearbyRadiusMeters: number;
    activeIntensity: number;
    messages: { calm: string; overflow: string; erosion: string; inland: string; capacity: string };
    tips: Record<"resident" | "experienced", { text: string; factIds: string[] }>;
  };
};
