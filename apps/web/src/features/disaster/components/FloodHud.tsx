import type { HazardKind } from "@civilcraft/game-data/types";
import type { FloodSimulationState, MitigationSummary } from "../services/floodSimulation";
import { getHazardLabel } from "../../construction/structureVisuals";

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
  | "mitigation"
> & {
  onStartGame: () => void;
  onStartRainNow: () => void;
};

const phaseLabel = {
  idle: "待機",
  preparation: "準備中",
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
  mitigation,
  onStartGame: _onStartGame,
  onStartRainNow,
}: FloodHudProps) {
  void _onStartGame;
  const overflows = overflowSites ?? [];
  const safeMitigation = sanitizeMitigation(mitigation);
  const hazardSummary = summarizeHazards(overflows);
  const facilityCount = safeMitigation.activeStructureCount;
  const showFloodMetrics = phase === "disaster" || phase === "result" || phase === "review";

  return (
    <section className={`flood-hud flood-hud--${phase}`} aria-label="状況">
      <div className="flood-hud__heading">
        <span className="flood-hud__phase">{phaseLabel[phase] ?? phase}</span>
        {phase !== "idle" ? (
          <strong className="flood-hud__timer">{formatTime(phaseRemainingSeconds)}</strong>
        ) : null}
      </div>

      {phase === "idle" ? (
        <>
          <strong className="flood-hud__title">待機中</strong>
          <p>メニューから開始</p>
        </>
      ) : (
        <>
          {facilityCount > 0 ? (
            <p className="flood-hud__deploy-count" aria-label="配置数">
              配置 <strong>{facilityCount}</strong> 基
            </p>
          ) : null}
          {hazardSummary !== "" ? (
            <p className="flood-hud__hazard-tip">{hazardSummary}</p>
          ) : null}
          <div className="flood-hud__metrics">
            {showFloodMetrics ? (
              <>
                <FloodMetric
                  label="雨勢"
                  value={rainLabel(finiteOr(rainfallIntensity, 0))}
                  ratio={finiteOr(rainfallIntensity, 0)}
                  tone="rain"
                />
                <FloodMetric
                  label="水位"
                  value={`${finiteOr(riverLevelMeters, 0).toFixed(1)} m`}
                  ratio={finiteOr(riverLevelMeters, 0) / 7}
                  tone="water"
                />
                <FloodMetric
                  label="溢れ"
                  value={
                    finiteOr(overflowMeters, 0) > 0.02
                      ? `+${finiteOr(overflowMeters, 0).toFixed(2)} m`
                      : "安定"
                  }
                  ratio={Math.min(1, finiteOr(overflowMeters, 0) / 1.5)}
                  tone="water"
                />
                <FloodMetric
                  label="水深"
                  value={`${finiteOr(floodDepthMeters, 0).toFixed(1)} m`}
                  ratio={finiteOr(floodDepthMeters, 0) / 2}
                  tone="water"
                />
              </>
            ) : null}
            <FloodMetric
              label="決壊口"
              value={overflows.length > 0 ? `${overflows.length}` : "0"}
              ratio={Math.min(1, overflows.length / 4)}
              tone="damage"
            />
            <FloodMetric
              label="被害度"
              value={`${finiteOr(damagePercent, 0).toFixed(1)}%`}
              ratio={finiteOr(damagePercent, 0) / 100}
              tone="damage"
            />
          </div>
        </>
      )}

      {phase === "preparation" ? (
        <button className="flood-hud__rain-button" type="button" onClick={onStartRainNow}>
          準備をスキップ
        </button>
      ) : null}
    </section>
  );
}

type FloodMetricProps = {
  label: string;
  value: string;
  ratio: number;
  tone: "rain" | "water" | "damage";
};

function FloodMetric({ label, value, ratio, tone }: FloodMetricProps) {
  const safeRatio = Math.max(0, Math.min(1, finiteOr(ratio, 0)));
  return (
    <div className="flood-metric">
      <div className="flood-metric__copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="flood-metric__track" aria-hidden="true">
        <span
          className={`flood-metric__fill flood-metric__fill--${tone}`}
          style={{ width: `${safeRatio * 100}%` }}
        />
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(finiteOr(seconds, 0)));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
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
  const parts = [...counts.entries()].map(
    ([kind, count]) => `${getHazardLabel(kind)}×${count}`,
  );
  return `警報 ${parts.join("・")}`;
}
