import type { FloodSimulationState } from "../services/floodSimulation";

type FloodHudProps = FloodSimulationState & {
  onStartGame: () => void;
  onStartRainNow: () => void;
};

const phaseLabel = {
  idle: "待機中",
  preparation: "準備",
  disaster: "大雨",
  result: "結果",
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
  onStartGame,
  onStartRainNow,
}: FloodHudProps) {
  return (
    <section className={`flood-hud flood-hud--${phase}`} aria-label="災害状況">
      <div className="flood-hud__heading">
        <span className="flood-hud__phase">{phaseLabel[phase]}</span>
        {phase !== "idle" ? (
          <strong className="flood-hud__timer">{formatTime(phaseRemainingSeconds)}</strong>
        ) : null}
      </div>

      {phase === "idle" ? (
        <>
          <strong className="flood-hud__title">阿武隈川・大雨シナリオ</strong>
          <p>施設を配置して、日本大学周辺の浸水を5%未満に抑えてください。</p>
          <button className="flood-hud__primary" type="button" onClick={onStartGame}>
            ゲーム開始
          </button>
        </>
      ) : (
        <div className="flood-hud__metrics">
          <FloodMetric
            label="雨量"
            value={`${Math.round(rainfallIntensity * 100)}%`}
            ratio={rainfallIntensity}
            tone="rain"
          />
          <FloodMetric
            label="河川水位"
            value={`${riverLevelMeters.toFixed(1)} m`}
            ratio={riverLevelMeters / 7}
            tone="water"
          />
          <FloodMetric
            label="越水量"
            value={overflowMeters > 0.02 ? `+${overflowMeters.toFixed(2)} m` : "なし"}
            ratio={Math.min(1, overflowMeters / 1.5)}
            tone="water"
          />
          <FloodMetric
            label="局所流出"
            value={overflowSites.length > 0 ? `${overflowSites.length} 箇所` : "なし"}
            ratio={Math.min(1, overflowSites.length / 4)}
            tone="damage"
          />
          <FloodMetric
            label="最大浸水深"
            value={`${floodDepthMeters.toFixed(2)} m`}
            ratio={floodDepthMeters / 2}
            tone="water"
          />
          <FloodMetric
            label="被災度"
            value={`${damagePercent.toFixed(1)}%`}
            ratio={damagePercent / 100}
            tone="damage"
          />
        </div>
      )}

      {phase === "preparation" ? (
        <button className="flood-hud__rain-button" type="button" onClick={onStartRainNow}>
          準備完了・大雨を開始
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
  const safeRatio = Math.max(0, Math.min(1, ratio));
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
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
