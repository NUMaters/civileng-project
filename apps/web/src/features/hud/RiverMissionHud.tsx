import { useEffect, useRef, useState } from "react";
import { loadRules } from "@civilcraft/game-data/load";
import type { FloodSimulationState } from "../disaster/services/floodSimulation";

const rules = loadRules();

type Props = {
  flood: FloodSimulationState;
  budget: number;
  incomeLabel: string;
  paused: boolean;
  onPause: (paused: boolean) => void;
  onStartRain: () => void;
  onExit: () => void;
};

/** A single, thumb-sized command strip leaves the river as the main play surface. */
export function RiverMissionHud({
  flood,
  budget,
  incomeLabel,
  paused,
  onPause,
  onStartRain,
  onExit,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pauseDialog = useRef<HTMLDialogElement>(null);
  const prep = flood.phase === "preparation";
  const seconds = Math.max(0, Math.ceil(flood.phaseRemainingSeconds));
  const threshold = rules.victory.clearThresholdPercent;
  const danger = flood.damagePercent >= threshold;
  const damage = Math.max(0, flood.damagePercent);

  useEffect(() => {
    const dialog = pauseDialog.current;
    if (paused && !dialog?.open) dialog?.showModal();
    if (!paused && dialog?.open) dialog.close();
  }, [paused]);

  return (
    <header className={`river-hud${prep ? "" : " is-storm"}`} aria-label="ミッション状況">
      <div className="river-hud__location">
        <span>
          <i aria-hidden="true" /> ABUKUMA RIVER <small>福島・郡山</small>
        </span>
        <button
          type="button"
          className="river-hud__menu"
          aria-label="ゲームを一時停止"
          onClick={() => onPause(true)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M8 5v14M16 5v14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="river-hud__dashboard">
        <div className="river-hud__time">
          <span>{prep ? "大雨まで" : "雨がやむまで"}</span>
          <time>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </time>
        </div>
        <div className="river-hud__budget" aria-label="建設予算">
          <span>
            建設予算 <small>{incomeLabel}</small>
          </span>
          <strong>
            {Math.floor(budget).toLocaleString()}
            <small> pt</small>
          </strong>
        </div>
        <button
          className={`river-hud__damage${danger ? " is-danger" : ""}`}
          type="button"
          aria-expanded={detailsOpen}
          aria-label="被害と水位の詳細"
          onClick={() => setDetailsOpen(!detailsOpen)}
        >
          <span>
            街の被害 <span aria-hidden="true">⌄</span>
          </span>
          <strong>
            {damage.toFixed(1)}
            <small> %</small>
          </strong>
        </button>
      </div>
      <div className="river-hud__objective">
        <span>
          {prep ? "01 / 備える" : "02 / 守り抜く"}
          <b>
            {prep
              ? "施設を組み合わせ、街を守ろう"
              : danger
                ? "被害拡大中・追加の対策を"
                : `被害 ${threshold}% 未満で守り抜こう`}
          </b>
        </span>
        {prep ? (
          <button type="button" onClick={onStartRain}>
            大雨を開始 <span aria-hidden="true">→</span>
          </button>
        ) : (
          <span className="river-hud__rain">水位 {flood.riverLevelMeters.toFixed(1)} m</span>
        )}
      </div>
      {detailsOpen ? (
        <section className="river-hud__details" aria-label="河川と対策の詳細">
          <div>
            <span>河川水位</span>
            <strong>{flood.riverLevelMeters.toFixed(1)} m</strong>
          </div>
          <div>
            <span>配置施設</span>
            <strong>{flood.mitigation.activeStructureCount} 基</strong>
          </div>
          <div>
            <span>クリア条件</span>
            <strong>被害 {threshold}% 未満</strong>
          </div>
          <p>
            堤防でせき止め、遊水地でため、排水機場でくみ出す。異なる対策の組み合わせが街を守ります。
          </p>
        </section>
      ) : null}
      <dialog
        ref={pauseDialog}
        className="river-pause"
        onCancel={() => onPause(false)}
        onClose={() => onPause(false)}
      >
        <p>PAUSED</p>
        <h2>ひと息つこう。</h2>
        <span>時間と予算の進行を止めています。</span>
        <button
          autoFocus
          type="button"
          className="river-pause__resume"
          onClick={() => onPause(false)}
        >
          プレイを続ける
        </button>
        <button type="button" onClick={onExit}>
          メニューへ戻る
        </button>
        <small>メニューへ戻ると、現在のプレイは終了します。</small>
      </dialog>
    </header>
  );
}
