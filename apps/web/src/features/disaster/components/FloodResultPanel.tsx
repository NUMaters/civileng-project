import type { FloodSimulationState } from "../services/floodSimulation";

type FloodResultPanelProps = Pick<
  FloodSimulationState,
  "phase" | "isClear" | "damagePercent" | "floodedAreaPercent" | "floodDepthMeters" | "score"
> & {
  usedBudget: number;
  placementCount: number;
  onRestart: () => void;
};

export function FloodResultPanel({
  phase,
  isClear,
  damagePercent,
  floodedAreaPercent,
  floodDepthMeters,
  score,
  usedBudget,
  placementCount,
  onRestart,
}: FloodResultPanelProps) {
  if (phase !== "result") {
    return null;
  }

  return (
    <div className="result-overlay">
      <section className="result-panel" role="dialog" aria-modal="true" aria-label="ゲーム結果">
        <span className={`result-panel__badge ${isClear ? "is-clear" : "is-failure"}`}>
          {isClear ? "MISSION CLEAR" : "MISSION FAILED"}
        </span>
        <h2>{isClear ? "まちを守りました" : "浸水被害が発生しました"}</h2>
        <p>
          {isClear
            ? "配置した土木技術が越水と浸水を抑えました。"
            : "施設の種類や配置場所を変えて、被災度5%未満を目指しましょう。"}
        </p>

        <div className="result-panel__score">
          <span>SCORE</span>
          <strong>{score.toLocaleString("ja-JP")}</strong>
        </div>

        <dl className="result-panel__metrics">
          <div>
            <dt>被災度</dt>
            <dd>{damagePercent.toFixed(1)}%</dd>
          </div>
          <div>
            <dt>浸水面積</dt>
            <dd>{floodedAreaPercent.toFixed(1)}%</dd>
          </div>
          <div>
            <dt>最大浸水深</dt>
            <dd>{floodDepthMeters.toFixed(2)} m</dd>
          </div>
          <div>
            <dt>使用予算</dt>
            <dd>{usedBudget.toLocaleString("ja-JP")} pt</dd>
          </div>
          <div>
            <dt>配置施設</dt>
            <dd>{placementCount} 基</dd>
          </div>
        </dl>

        <button type="button" onClick={onRestart}>
          配置を残して再挑戦
        </button>
      </section>
    </div>
  );
}
