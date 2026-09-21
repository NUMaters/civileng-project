import { useEffect, useRef, useState } from "react";
import { loadRules } from "@civilcraft/game-data/load";
import type { FloodSimulationState } from "../disaster/services/floodSimulation";
import { getRiverMissionFeedback } from "./riverMissionFeedback";

const rules = loadRules();

function MetricIcon({ kind }: { kind: "rain" | "budget" | "damage" | "water" }) {
  return (
    <svg
      className="river-hud__metric-icon"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "rain" ? (
        <>
          <path fill="#20bafa" d="M8 19a6 6 0 1 1 0-12 8 8 0 0 1 15-1 6.5 6.5 0 1 1 2 13Z" />
          <path fill="#8ee9ff" d="M7 9a6 6 0 0 1 11-2c-5-1-7 1-8 5H5a4 4 0 0 1 2-3Z" />
          <path
            fill="#008fe0"
            d="M8 21s-5 6-1 7 3-4 1-7Zm9 2s-5 6-1 7 3-4 1-7Zm8-3s-5 6-1 7 3-4 1-7Z"
          />
        </>
      ) : kind === "budget" ? (
        <>
          <path fill="#efa600" d="M2 15h14v12c0 5-14 5-14 0Zm13-8h15v18c0 5-15 5-15 0Z" />
          <path
            fill="none"
            stroke="#ffdb39"
            strokeWidth="2"
            d="M3 20c4 3 9 3 12 0M3 25c4 3 9 3 12 0M16 13c4 3 9 3 13 0M16 18c4 3 9 3 13 0M16 23c4 3 9 3 13 0"
          />
          <ellipse cx="9" cy="15" rx="7" ry="3.5" fill="#ffe75c" stroke="#ffc317" />
          <ellipse cx="22.5" cy="7" rx="7.5" ry="4" fill="#ffe75c" stroke="#ffc317" />
        </>
      ) : kind === "damage" ? (
        <>
          <path fill="#d9f1ff" d="M7 13h19v16H7Z" />
          <path fill="#ff7853" d="m3 14 13-12 14 12-3 3L16 7 6 17Z" />
          <path fill="#ffb049" d="M22 3h4v8h-4Z" />
          <path fill="#258bd0" d="M11 17h5v5h-5Zm9 4h4v8h-4Z" />
          <path fill="#52cc87" d="M2 26c0-6 7-6 7 0 5-1 5 5 0 5H4c-4 0-4-4-2-5Z" />
        </>
      ) : (
        <>
          <rect x="2" y="2" width="28" height="28" rx="9" fill="#d9f7ff" />
          <path fill="#209df0" d="M2 10c5-7 9 7 15 0s9-1 13 0v8H2Z" />
          <path fill="#fff" d="M2 16c5-7 9 7 15 0s9-1 13 0v7H2Z" />
          <path fill="#12c5ee" d="M2 22c5-7 9 7 15 0s9-1 13 0c0 5-3 8-9 8H11c-6 0-9-3-9-8Z" />
        </>
      )}
    </svg>
  );
}

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
  const mission = getRiverMissionFeedback(flood);

  useEffect(() => {
    const dialog = pauseDialog.current;
    if (paused && !dialog?.open) dialog?.showModal();
    if (!paused && dialog?.open) dialog.close();
  }, [paused]);

  return (
    <header className={`river-hud${prep ? "" : " is-storm"}`} aria-label="ミッション状況">
      <div className="river-hud__dashboard">
        <div className="river-hud__time">
          <MetricIcon kind="rain" />
          <span>{prep ? "大雨まで" : "雨がやむまで"}</span>
          <time>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </time>
        </div>
        <div className="river-hud__budget" aria-label="建設予算">
          <MetricIcon kind="budget" />
          <span>建設予算</span>
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
          <MetricIcon kind="damage" />
          <span>
            街の被害 <span aria-hidden="true">⌄</span>
          </span>
          <strong>
            {damage.toFixed(1)}
            <small> %</small>
          </strong>
        </button>
        <button
          type="button"
          className="river-hud__menu"
          aria-label="ゲームを一時停止"
          onClick={() => onPause(true)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M8 5v14M16 5v14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="river-hud__objective">
        <span>被害 {threshold}% 未満で街を守ろう</span>
        {prep ? (
          <button type="button" onClick={onStartRain}>
            大雨を開始 <span aria-hidden="true">→</span>
          </button>
        ) : (
          <span className="river-hud__rain">
            {mission.overflowingSites > 0 ? "浸水が広がっています" : "大雨に備えよう"}
          </span>
        )}
      </div>
      {detailsOpen ? (
        <section className="river-hud__details" aria-label="河川と対策の詳細">
          <p>{mission.objective}</p>
          <div>
            <span>予算の増減</span>
            <strong>{incomeLabel}</strong>
          </div>
          <div>
            <span>河川水位</span>
            <strong>{flood.riverLevelMeters.toFixed(1)} m</strong>
          </div>
          <div>
            <span>配置施設</span>
            <strong>{flood.mitigation.activeStructureCount} 基</strong>
          </div>
          <div>
            <span>平均配置有効率</span>
            <strong>
              {mission.averageEffectiveness === null
                ? "—"
                : `${Math.round(mission.averageEffectiveness * 100)}%`}
            </strong>
          </div>
          <div>
            <span>{prep ? "弱点カバー" : "現在の防護 / 氾濫"}</span>
            <strong>
              {prep
                ? `${mission.coveredSites} 地点`
                : `${mission.protectedSites} / ${mission.overflowingSites} 地点`}
            </strong>
          </div>
          <div>
            <span>クリア条件</span>
            <strong>被害 {threshold}% 未満</strong>
          </div>
          <p>
            有効率は確定施設の位置・向き・弱点との相性の平均。カバー数は被害を防いだ数ではありません。
            被害率はゲーム全体の計算値です。地図の浸水は地形条件を満たす場所の模式表現で、表示面積とは一致しません。
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
