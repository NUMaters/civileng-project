export type { NpcDefinition, NpcQuestion, HintLevel } from "@civilcraft/game-schema/common/npc";
import type { HintLevel } from "@civilcraft/game-schema/common/npc";
export type NpcPhase = "idle" | "preparation" | "disaster" | "result" | "review";
export type DialogueEntry = {
  questionId: string;
  level: HintLevel;
  question: string;
  answer: string;
  factIds: string[];
  mode: "fixed" | "ollama" | "openai";
};
