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
  it("describes drag, tap rotation and the required confirmation without the removed panel", () => {
    const html = renderToStaticMarkup(<FloodResultPanel {...props} />);
    expect(html).toContain("次の挑戦では、下の施設を川や河岸へドラッグし、タップで向きを調整する");
    expect(html).toContain("施設そばの✓で配置を確定し、効果表示を見て");
    expect(html).not.toContain("建設プレビュー");
    expect(html).toContain("マップを確認");
    expect(html).toContain("メニューへ戻る");
  });

  it("keeps failure-only guidance off the successful result", () => {
    const html = renderToStaticMarkup(<FloodResultPanel {...props} isClear damagePercent={1} />);
    expect(html).not.toContain("次の挑戦では");
    expect(html).toContain("今回の対策は、クリア条件を達成しました。");
  });
});
