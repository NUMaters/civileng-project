type HudMinimapProps = {
  damagePercent: number;
  overflowSiteCount: number;
};

/** 洪水リスクの簡易ゲージ（ミニマップ風）。 */
export function HudMinimap({ damagePercent, overflowSiteCount }: HudMinimapProps) {
  const risk = Math.min(1, damagePercent / 12 + overflowSiteCount * 0.12);
  const riskLabel =
    risk < 0.25 ? "low" : risk < 0.5 ? "watch" : risk < 0.75 ? "warn" : "danger";
  const riskText =
    risk < 0.25 ? "低" : risk < 0.5 ? "注意" : risk < 0.75 ? "警戒" : "危険";

  return (
    <aside className="cmd-minimap" aria-label="洪水リスク">
      <header className="cmd-minimap__head">
        <span>リスク</span>
        <strong className={`cmd-minimap__level is-${riskLabel}`}>{riskText}</strong>
      </header>
      <div className="cmd-minimap__frame">
        <div className="cmd-minimap__river" aria-hidden="true" />
        <div
          className="cmd-minimap__heat"
          style={{ opacity: 0.2 + risk * 0.75 }}
          aria-hidden="true"
        />
        <span className="cmd-minimap__marker cmd-minimap__marker--city" aria-hidden="true" />
      </div>
      <p className="cmd-minimap__caption">
        決壊 {overflowSiteCount} · 被害 {damagePercent.toFixed(1)}%
      </p>
    </aside>
  );
}
