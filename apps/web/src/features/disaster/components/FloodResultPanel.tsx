import { loadRules } from "@civilcraft/game-data/load";
import type { FloodSimulationState } from "../services/floodSimulation";
import type { ReactNode } from "react";
import "./FloodResultPanel.css";

const CLEAR_THRESHOLD = loadRules().victory.clearThresholdPercent;

const CLEAR_THRESHOLD = loadRules().victory.clearThresholdPercent;

type FloodResultPanelProps = Pick<
  FloodSimulationState,
  "phase" | "isClear" | "damagePercent" | "score"
> & {
  placementCount: number;
  onEnterReview: () => void;
  onStartNewGame: () => void;
  children?: ReactNode;
  onRetry?: () => void;
};

export function FloodResultPanel({
  phase,
  isClear,
  damagePercent,
  score,
  placementCount,
  onEnterReview,
  onStartNewGame,
  children,
  onRetry,
}: FloodResultPanelProps) {
  if (phase !== "result") {
    return null;
  }

  const failureSteps = [
    "マップで水が街へ広がった河岸を確認する",
    "次の挑戦では、下の施設を川や河岸へドラッグし、タップで向きを調整する",
    "施設そばの✓で配置を確定し、効果表示を見て組み合わせを工夫する",
  ];

  return (
    <div className="result-overlay cc-result">
      <section className="result-panel" role="dialog" aria-modal="true" aria-label="結果">
        <p className="result-panel__eyebrow">阿武隈川 / 治水チャレンジの記録</p>
        <span className={`result-panel__badge ${isClear ? "is-clear" : "is-failure"}`}>
          {isClear ? "成功" : "失敗"}
        </span>
        <h2>{isClear ? "街を守る、一手になった。" : "次の一手で、街を守ろう。"}</h2>
        <p>
          {isClear
            ? "今回の対策は、クリア条件を達成しました。"
            : "今回はクリア条件に届きませんでした。浸水した場所を確認し、次の配置につなげよう。"}
        </p>

        <div className="result-panel__score">
          <span>スコア</span>
          <strong>{score.toLocaleString("ja-JP")}</strong>
        </div>

        <dl className="result-panel__metrics">
          <div>
            <dt>今回の被災度</dt>
            <dd>{damagePercent.toFixed(2)}%</dd>
          </div>
          <div>
            <dt>配置数</dt>
            <dd>{placementCount} 基</dd>
          </div>
        </dl>

        <p className="result-panel__threshold">
          クリア条件：被災度 {CLEAR_THRESHOLD}% 未満
          <br />
          {CLEAR_THRESHOLD}% ちょうどの場合は未達成です。
        </p>
        {!isClear ? (
          <div className="result-panel__next-steps">
            <strong>配置を見直すヒント</strong>
            <ul>
              {failureSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {children}
        <div className="result-panel__actions">
          {onRetry ? (
            <button type="button" className="result-panel__retry" onClick={onRetry}>
              もう一度挑戦
            </button>
          ) : null}
          <button type="button" className="result-panel__primary" onClick={onStartNewGame}>
            メニューへ戻る
          </button>
          <button type="button" className="result-panel__secondary" onClick={onEnterReview}>
            マップを確認
          </button>
        </div>
        {!onRetry ? (
          <p className="result-panel__return-note">
            再挑戦はメニューでシングルプレイを選択してください。
          </p>
        ) : null}
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
          {isClear ? "成功" : "失敗"}
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
