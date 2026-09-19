import { useEffect, useRef, useState } from "react";
import type { HazardKind } from "@civilcraft/game-data/types";
import type { FloodSimulationState, MitigationSummary } from "../services/floodSimulation";
import { getHazardLabel } from "../../construction/structureVisuals";
import {
  alertLevel,
  computeImpactStats,
  missionTitle,
  precipitationMmPerHour,
} from "../../hud/commandCenterUtils";

type FloodHudProps = Pick<
  FloodSimulationState,
  | "phase"
  | "phaseRemainingSeconds"
  | "rainfallIntensity"
  | "riverLevelMeters"
  | "overflowMeters"
  | "floodDepthMeters"
  | "damagePercent"
  | "overflowSites"
  | "floodedAreaPercent"
  | "mitigation"
> & {
  onStartGame: () => void;
  onStartRainNow: () => void;
  /** ゲーム途中でも進行を中断してメニューへ戻れる。 */
  onExit?: () => void;
};

const phaseBadge = {
  idle: "待機",
  preparation: "準備",
  disaster: "大雨",
  result: "結果",
  review: "確認",
} as const;

export function FloodHud({
  phase,
  phaseRemainingSeconds,
  rainfallIntensity,
  riverLevelMeters,
  overflowMeters,
  floodDepthMeters,
  damagePercent,
  overflowSites,
  floodedAreaPercent,
  mitigation,
  onStartGame: _onStartGame,
  onStartRainNow,
  onExit = () => undefined,
}: FloodHudProps) {
  void _onStartGame;
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const cancelExitRef = useRef<HTMLButtonElement>(null);
  const overflows = overflowSites ?? [];
  const safeMitigation = sanitizeMitigation(mitigation);
  const hazardSummary = summarizeHazards(overflows);
  const alert = alertLevel(phase, damagePercent, rainfallIntensity, overflows.length);
  const impact = computeImpactStats(damagePercent, overflows.length, floodedAreaPercent);
  const showWeather = phase === "disaster" || phase === "result" || phase === "review";
  const rainMm = precipitationMmPerHour(rainfallIntensity);
  const floodThreshold = 5.5;
  const mission = missionTitle(phase);
  const missionSeparator = mission.indexOf(": ");
  const missionCode = missionSeparator >= 0 ? mission.slice(0, missionSeparator) : "";
  const missionLabel = missionSeparator >= 0 ? mission.slice(missionSeparator + 2) : mission;

  useEffect(() => {
    if (!showExitConfirm) {
      return;
    }
    cancelExitRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowExitConfirm(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showExitConfirm]);

  return (
    <section className={`cmd-mission cmd-mission--${phase}`} aria-label="ミッション状況">
      <header className="cmd-mission__head">
        <div>
          <p className="cmd-mission__phase">{phaseBadge[phase] ?? phase}</p>
          <h2 className="cmd-mission__title" aria-label={mission}>
            {missionCode ? <span className="cmd-mission__title-code">{missionCode}: </span> : null}
            {missionLabel}
          </h2>
        </div>
        {phase !== "idle" ? (
          <div className="cmd-mission__head-actions">
            <time className="cmd-mission__timer">{formatTime(phaseRemainingSeconds)}</time>
            <button
              className="cmd-mission__exit"
              type="button"
              onClick={() => setShowExitConfirm(true)}
              aria-label="ゲームを中断してメニューへ戻る"
            >
              中断
            </button>
          </div>
        ) : null}
      </header>

      {phase === "idle" ? (
        <p className="cmd-mission__idle">メニューからゲームを開始してください。</p>
      ) : (
        <>
          <div className={`cmd-mission__alert is-${alert.tone}`}>
            <span className="cmd-mission__alert-level">Lv.{alert.level}</span>
            <strong>{alert.label}</strong>
            {safeMitigation.activeStructureCount > 0 ? (
              <span className="cmd-mission__deploy">
                配置 {safeMitigation.activeStructureCount} 基
              </span>
            ) : null}
          </div>

          {showWeather ? (
            <dl className="cmd-mission__stats">
              <div>
                <dt>天候</dt>
                <dd>{rainLabel(rainfallIntensity)}</dd>
              </div>
              <div>
                <dt>降水量</dt>
                <dd>{rainMm} mm/h</dd>
              </div>
              <div>
                <dt>水位</dt>
                <dd>
                  {finiteOr(riverLevelMeters, 0).toFixed(1)} m
                  <small> / 氾濫 {floodThreshold.toFixed(1)} m</small>
                </dd>
              </div>
              <div>
                <dt>溢れ</dt>
                <dd>
                  {finiteOr(overflowMeters, 0) > 0.02
                    ? `+${finiteOr(overflowMeters, 0).toFixed(2)} m`
                    : "安定"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="cmd-mission__prep">
              阿武隈川の河岸へ施設を配置し、大雨に備えてください。
            </p>
          )}

          {showWeather ? (
            <div className="cmd-mission__impact">
              <div>
                <span>浸水危険世帯</span>
                <strong>{impact.households.toLocaleString()}</strong>
              </div>
              <div>
                <span>浸水危険人口</span>
                <strong>{impact.people.toLocaleString()}</strong>
              </div>
              <div>
                <span>被害度</span>
                <strong>{finiteOr(damagePercent, 0).toFixed(1)}%</strong>
              </div>
              <div>
                <span>水深</span>
                <strong>{finiteOr(floodDepthMeters, 0).toFixed(1)} m</strong>
              </div>
            </div>
          ) : null}

          {hazardSummary !== "" ? (
            <p className="cmd-mission__hazard">{hazardSummary}</p>
          ) : null}
        </>
      )}

      {phase === "preparation" ? (
        <button className="cmd-mission__skip" type="button" onClick={onStartRainNow}>
          準備をスキップ
        </button>
      ) : null}

      {showExitConfirm ? (
        <div className="cmd-exit-confirm" role="dialog" aria-modal="true" aria-labelledby="cmd-exit-confirm-title">
          <div className="cmd-exit-confirm__panel">
            <strong id="cmd-exit-confirm-title">ゲームを中断しますか？</strong>
            <p>現在の配置と進行状況は破棄され、メニューへ戻ります。</p>
            <div className="cmd-exit-confirm__actions">
              <button ref={cancelExitRef} type="button" className="cmd-exit-confirm__cancel" onClick={() => setShowExitConfirm(false)}>
                続ける
              </button>
              <button type="button" className="cmd-exit-confirm__leave" onClick={onExit}>
                メニューへ戻る
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(finiteOr(seconds, 0)));
  const minutes = Math.floor(safeSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function rainLabel(intensity: number): string {
  if (intensity < 0.28) {
    return "小康";
  }
  if (intensity < 0.55) {
    return "並雨";
  }
  if (intensity < 0.78) {
    return "強雨";
  }
  return "豪雨";
}

function sanitizeMitigation(mitigation: MitigationSummary | undefined): MitigationSummary {
  return {
    waterLevelReduction: finiteOr(mitigation?.waterLevelReduction, 0),
    overflowPrevention: finiteOr(mitigation?.overflowPrevention, 0),
    drainageCapacity: finiteOr(mitigation?.drainageCapacity, 0),
    bankProtection: finiteOr(mitigation?.bankProtection, 0),
    channelCapacityIncrease: finiteOr(mitigation?.channelCapacityIncrease, 0),
    activeStructureCount: Math.max(0, Math.round(finiteOr(mitigation?.activeStructureCount, 0))),
    averageEffectiveness: finiteOr(mitigation?.averageEffectiveness, 0),
    placementInterference: clamp01(finiteOr(mitigation?.placementInterference, 0)),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function summarizeHazards(sites: FloodSimulationState["overflowSites"]): string {
  if (sites.length === 0) {
    return "";
  }
  const counts = new Map<HazardKind, number>();
  for (const site of sites) {
    const key = site.primaryHazard;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([kind, count]) => `${getHazardLabel(kind)}×${count}`);
  return `警報 ${parts.join("・")}`;
}
