type TutorialCoachmarkProps = {
  phase: string;
  hasPlacement: boolean;
  hasPendingPlacement: boolean;
  onDismiss: () => void;
};

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
          <p>カードを川や河岸へ運んで離し、「配置する」で建設します。</p>
        </>
      ) : (
        <>
          <strong>場所を確認して「配置する」</strong>
          <p>施設をドラッグして微調整。向きは下のスライダーで変えられます。</p>
        </>
      )}
      <button className="tutorial-coach__skip" type="button" onClick={onDismiss}>
        了解
      </button>
    </aside>
  );
}
