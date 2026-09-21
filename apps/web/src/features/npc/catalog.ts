import raw from "@civilcraft/game-data/npc/npc-catalog.json";
import type { NpcCatalog, NpcDefinition } from "@civilcraft/game-schema/common/npc";

export function loadCatalog(): NpcCatalog {
  const sources = new Set(raw.sources.map((source) => source.id));
  const facts = new Set(raw.knowledge.map((fact) => fact.id));
  const allNpcs = [...raw.npcs, ...raw.additionalNpcs];
  const ids = new Set(allNpcs.map((npc) => npc.id));
  if (
    ids.size !== allNpcs.length ||
    sources.size !== raw.sources.length ||
    facts.size !== raw.knowledge.length
  ) {
    throw new Error("Duplicate NPC catalog ID");
  }
  for (const source of raw.sources) {
    const url = new URL(source.url);
    if (
      url.protocol !== "https:" ||
      !(url.hostname.endsWith(".go.jp") || url.hostname.endsWith(".lg.jp"))
    )
      throw new Error("Invalid NPC source");
  }
  for (const fact of raw.knowledge) {
    if (
      !fact.approved ||
      fact.confidence !== "A" ||
      !fact.canonicalFact ||
      !fact.sourceIds.length ||
      fact.sourceIds.some((id) => !sources.has(id))
    )
      throw new Error("Unverified NPC fact");
  }
  const npcs = allNpcs.map((npc): NpcDefinition => {
    if (npc.kind !== "resident" && npc.kind !== "experienced") throw new Error("Invalid NPC kind");
    if (
      npc.topicFactIds.length === 0 ||
      new Set(npc.topicFactIds).size !== npc.topicFactIds.length ||
      npc.topicFactIds.some((id) => !facts.has(id))
    )
      throw new Error("Invalid NPC topic facts");
    if (npc.referralNpcId !== null && (!ids.has(npc.referralNpcId) || npc.referralNpcId === npc.id))
      throw new Error("Invalid NPC referral");
    if (npc.questions.length !== 3 || new Set(npc.questions.map((q) => q.id)).size !== 3)
      throw new Error("Expected three unique NPC questions");
    for (const question of npc.questions) {
      if (question.hints.length !== 3) throw new Error("Expected three hint levels");
      for (const [index, hint] of question.hints.entries()) {
        if (
          hint.level !== index + 1 ||
          hint.answers.length === 0 ||
          hint.answers.some((answer) => !answer || [...answer].length > 120) ||
          hint.factIds.some((id) => !facts.has(id)) ||
          hint.factIds.some((id) => !npc.topicFactIds.includes(id)) ||
          (hint.factIds.length === 0 && (index !== 2 || !npc.referralNpcId))
        )
          throw new Error("Invalid NPC hint");
      }
    }
    return { ...npc, kind: npc.kind };
  });
  return { ...raw, npcs };
}
export const npcCatalog = loadCatalog();
export const npcs = npcCatalog.npcs;
export const npcEnabled =
  npcCatalog.enabled &&
  import.meta.env.VITE_NPC_ENABLED !== "false" &&
  import.meta.env.VITE_NPC_PROTOTYPE !== "false";

export function sourceIdsForFacts(factIds: string[]): string[] {
  return [
    ...new Set(
      npcCatalog.knowledge
        .filter((fact) => factIds.includes(fact.id))
        .flatMap((fact) => fact.sourceIds),
    ),
  ];
}
