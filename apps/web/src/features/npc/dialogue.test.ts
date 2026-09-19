import { describe, expect, it } from "vitest";
import { ANSWER_COOLDOWN_MS, canTalk, initialDialogue, reduceDialogue } from "./dialogue";
import type { DialogueAction, DialogueState } from "./dialogue";
import { loadCatalog, npcs } from "./catalog";

function step(state: DialogueState, action: DialogueAction) {
  return reduceDialogue(state, action, npcs);
}
function opened(npcId = "resident") {
  return step(step(initialDialogue(), { type: "phase", phase: "preparation" }), {
    type: "open",
    npcId,
  });
}
function ask(
  state: DialogueState,
  deeper = false,
  questionId = "land",
  now = state.nextQuestionAt,
) {
  return step(state, { type: "ask", questionId, deeper, now });
}

describe("NPC prototype data", () => {
  it("has distinct personas, three questions and three bounded answers each", () => {
    const npcs = loadCatalog().npcs;
    expect(npcs.map((npc) => npc.kind)).toEqual([
      "resident",
      "experienced",
      "resident",
      "resident",
      "experienced",
      "experienced",
      "experienced",
      "experienced",
    ]);
    for (const npc of npcs) {
      expect(npc.questions).toHaveLength(3);
      expect(npc.position.longitude).toBeGreaterThan(140);
      expect(npc.position.latitude).toBeGreaterThan(37);
      for (const question of npc.questions) {
        expect(question.hints).toHaveLength(3);
        for (const answer of question.hints.flatMap((hint) => hint.answers))
          expect([...answer].length).toBeLessThanOrEqual(120);
      }
    }
    expect(npcs[0]?.referralNpcId).toBe(npcs[1]?.id);
    expect(npcs[1]?.referralNpcId).toBeNull();
  });
});

describe("NPC dialogue", () => {
  it("only opens during preparation or disaster and rejects unknown NPCs", () => {
    for (const phase of ["idle", "preparation", "disaster", "result", "review"] as const) {
      const state = step(initialDialogue(), { type: "phase", phase });
      expect(step(state, { type: "open", npcId: "resident" }).npcId).toBe(
        canTalk(phase) ? "resident" : null,
      );
      expect(step(state, { type: "open", npcId: "missing" })).toEqual(state);
    }
  });
  it("advances one question through three levels without a fourth level", () => {
    let state = ask(opened());
    state = ask(state, true);
    state = ask(state, true);
    expect(state.history.map((entry) => entry.level)).toEqual([1, 2, 3]);
    expect(state.history.map((entry) => entry.answer)).toEqual(
      npcs[0]?.questions[1]?.hints.map((hint) => hint.answers[0]),
    );
    expect(ask(state, true)).toEqual(state);
    expect(state.consultedNpcIds).toEqual(["resident"]);
  });
  it("does not allow skipping level 1, changing questions with deeper, or unknown questions", () => {
    const empty = opened();
    expect(ask(empty, true)).toEqual(empty);
    expect(ask(empty, false, "missing")).toEqual(empty);
    const state = ask(empty);
    expect(ask(state, true, "past")).toEqual(state);
  });
  it("blocks repeat requests for one second and accepts at the boundary", () => {
    const state = ask(opened(), false, "land", 10_000);
    expect(state.nextQuestionAt).toBe(10_000 + ANSWER_COOLDOWN_MS);
    expect(ask(state, true, "land", state.nextQuestionAt - 1)).toEqual(state);
    expect(ask(state, true).history.at(-1)?.level).toBe(2);
  });
  it("starts another or repeated question at level 1 and keeps earlier dialogue", () => {
    let state = ask(ask(opened()), true);
    state = ask(state, false, "past");
    state = ask(state, false, "land");
    expect(state.history.map((entry) => [entry.questionId, entry.level])).toEqual([
      ["land", 1],
      ["land", 2],
      ["past", 1],
      ["land", 1],
    ]);
  });
  it("only refers after level 3 and highlights the experienced resident until opened", () => {
    let state = ask(opened());
    expect(step(state, { type: "refer" })).toEqual(state);
    state = ask(state, true);
    expect(step(state, { type: "refer" })).toEqual(state);
    state = step(ask(state, true), { type: "refer" });
    expect(state.npcId).toBeNull();
    expect(state.history).toEqual([]);
    expect(state.highlightedNpcId).toBe("builder");
    state = step(state, { type: "open", npcId: "builder" });
    expect(state.highlightedNpcId).toBeNull();
    state = ask(ask(ask(state, false, "bank"), true, "bank"), true, "bank");
    expect(step(state, { type: "refer" })).toEqual(state);
    expect(state.consultedNpcIds).toEqual(["resident", "builder"]);
  });
  it("clears conversation when closed and does not resume old levels on reopening", () => {
    let state = step(ask(opened()), { type: "close" });
    expect(state.npcId).toBeNull();
    expect(state.history).toEqual([]);
    state = step(state, { type: "open", npcId: "resident" });
    expect(ask(state).history.map((entry) => entry.level)).toEqual([1]);
  });
  it("closes on phase changes; disaster offers no prepared answers; result preserves only consulted IDs", () => {
    let state = step(ask(opened()), { type: "phase", phase: "disaster" });
    expect(state.npcId).toBeNull();
    expect(state.history).toEqual([]);
    state = step(state, { type: "open", npcId: "resident" });
    expect(ask(state)).toEqual(state);
    state = step(state, { type: "phase", phase: "result" });
    expect(state.npcId).toBeNull();
    expect(state.consultedNpcIds).toEqual(["resident"]);
    expect(step(state, { type: "reset" })).toEqual(initialDialogue());
  });
});
