import type { FloodSimulationState } from "../services/floodSimulation";

type FloodResultPanelProps = Pick<
  FloodSimulationState,
  "phase" | "isClear" | "damagePercent" | "floodedAreaPercent" | "floodDepthMeters" | "score"
> & {
  usedBudget: number;
  placementCount: number;
  onEnterReview: () => void;
  onStartNewGame: () => void;
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
  onEnterReview,
  onStartNewGame,
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
            ? "配置した土木技術が越水と浸水を抑えました。地図を自由に見渡すか、新しく挑戦できます。"
            : "施設の種類や配置場所を変えて、被災度5%未満を目指しましょう。結果の地図を確認してから再挑戦もできます。"}
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

        <div className="result-panel__actions">
          <button type="button" className="result-panel__primary" onClick={onEnterReview}>
            結果を自由に見る
          </button>
          <button type="button" className="result-panel__secondary" onClick={onStartNewGame}>
            新しくゲームを開始
          </button>
        </div>
      </section>
    </div>
  );
}

type ReviewModeBarProps = {
  isClear: boolean | null;
  score: number;
  onShowResult: () => void;
  onStartNewGame: () => void;
};

/** 結果プレビュー中の操作バー。地図操作を邪魔しないよう画面下に置く。 */
export function ReviewModeBar({
  isClear,
  score,
  onShowResult,
  onStartNewGame,
}: ReviewModeBarProps) {
  return (
    <div className="review-mode-bar" role="region" aria-label="結果プレビュー">
      <div className="review-mode-bar__meta">
        <span className={`review-mode-bar__badge ${isClear ? "is-clear" : "is-failure"}`}>
          {isClear ? "CLEAR" : "FAILED"}
        </span>
        <strong>結果プレビュー</strong>
        <span className="review-mode-bar__score">{score.toLocaleString("ja-JP")} pt</span>
      </div>
      <p className="review-mode-bar__hint">カメラを動かして浸水の様子を確認できます</p>
      <div className="review-mode-bar__actions">
        <button type="button" className="review-mode-bar__ghost" onClick={onShowResult}>
          結果サマリー
        </button>
        <button type="button" className="review-mode-bar__primary" onClick={onStartNewGame}>
          新しくゲームを開始
        </button>
      </div>
    </div>
  );
}
