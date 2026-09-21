import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FloodResultPanel } from "./FloodResultPanel";

const props = {
  phase: "result" as const,
  isClear: false,
  damagePercent: 12,
  score: 100,
  placementCount: 2,
  onEnterReview: () => {},
  onStartNewGame: () => {},
};

describe("result placement guidance", () => {
  it("describes the next attempt's direct drag placement, not a removed preview step", () => {
    const html = renderToStaticMarkup(<FloodResultPanel {...props} />);
    expect(html).toContain("次の挑戦では、下の施設を川や河岸へドラッグして設置する");
    expect(html).toContain("設置後の効果表示を見て");
    expect(html).not.toMatch(/仮配置|建設プレビュー|配置を確定/);
    expect(html).toContain("マップを確認");
    expect(html).toContain("メニューへ戻る");
  });

  it("keeps failure-only guidance off the successful result", () => {
    const html = renderToStaticMarkup(<FloodResultPanel {...props} isClear damagePercent={1} />);
    expect(html).not.toContain("次の挑戦では");
    expect(html).toContain("今回の対策は、クリア条件を達成しました。");
  });
});
