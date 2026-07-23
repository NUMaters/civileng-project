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
      <section className="result-panel" role="dialog" aria-modal="true" aria-label="ミッション結果">
        <span className={`result-panel__badge ${isClear ? "is-clear" : "is-failure"}`}>
          {isClear ? "MISSION CLEAR" : "MISSION FAILED"}
        </span>
        <h2>{isClear ? "まちを守り切った！" : "まちが水に呑まれた…"}</h2>
        <p>
          {isClear
            ? "配備した施設が溢れを抑え込んだ。メニューから再度チャレンジできる。"
            : "施設の組み合わせと置き場を変えて、被害度 5% 未満を狙え。メニューから再挑戦しよう。"}
        </p>

        <div className="result-panel__score">
          <span>SCORE</span>
          <strong>{score.toLocaleString("ja-JP")}</strong>
        </div>

        <dl className="result-panel__metrics">
          <div>
            <dt>被害度</dt>
            <dd>{damagePercent.toFixed(1)}%</dd>
          </div>
          <div>
            <dt>浸水面積</dt>
            <dd>{floodedAreaPercent.toFixed(1)}%</dd>
          </div>
          <div>
            <dt>最大水深</dt>
            <dd>{floodDepthMeters.toFixed(2)} m</dd>
          </div>
          <div>
            <dt>消費予算</dt>
            <dd>{usedBudget.toLocaleString("ja-JP")} pt</dd>
          </div>
          <div>
            <dt>配備数</dt>
            <dd>{placementCount} 基</dd>
          </div>
        </dl>

        <div className="result-panel__actions">
          <button type="button" className="result-panel__primary" onClick={onStartNewGame}>
            ゲームメニューへ戻る
          </button>
          <button type="button" className="result-panel__secondary" onClick={onEnterReview}>
            戦況マップを見る
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
    <div className="review-mode-bar" role="region" aria-label="戦況確認">
      <div className="review-mode-bar__meta">
        <span className={`review-mode-bar__badge ${isClear ? "is-clear" : "is-failure"}`}>
          {isClear ? "CLEAR" : "FAILED"}
        </span>
        <strong>戦況確認</strong>
        <span className="review-mode-bar__score">{score.toLocaleString("ja-JP")} pt</span>
      </div>
      <p className="review-mode-bar__hint">カメラを動かして浸水の広がりをチェック</p>
      <div className="review-mode-bar__actions">
        <button type="button" className="review-mode-bar__ghost" onClick={onShowResult}>
          スコアを見る
        </button>
        <button type="button" className="review-mode-bar__primary" onClick={onStartNewGame}>
          ゲームメニューへ戻る
        </button>
      </div>
    </div>
  );
}
