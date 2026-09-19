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
  mode: "ollama" | "openai" | "fixed";
  fallbackReason?: string;
};
