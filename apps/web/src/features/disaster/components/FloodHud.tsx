import type { HazardKind } from "@civilcraft/game-data/types";
import type { FloodSimulationState, MitigationSummary } from "../services/floodSimulation";
import { getHazardLabel } from "../../construction/structureVisuals";

type FloodHudProps = FloodSimulationState & {
  onStartGame: () => void;
  onStartRainNow: () => void;
};

const phaseLabel = {
  idle: "待機中",
  preparation: "準備",
  disaster: "大雨",
  result: "結果",
  review: "プレビュー",
} as const;

export function FloodHud({
  phase,
  phaseRemainingSeconds,
  rainfallIntensity,
  riverLevelMeters,
  overflowMeters,
  floodDepthMeters,
  floodplainFillRatio,
  floodplainHalfWidthMeters,
  damagePercent,
  overflowSites,
  mitigation,
  protectedBankSites,
  onStartGame,
  onStartRainNow,
}: FloodHudProps) {
  const bankSites = protectedBankSites ?? [];
  const overflows = overflowSites ?? [];
  const heldSites = bankSites.filter((site) => !site.overflowing).length;
  const safeMitigation = sanitizeMitigation(mitigation);
  const hazardSummary = summarizeHazards(overflows);

  return (
    <section className={`flood-hud flood-hud--${phase}`} aria-label="災害状況">
      <div className="flood-hud__heading">
        <span className="flood-hud__phase">{phaseLabel[phase] ?? phase}</span>
        {phase !== "idle" ? (
          <strong className="flood-hud__timer">{formatTime(phaseRemainingSeconds)}</strong>
        ) : null}
      </div>

      {phase === "idle" ? (
        <>
          <strong className="flood-hud__title">阿武隈川・大雨シナリオ</strong>
          <p>
            弱点には種別があります（越水・侵食・内水）。堤防は越水、護岸は侵食、排水機場は内水、掘削・遊水地は流下不足向き。種類を合わせて配置してください。
          </p>
          <button className="flood-hud__primary" type="button" onClick={onStartGame}>
            ゲーム開始
          </button>
        </>
      ) : (
        <>
          <MitigationPanel mitigation={safeMitigation} heldSites={heldSites} />
          {hazardSummary !== "" ? (
            <p className="flood-hud__hazard-tip">{hazardSummary}</p>
          ) : null}
          <div className="flood-hud__metrics">
            <FloodMetric
              label="雨量"
              value={`${Math.round(finiteOr(rainfallIntensity, 0) * 100)}%`}
              ratio={finiteOr(rainfallIntensity, 0)}
              tone="rain"
            />
            <FloodMetric
              label="河川水位"
              value={`${finiteOr(riverLevelMeters, 0).toFixed(1)} m`}
              ratio={finiteOr(riverLevelMeters, 0) / 7}
              tone="water"
            />
            <FloodMetric
              label="越水量"
              value={
                finiteOr(overflowMeters, 0) > 0.02
                  ? `+${finiteOr(overflowMeters, 0).toFixed(2)} m`
                  : "なし"
              }
              ratio={Math.min(1, finiteOr(overflowMeters, 0) / 1.5)}
              tone="water"
            />
            <FloodMetric
              label="氾濫原"
              value={
                finiteOr(floodplainFillRatio, 0) > 0.04
                  ? `片岸 ${Math.round(finiteOr(floodplainHalfWidthMeters, 0))} m`
                  : "本川のみ"
              }
              ratio={finiteOr(floodplainFillRatio, 0)}
              tone="water"
            />
            <FloodMetric
              label="決壊地点"
              value={overflows.length > 0 ? `${overflows.length} 箇所` : "なし"}
              ratio={Math.min(1, overflows.length / 4)}
              tone="damage"
            />
            <FloodMetric
              label="最大浸水深"
              value={`${finiteOr(floodDepthMeters, 0).toFixed(2)} m`}
              ratio={finiteOr(floodDepthMeters, 0) / 2}
              tone="water"
            />
            <FloodMetric
              label="被災度"
              value={`${finiteOr(damagePercent, 0).toFixed(1)}%`}
              ratio={finiteOr(damagePercent, 0) / 100}
              tone="damage"
            />
          </div>
        </>
      )}

      {phase === "preparation" ? (
        <button className="flood-hud__rain-button" type="button" onClick={onStartRainNow}>
          準備完了・大雨を開始
        </button>
      ) : null}
    </section>
  );
}

function MitigationPanel({
  mitigation,
  heldSites,
}: {
  mitigation: MitigationSummary;
  heldSites: number;
}) {
  const hasFacilities = mitigation.activeStructureCount > 0;
  return (
    <div className="mitigation-panel" aria-label="施設の治水効果">
      <div className="mitigation-panel__title">
        <span>治水効果</span>
        <strong>{hasFacilities ? `${mitigation.activeStructureCount} 施設` : "未配置"}</strong>
      </div>
      {hasFacilities ? (
        <ul className="mitigation-panel__list">
          <li>
            <span>越水抑制</span>
            <strong>{Math.round(mitigation.overflowPrevention * 100)}%</strong>
          </li>
          <li>
            <span>水位低減</span>
            <strong>{Math.round(mitigation.waterLevelReduction * 100)}%</strong>
          </li>
          <li>
            <span>流下能力</span>
            <strong>+{mitigation.channelCapacityIncrease.toFixed(1)}</strong>
          </li>
          <li>
            <span>排水</span>
            <strong>{mitigation.drainageCapacity.toFixed(1)}</strong>
          </li>
          <li>
            <span>河岸保護</span>
            <strong>{Math.round(mitigation.bankProtection * 100)}%</strong>
          </li>
          <li>
            <span>弱点を抑制</span>
            <strong>{heldSites} 箇所</strong>
          </li>
          <li>
            <span>配置効率</span>
            <strong>{Math.round(mitigation.averageEffectiveness * 100)}%</strong>
          </li>
        </ul>
      ) : (
        <p className="mitigation-panel__empty">
          河岸に川沿いへ置くほど効きます。低い岸の弱点を優先してください
        </p>
      )}
    </div>
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

function sanitizeMitigation(mitigation: MitigationSummary | undefined): MitigationSummary {
  return {
    waterLevelReduction: finiteOr(mitigation?.waterLevelReduction, 0),
    overflowPrevention: finiteOr(mitigation?.overflowPrevention, 0),
    drainageCapacity: finiteOr(mitigation?.drainageCapacity, 0),
    bankProtection: finiteOr(mitigation?.bankProtection, 0),
    channelCapacityIncrease: finiteOr(mitigation?.channelCapacityIncrease, 0),
    activeStructureCount: Math.max(0, Math.round(finiteOr(mitigation?.activeStructureCount, 0))),
    averageEffectiveness: finiteOr(mitigation?.averageEffectiveness, 0),
  };
}

function summarizeHazards(
  sites: FloodSimulationState["overflowSites"],
): string {
  if (sites.length === 0) {
    return "";
  }
  const counts = new Map<HazardKind, number>();
  for (const site of sites) {
    const key = site.primaryHazard;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(
    ([kind, count]) => `${getHazardLabel(kind)} ${count}`,
  );
  return `発生中の弱点: ${parts.join(" / ")}（対策の種類を合わせて）`;
}
