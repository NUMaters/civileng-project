type HudLegendProps = {
  phase: string;
};

export function HudLegend({ phase }: HudLegendProps) {
  const showFloodLegend =
    phase === "disaster" || phase === "result" || phase === "review";

  return (
    <aside className="cmd-legend" aria-label="凡例と操作">
      <p className="cmd-legend__title">凡例</p>
      <ul className="cmd-legend__list">
        {showFloodLegend ? (
          <li>
            <span className="cmd-legend__swatch cmd-legend__swatch--risk" aria-hidden="true" />
            浸水リスク帯
          </li>
        ) : null}
        <li>
          <span className="cmd-legend__swatch cmd-legend__swatch--zone" aria-hidden="true" />
          配置可能帯
        </li>
        <li>
          <span className="cmd-legend__swatch cmd-legend__swatch--good" aria-hidden="true" />
          適所の影響圏
        </li>
        <li>
          <span className="cmd-legend__swatch cmd-legend__swatch--bad" aria-hidden="true" />
          逆効果・相性外
        </li>
      </ul>
      <p className="cmd-legend__hint">ドックから上へドラッグして川へ配置</p>
    </aside>
  );
}
