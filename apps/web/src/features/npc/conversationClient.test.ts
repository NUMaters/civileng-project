import { afterEach, describe, expect, it, vi } from "vitest";
import { NpcConversationClient, NpcRequestRejected } from "./conversationClient";
import { npcCatalog, npcs, sourceIdsForFacts } from "./catalog";
import type { NpcDefinition } from "./types";

const resident = npcs[0] as NpcDefinition;
const session = {
  conversationId: "12345678-1234-1234-1234-123456789abc",
  token: "87654321-1234-1234-1234-123456789abc",
  catalogVersion: npcCatalog.version,
};
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NPC API client", () => {
  it("accepts a grounded answer with matching correlation and sources", async () => {
    const hint = resident.questions[0]?.hints[0];
    expect(hint).toBeDefined();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(session, 201))
      .mockImplementationOnce(async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        return response({
          requestId: body.requestId,
          npcId: resident.id,
          questionId: "past",
          hintLevel: 1,
          answerText: hint?.answers[0],
          factIds: hint?.factIds,
          sourceIds: sourceIdsForFacts(hint?.factIds ?? []),
          mode: "ai",
        });
      })
      .mockResolvedValue(response({}));
    vi.stubGlobal("fetch", fetchMock);
    const client = new NpcConversationClient(resident, 60);
    const answer = await client.answer("past", false, 1);
    expect(answer.mode).toBe("ai");
    expect(answer.answerText).toBe(hint?.answers[0]);
    client.close();
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("works without a server and preserves the correct sources at deeper levels", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const client = new NpcConversationClient(resident, 60);
    const first = await client.answer("past", false, 1);
    const second = await client.answer("past", true, 2);
    expect(first.mode).toBe("fixed");
    expect(first.factIds).toEqual(["FACT-R02"]);
    expect(second.factIds).toEqual(["FACT-R03"]);
    expect(second.sourceIds).toEqual(["flood-1998"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("uses compatible UUID and abort APIs when modern browser APIs are unavailable", async () => {
    const nativeAbortSignal = globalThis.AbortSignal;
    const nativeThrowIfAborted = nativeAbortSignal.prototype.throwIfAborted;
    vi.stubGlobal("crypto", undefined);
    vi.stubGlobal("AbortSignal", { any: undefined, timeout: undefined });
    Object.defineProperty(nativeAbortSignal.prototype, "throwIfAborted", {
      configurable: true,
      value: undefined,
    });
    const hint = resident.questions[0]?.hints[0];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(session, 201))
      .mockImplementationOnce(async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        expect(body.requestId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        return response({
          requestId: body.requestId,
          npcId: resident.id,
          questionId: "past",
          hintLevel: 1,
          answerText: hint?.answers[0],
          factIds: hint?.factIds,
          sourceIds: sourceIdsForFacts(hint?.factIds ?? []),
          mode: "ai",
        });
      })
      .mockResolvedValue(response({}));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new NpcConversationClient(resident, 60);
      await expect(client.answer("past", false, 1)).resolves.toMatchObject({ mode: "ai" });
      client.close();
    } finally {
      Object.defineProperty(nativeAbortSignal.prototype, "throwIfAborted", {
        configurable: true,
        value: nativeThrowIfAborted,
      });
    }
  });

  it("does not turn a rejected request into a fallback answer", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(session, 201))
      .mockResolvedValueOnce(response({ code: "invalid_hint" }, 409))
      .mockResolvedValue(response({}));
    vi.stubGlobal("fetch", fetchMock);
    const client = new NpcConversationClient(resident, 60);
    await expect(client.answer("past", false, 1)).rejects.toBeInstanceOf(NpcRequestRejected);
    client.close();
  });

  it("discards a malicious or mismatched answer and stops using the ambiguous session", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(session, 201))
      .mockResolvedValueOnce(response({ answerText: "<script>bad</script>", mode: "ai" }))
      .mockResolvedValue(response({}));
    vi.stubGlobal("fetch", fetchMock);
    const client = new NpcConversationClient(resident, 60);
    const result = await client.answer("past", false, 1);
    expect(result.answerText).toBe(resident.questions[0]?.hints[0]?.answers[0]);
    expect(result.factIds).toEqual(["FACT-R02"]);
    expect(result.mode).toBe("fixed");
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    client.close();
  });

  it("closes a session that finishes opening after the panel was closed", async () => {
    let finish: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(response({}));
    vi.stubGlobal("fetch", fetchMock);
    const client = new NpcConversationClient(resident, 60);
    const pending = client.answer("past", false, 1);
    client.close();
    finish(response(session, 201));
    await expect(pending).rejects.toThrow();
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(
      1,
    );
  });
});
