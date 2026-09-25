import { npcCatalog, sourceIdsForFacts } from "./catalog";

export function NpcSources({ factIds }: { factIds: string[] }) {
  if (factIds.length === 0) return null;
  const sourceIds = sourceIdsForFacts(factIds);
  return (
    <details className="npc-result-note npc-sources">
      <summary>住民の話に使われた資料（{sourceIds.length}件）</summary>
      <p>人物は架空です。地域の記録と技術の説明は、次の公的資料をもとにしています。</p>
      <ul>
        {npcCatalog.sources
          .filter((source) => sourceIds.includes(source.id))
          .map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
              <small>
                {source.agency} ／ {source.year} ／ {source.section}
              </small>
            </li>
          ))}
      </ul>
      <p>ゲームの被害表示はシミュレーションです。現実の水位・避難情報とは異なります。</p>
    </details>
  );
}
