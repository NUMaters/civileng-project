import { loadRules } from "@civilcraft/game-data/load";
import type { FloodSimulationState } from "../services/floodSimulation";

const CLEAR_THRESHOLD = loadRules().victory.clearThresholdPercent;

type FloodResultPanelProps = Pick<
  FloodSimulationState,
  "phase" | "isClear" | "damagePercent" | "score"
> & {
  placementCount: number;
  onEnterReview: () => void;
  onStartNewGame: () => void;
};

export function FloodResultPanel({
  phase,
  isClear,
  damagePercent,
  score,
  placementCount,
  onEnterReview,
  onStartNewGame,
}: FloodResultPanelProps) {
  if (phase !== "result") {
    return null;
  }

  const failureHint =
    damagePercent >= CLEAR_THRESHOLD + 4
      ? "弱点の種類に合う施設を、河岸の適所へ混ぜて配置してみよう。"
      : `あと ${Math.max(0.1, damagePercent - CLEAR_THRESHOLD + 0.1).toFixed(1)}% 抑えればクリア。配置のタイミングも見直してみよう。`;

  return (
    <div className="result-overlay">
      <section className="result-panel" role="dialog" aria-modal="true" aria-label="結果">
        <span className={`result-panel__badge ${isClear ? "is-clear" : "is-failure"}`}>
          {isClear ? "CLEAR" : "FAILED"}
        </span>
        <h2>{isClear ? "まちを守り切った" : "被害が広がった"}</h2>
        <p>
          {isClear
            ? `被災度 ${damagePercent.toFixed(1)}% — クリア条件（${CLEAR_THRESHOLD}% 未満）を達成。`
            : `被災度 ${damagePercent.toFixed(1)}%。クリアは ${CLEAR_THRESHOLD}% 未満。${failureHint}`}
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
            <dt>配置数</dt>
            <dd>{placementCount} 基</dd>
          </div>
        </dl>

        <div className="result-panel__actions">
          <button type="button" className="result-panel__primary" onClick={onStartNewGame}>
            メニューへ戻る
          </button>
          <button type="button" className="result-panel__secondary" onClick={onEnterReview}>
            マップを確認
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
    <div className="review-mode-bar" role="region" aria-label="マップ確認">
      <div className="review-mode-bar__meta">
        <span className={`review-mode-bar__badge ${isClear ? "is-clear" : "is-failure"}`}>
          {isClear ? "CLEAR" : "FAILED"}
        </span>
        <strong>マップ確認</strong>
        <span className="review-mode-bar__score">{score.toLocaleString("ja-JP")}</span>
      </div>
      <div className="review-mode-bar__actions">
        <button type="button" className="review-mode-bar__ghost" onClick={onShowResult}>
          結果を見る
        </button>
        <button type="button" className="review-mode-bar__primary" onClick={onStartNewGame}>
          メニューへ
        </button>
      </div>
    </div>
  );
}
