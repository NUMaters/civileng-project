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
}: FloodHudProps) {
  void _onStartGame;
  const overflows = overflowSites ?? [];
  const safeMitigation = sanitizeMitigation(mitigation);
  const hazardSummary = summarizeHazards(overflows);
  const alert = alertLevel(phase, damagePercent, rainfallIntensity, overflows.length);
  const impact = computeImpactStats(damagePercent, overflows.length, floodedAreaPercent);
  const showWeather = phase === "disaster" || phase === "result" || phase === "review";
  const rainMm = precipitationMmPerHour(rainfallIntensity);
  const floodThreshold = 5.5;

  return (
    <section className={`cmd-mission cmd-mission--${phase}`} aria-label="ミッション状況">
      <header className="cmd-mission__head">
        <div>
          <p className="cmd-mission__phase">{phaseBadge[phase] ?? phase}</p>
          <h2 className="cmd-mission__title">{missionTitle(phase)}</h2>
        </div>
        {phase !== "idle" ? (
          <time className="cmd-mission__timer">{formatTime(phaseRemainingSeconds)}</time>
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
