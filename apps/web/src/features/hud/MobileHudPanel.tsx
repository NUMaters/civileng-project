import { useState } from "react";
import { HudLegend } from "./HudLegend";
import { HudMinimap } from "./HudMinimap";

type MobileHudPanelProps = {
  phase: string;
  damagePercent: number;
  overflowSiteCount: number;
};

/** 狭幅端末向けの折りたたみ HUD（凡例＋リスク）。 */
export function MobileHudPanel({
  phase,
  damagePercent,
  overflowSiteCount,
}: MobileHudPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`cmd-mobile-hud${open ? " is-open" : ""}`}>
      <button
        className="cmd-mobile-hud__toggle"
        type="button"
        aria-expanded={open}
        aria-controls="cmd-mobile-hud-panel"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "閉じる" : "凡例・リスク"}
      </button>
      {open ? (
        <div id="cmd-mobile-hud-panel" className="cmd-mobile-hud__panel">
          <HudLegend phase={phase} />
          <HudMinimap damagePercent={damagePercent} overflowSiteCount={overflowSiteCount} />
        </div>
      ) : null}
    </div>
  );
}
