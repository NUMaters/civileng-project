import type { DialogueEntry, HintLevel, NpcDefinition, NpcPhase } from "./types";
import { isDisplayableNpcAnswer } from "./answerValidation";

/** 要件定義書9章の回答後1秒制限。 */
export const ANSWER_COOLDOWN_MS = 1_000;
export type DialogueState = {
  phase: NpcPhase;
  npcId: string | null;
  history: DialogueEntry[];
  highlightedNpcId: string | null;
  nextQuestionAt: number;
  consultedNpcIds: string[];
  usedFactIds: string[];
};
export type DialogueAction =
  | { type: "phase"; phase: NpcPhase }
  | { type: "open"; npcId: string }
  | { type: "close" }
  | {
      type: "ask";
      questionId: string;
      deeper: boolean;
      now: number;
      answerText?: string;
      mode?: "fixed" | "ai";
      childMode?: boolean;
    }
  | { type: "facts"; factIds: string[] }
  | { type: "refer" }
  | { type: "reset" };

export function initialDialogue(): DialogueState {
  return {
    phase: "idle",
    npcId: null,
    history: [],
    highlightedNpcId: null,
    nextQuestionAt: 0,
    consultedNpcIds: [],
    usedFactIds: [],
  };
}

export function canTalk(phase: NpcPhase): boolean {
  return phase === "preparation" || phase === "disaster";
}

export function reduceDialogue(
  state: DialogueState,
  action: DialogueAction,
  npcs: NpcDefinition[],
): DialogueState {
  if (action.type === "reset") return initialDialogue();
  if (action.type === "phase") {
    return action.phase === state.phase
      ? state
      : {
          ...state,
          phase: action.phase,
          npcId: null,
          history: [],
          nextQuestionAt: 0,
          highlightedNpcId: null,
        };
  }
  if (action.type === "close") return { ...state, npcId: null, history: [], nextQuestionAt: 0 };
  if (!canTalk(state.phase)) return state;
  if (action.type === "facts") {
    if (!state.npcId) return state;
    return {
      ...state,
      usedFactIds: [...new Set([...state.usedFactIds, ...action.factIds])],
      consultedNpcIds: [...new Set([...state.consultedNpcIds, state.npcId])],
    };
  }
  if (action.type === "open") {
    if (!npcs.some((npc) => npc.id === action.npcId)) return state;
    return {
      ...state,
      npcId: action.npcId,
      history: [],
      nextQuestionAt: 0,
      highlightedNpcId: state.highlightedNpcId === action.npcId ? null : state.highlightedNpcId,
    };
  }
  const npc = npcs.find((candidate) => candidate.id === state.npcId);
  if (!npc || state.phase !== "preparation") return state;
  if (action.type === "refer") {
    if (state.history.at(-1)?.level !== 3 || !npc.referralNpcId) return state;
    return {
      ...state,
      npcId: null,
      history: [],
      nextQuestionAt: 0,
      highlightedNpcId: npc.referralNpcId,
    };
  }
  if (action.now < state.nextQuestionAt) return state;
  const question = npc.questions.find((candidate) => candidate.id === action.questionId);
  if (!question) return state;
  const last = state.history.at(-1);
  if (action.deeper && (last?.questionId !== question.id || last.level === 3)) return state;
  const level: HintLevel = !action.deeper ? 1 : last?.level === 1 ? 2 : 3;
  const hint = question.hints[level - 1];
  if (!hint) return state;
  const answers = action.childMode ? hint.childAnswers : hint.answers;
  const answer = action.answerText ?? answers[0] ?? "";
  const mode = action.mode ?? "fixed";
  if (mode === "fixed" && !answers.includes(answer)) return state;
  if (mode === "ai" && !isDisplayableNpcAnswer(answer)) return state;
  return {
    ...state,
    history: [
      ...state.history,
      {
        questionId: question.id,
        level,
        question: action.deeper ? "もっと詳しく聞く" : question.text,
        answer,
        factIds: hint.factIds,
        mode,
      },
    ],
    nextQuestionAt: action.now + ANSWER_COOLDOWN_MS,
    consultedNpcIds: [...new Set([...state.consultedNpcIds, npc.id])],
    usedFactIds: [...new Set([...state.usedFactIds, ...hint.factIds])],
  };
}
