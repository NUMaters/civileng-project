import type { HintLevel } from "../common/npc";

/** Solo MVP bridge: game phase is local; the server owns conversation progression. */
export type CreateNpcConversation = {
  npcId: string;
  scenarioId: string;
  catalogVersion: string;
  phase: "preparation";
  remainingSeconds: number;
  audience: "adult" | "child";
};
export type NpcConversation = { conversationId: string; token: string; catalogVersion: string };
export type NpcQuestionRequest = {
  requestId: string;
  questionId: string;
  deeper: boolean;
};
export type NpcAnswer = {
  requestId: string;
  npcId: string;
  questionId: string;
  hintLevel: HintLevel;
  answerText: string;
  factIds: string[];
  sourceIds: string[];
  /** `ai` means Main Backend received a validated answer from NPC Backend. */
  mode: "ai" | "fixed";
  fallbackReason?: string;
};

/** Private v1 contract: validated Main Backend request to stateless NPC Backend. */
export type GenerateNpcAnswerRequest = {
  interactionId: string;
  gameSessionId: string;
  npcId: string;
  scenarioId: string;
  questionId: string;
  hintLevel: HintLevel;
};
export type NpcGenerationResult =
  "success" | "no_grounding" | "busy" | "timeout" | "invalid_output" | "unavailable";
export type GenerateNpcAnswerResponse = {
  interactionId: string;
  result: NpcGenerationResult;
  answerText?: string;
  sourceIds?: string[];
};
