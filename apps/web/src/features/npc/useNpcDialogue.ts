import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { canTalk, initialDialogue, reduceDialogue } from "./dialogue";
import { npcCatalog, npcs } from "./catalog";
import { NpcConversationClient } from "./conversationClient";
import { loadFuriganaEnabled, saveFuriganaEnabled } from "./readingLevelStorage";
import type { HintLevel, NpcPhase } from "./types";
import type { FloodSimulationState } from "../disaster/services/floodSimulation";

export function useNpcDialogue(
  enabled: boolean,
  phase: NpcPhase,
  getGameState: () => FloodSimulationState,
) {
  const [state, dispatch] = useReducer(
    (current: ReturnType<typeof initialDialogue>, action: Parameters<typeof reduceDialogue>[1]) =>
      reduceDialogue(current, action, npcs),
    undefined,
    initialDialogue,
  );
  const [now, setNow] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [childMode, setChildMode] = useState(false);
  const [furigana, setFurigana] = useState(loadFuriganaEnabled);
  const current = useRef({ state, phase, enabled, getGameState, childMode });
  current.current = { state, phase, enabled, getGameState, childMode };
  const client = useRef<NpcConversationClient | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current += 1;
    client.current?.close();
    client.current = null;
    busy.current = false;
    setPending(false);
    setError(null);
  }, []);
  useEffect(() => {
    stop();
    dispatch(enabled ? { type: "phase", phase } : { type: "reset" });
  }, [enabled, phase, stop]);
  useEffect(
    () => () => {
      generation.current += 1;
      client.current?.close();
    },
    [],
  );
  useEffect(() => {
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, state.nextQuestionAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [state.nextQuestionAt]);
  const close = useCallback(() => {
    stop();
    dispatch({ type: "close" });
  }, [stop]);
  const open = useCallback(
    (npcId: string) => {
      const snapshot = current.current;
      if (!snapshot.enabled || !canTalk(snapshot.phase)) return;
      const npc = npcs.find((person) => person.id === npcId);
      if (!npc) return;
      stop();
      dispatch({ type: "open", npcId });
      if (snapshot.phase === "disaster")
        dispatch({ type: "facts", factIds: npcCatalog.disaster.tips[npc.kind].factIds });
    },
    [stop],
  );
  const ask = useCallback(async (questionId: string, deeper = false) => {
    const snapshot = current.current;
    const npc = npcs.find((person) => person.id === snapshot.state.npcId);
    if (
      !npc ||
      !snapshot.enabled ||
      snapshot.getGameState().phase !== "preparation" ||
      busy.current ||
      Date.now() < snapshot.state.nextQuestionAt
    )
      return;
    const question = npc.questions.find((item) => item.id === questionId);
    const last = snapshot.state.history.at(-1);
    if (!question || (deeper && (last?.questionId !== questionId || last.level === 3))) return;
    const level: HintLevel = !deeper ? 1 : last?.level === 1 ? 2 : 3;
    client.current ??= new NpcConversationClient(
      npc,
      snapshot.getGameState().phaseRemainingSeconds,
      snapshot.childMode,
    );
    const revision = generation.current;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const answer = await client.current.answer(questionId, deeper, level);
      if (
        revision !== generation.current ||
        current.current.getGameState().phase !== "preparation" ||
        !current.current.enabled
      )
        return;
      dispatch({
        type: "ask",
        questionId,
        deeper,
        now: Date.now(),
        answerText: answer.answerText,
        mode: answer.mode,
        childMode: snapshot.childMode,
      });
    } catch {
      if (revision === generation.current)
        setError("会話を続けられませんでした。一度閉じて、もう一度話しかけてください。");
    } finally {
      if (revision === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  }, []);
  const refer = useCallback(() => {
    stop();
    dispatch({ type: "refer" });
  }, [stop]);
  const available = enabled && canTalk(phase) && state.phase === phase;
  const activeNpc = available ? (npcs.find((npc) => npc.id === state.npcId) ?? null) : null;
  return {
    state,
    activeNpc,
    available,
    pending,
    error,
    coolingDown: now < state.nextQuestionAt,
    close,
    open,
    ask,
    refer,
    childMode,
    furigana,
    setFurigana: (value: boolean) => {
      setFurigana(value);
      saveFuriganaEnabled(value);
    },
    setChildMode: (value: boolean) => {
      const npcId = current.current.state.npcId;
      stop();
      setChildMode(value);
      if (npcId) dispatch({ type: "open", npcId });
    },
  };
}
