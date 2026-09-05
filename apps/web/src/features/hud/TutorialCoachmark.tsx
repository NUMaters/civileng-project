const TUTORIAL_DONE_KEY = "civilcraft.tutorialDone";

type TutorialCoachmarkProps = {
  phase: string;
  hasPlacement: boolean;
  hasPendingPlacement: boolean;
  onDismiss: () => void;
};

export function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_DONE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_DONE_KEY, "1");
  } catch {
    // ignore
  }
}

/** 初回プレイ時の配置チュートリアル。 */
export function TutorialCoachmark({
  phase,
  hasPlacement,
  hasPendingPlacement,
  onDismiss,
}: TutorialCoachmarkProps) {
  if (phase !== "preparation" || hasPlacement) {
    return null;
  }

  const step = hasPendingPlacement ? 3 : 1;

  return (
    <aside className="tutorial-coach" aria-live="polite">
      <p className="tutorial-coach__kicker">初回ヒント</p>
      {step === 1 ? (
        <>
          <strong>下のドックから施設を選び、川へドラッグ</strong>
          <p>カードを上方向にスワイプして、黄色い配置帯へドロップします。</p>
        </>
      ) : (
        <>
          <strong>向きを調整して ✓ で確定</strong>
          <p>施設上のスライダーで向きを変え、チェックで配置を確定します。</p>
        </>
      )}
      <button className="tutorial-coach__skip" type="button" onClick={onDismiss}>
        了解
      </button>
    </aside>
  );
}
