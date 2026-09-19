import { formatBudget } from "../construction/services/constructionService";
import { computeSafetyScore } from "./commandCenterUtils";
import type { MitigationSummary } from "../disaster/services/floodSimulation";

type CommandStatusPanelProps = {
  budget: number;
  budgetRatio: number;
  incomeLabel: string;
  netIncomePerSecond: number;
  damagePercent: number;
  mitigation: MitigationSummary;
  socketStatus?: string;
  socketLabel?: string;
};

export function CommandStatusPanel({
  budget,
  budgetRatio,
  incomeLabel,
  netIncomePerSecond,
  damagePercent,
  mitigation,
  socketStatus,
  socketLabel,
}: CommandStatusPanelProps) {
  const safetyScore = computeSafetyScore(damagePercent, mitigation);

  return (
    <aside className="cmd-status" aria-label="予算と安全状況">
      <div className="cmd-status__panel cmd-status__panel--budget">
        <header className="cmd-status__head">
          <span className="cmd-status__eyebrow">予算</span>
          <span className="cmd-status__icon" aria-hidden="true">
            ¥
          </span>
        </header>
        <strong className="cmd-status__budget">{formatBudget(budget)}</strong>
        {incomeLabel !== "" ? (
          <p
            className={`cmd-status__rate${netIncomePerSecond < 0 ? " is-drain" : ""}`}
            title="収入 − 維持コスト"
          >
            {incomeLabel}
          </p>
        ) : (
          <p className="cmd-status__rate is-muted">収支待機中</p>
        )}
        <div className="cmd-status__track" aria-hidden="true">
          <span className="cmd-status__fill" style={{ width: `${budgetRatio * 100}%` }} />
        </div>
      </div>

      <div className="cmd-status__panel cmd-status__panel--safety">
        <header className="cmd-status__head">
          <span className="cmd-status__eyebrow">安全度</span>
          <span className="cmd-status__icon" aria-hidden="true">
            ◎
          </span>
        </header>
        <strong className="cmd-status__safety">
          {safetyScore}
          <small>/100</small>
        </strong>
        <div className="cmd-status__track cmd-status__track--safety" aria-hidden="true">
          <span className="cmd-status__fill cmd-status__fill--safety" style={{ width: `${safetyScore}%` }} />
        </div>
      </div>

      {socketStatus !== undefined ? (
        <div className={`socket-status socket-status--${socketStatus}`} role="status">
          <span className="socket-status__dot" aria-hidden="true" />
          <span>{socketLabel ?? socketStatus}</span>
        </div>
      ) : null}
    </aside>
  );
}
