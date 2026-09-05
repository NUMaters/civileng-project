type HudMinimapProps = {
  damagePercent: number;
  overflowSiteCount: number;
};

/** 阿武隈川周辺の簡易ミニマップ＋洪水リスクゲージ。 */
export function HudMinimap({ damagePercent, overflowSiteCount }: HudMinimapProps) {
  const risk = Math.min(1, damagePercent / 12 + overflowSiteCount * 0.12);
  const riskLabel =
    risk < 0.25 ? "low" : risk < 0.5 ? "watch" : risk < 0.75 ? "warn" : "danger";
  const riskText =
    risk < 0.25 ? "低" : risk < 0.5 ? "注意" : risk < 0.75 ? "警戒" : "危険";

  return (
    <aside className="cmd-minimap" aria-label="ミニマップと洪水リスク">
      <header className="cmd-minimap__head">
        <span>リスク</span>
        <strong className={`cmd-minimap__level is-${riskLabel}`}>{riskText}</strong>
      </header>
      <div className="cmd-minimap__frame">
        <svg className="cmd-minimap__svg" viewBox="0 0 120 72" aria-hidden="true">
          <rect width="120" height="72" fill="#0a1a24" rx="4" />
          <path
            d="M8 36 C28 18, 52 54, 72 30 S96 48, 112 24"
            fill="none"
            stroke="#3d8fbf"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx="88" cy="28" r="4" fill="#f0a060" opacity={0.5 + risk * 0.5} />
          <circle cx="52" cy="40" r="3" fill="#7ec8e3" opacity="0.7" />
          <rect x="96" y="48" width="14" height="10" rx="2" fill="#c8d8e8" opacity="0.85" />
        </svg>
        <div
          className="cmd-minimap__heat"
          style={{ opacity: 0.15 + risk * 0.7 }}
          aria-hidden="true"
        />
      </div>
      <p className="cmd-minimap__caption">
        決壊 {overflowSiteCount} · 被害 {damagePercent.toFixed(1)}%
      </p>
    </aside>
  );
}
