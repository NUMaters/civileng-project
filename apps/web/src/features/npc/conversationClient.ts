import type { HintLevel, NpcDefinition } from "./types";
import type {
  CreateNpcConversation,
  NpcAnswer,
  NpcConversation,
} from "@civilcraft/game-schema/rest/npc";
import { npcCatalog, sourceIdsForFacts } from "./catalog";

const API_BASE = "/api/npc/conversations";
const OPEN_TIMEOUT_MS = 1_500;
const ANSWER_TIMEOUT_MS = 5_500;
const CLOSE_TIMEOUT_MS = 1_500;

export class NpcRequestRejected extends Error {}
type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
function sameIds(value: unknown, expected: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    expected.every((id) => value.includes(id))
  );
}

/** One panel lifetime. Failed transport falls back locally for this conversation only. */
export class NpcConversationClient {
  private session: NpcConversation | null = null;
  private readonly lifetime = new AbortController();
  private readonly started = Date.now();
  private offline = false;
  constructor(
    private readonly npc: NpcDefinition,
    private readonly remainingSeconds: number,
    private readonly childMode = false,
  ) {}

  async answer(questionId: string, deeper: boolean, level: HintLevel): Promise<NpcAnswer> {
    const question = this.npc.questions.find((candidate) => candidate.id === questionId);
    const hint = question?.hints[level - 1];
    if (!hint) throw new NpcRequestRejected("質問を選び直してください。");
    const requestId = crypto.randomUUID();
    const allowedAnswers = this.childMode ? hint.childAnswers : hint.answers;
    const fixed: NpcAnswer = {
      requestId,
      npcId: this.npc.id,
      questionId,
      hintLevel: level,
      answerText: allowedAnswers[0] ?? "",
      factIds: hint.factIds,
      sourceIds: sourceIdsForFacts(hint.factIds),
      mode: "fixed",
      fallbackReason: "server_unavailable",
    };
    try {
      if (this.offline) return fixed;
      if (!this.session) await this.open();
      this.lifetime.signal.throwIfAborted();
      if (!this.session) throw new Error("Missing NPC session");
      const response = await fetch(`${API_BASE}/${this.session.conversationId}/answers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.session.token}`,
        },
        body: JSON.stringify({ requestId, questionId, deeper }),
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(ANSWER_TIMEOUT_MS)]),
      });
      this.checkStatus(response);
      const result: unknown = await response.json();
      if (
        !object(result) ||
        result.requestId !== requestId ||
        result.npcId !== this.npc.id ||
        result.questionId !== questionId ||
        result.hintLevel !== level ||
        typeof result.answerText !== "string" ||
        !allowedAnswers.includes(result.answerText) ||
        !sameIds(result.factIds, fixed.factIds) ||
        !sameIds(result.sourceIds, fixed.sourceIds) ||
        (result.mode !== "ai" && result.mode !== "fixed")
      )
        throw new Error("Invalid NPC response");
      return {
        ...fixed,
        answerText: result.answerText,
        mode: result.mode,
        fallbackReason:
          typeof result.fallbackReason === "string" ? result.fallbackReason : undefined,
      };
    } catch (error) {
      this.lifetime.signal.throwIfAborted();
      if (error instanceof NpcRequestRejected) throw error;
      // Avoid diverging server/client hint state after an ambiguous network failure.
      this.offline = true;
      this.release();
      return fixed;
    }
  }

  close(): void {
    this.lifetime.abort();
    this.release();
  }

  private async open(): Promise<void> {
    const body: CreateNpcConversation = {
      npcId: this.npc.id,
      scenarioId: npcCatalog.scenarioId,
      catalogVersion: npcCatalog.version,
      phase: "preparation",
      remainingSeconds: Math.max(0.001, this.remainingSeconds - (Date.now() - this.started) / 1000),
      audience: this.childMode ? "child" : "adult",
    };
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(OPEN_TIMEOUT_MS)]),
    });
    this.checkStatus(response);
    const value: unknown = await response.json();
    if (
      !object(value) ||
      typeof value.conversationId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(value.conversationId) ||
      typeof value.token !== "string" ||
      !/^[a-f0-9-]{36}$/.test(value.token) ||
      value.catalogVersion !== npcCatalog.version
    )
      throw new Error("Invalid NPC conversation");
    this.session = {
      conversationId: value.conversationId,
      token: value.token,
      catalogVersion: value.catalogVersion,
    };
    if (this.lifetime.signal.aborted) {
      this.release();
      this.lifetime.signal.throwIfAborted();
    }
  }
  private checkStatus(response: Response): void {
    if (response.ok) return;
    if ([400, 401, 403, 409, 429].includes(response.status)) {
      throw new NpcRequestRejected(
        "会話を続けられませんでした。一度閉じて、もう一度話しかけてください。",
      );
    }
    throw new Error("NPC server unavailable");
  }
  private release(): void {
    const session = this.session;
    this.session = null;
    if (session)
      void fetch(`${API_BASE}/${session.conversationId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.token}` },
        keepalive: true,
        signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS),
      }).catch(() => {});
  }
}
