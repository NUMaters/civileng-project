import { useEffect, useRef, useState } from "react";
import { FuriganaText } from "./FuriganaText";
import { NpcIcon } from "./NpcIcon";
import type { DialogueEntry, NpcDefinition, NpcPhase } from "./types";

type Props = {
  npc: NpcDefinition;
  phase: NpcPhase;
  history: DialogueEntry[];
  coolingDown: boolean;
  pending: boolean;
  error: string | null;
  disaster?: { status: string; tip: string };
  onClose: () => void;
  onAsk: (questionId: string, deeper?: boolean) => void;
  onRefer: () => void;
};

export function NpcDialoguePanel({
  npc,
  phase,
  history,
  coolingDown,
  pending,
  error,
  disaster,
  onClose,
  onAsk,
  onRefer,
}: Props) {
  const [furigana, setFurigana] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const last = history.at(-1);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    const stopEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", stopEscape, true);
    return () => {
      window.removeEventListener("keydown", stopEscape, true);
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    const element = historyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [history]);

  return (
    <dialog
      ref={dialogRef}
      className="npc-dialog"
      aria-labelledby="npc-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="npc-dialog__header">
        <NpcIcon experienced={npc.kind === "experienced"} />
        <div>
          <h2 id="npc-dialog-title">
            <FuriganaText text={npc.name} enabled={furigana} />
          </h2>
          <p>
            <FuriganaText text={npc.occupation} enabled={furigana} />
          </p>
        </div>
        <button
          type="button"
          className="npc-dialog__close"
          onClick={onClose}
          aria-label="会話を閉じる"
        >
          ×
        </button>
      </header>
      <p className="npc-dialog__notice">
        <FuriganaText
          text="会話中もゲーム時間は進みます。人物は架空の住民です。"
          enabled={furigana}
        />
      </p>
      <div className="npc-dialog__audience" aria-label="ふりがな表示">
        <button
          type="button"
          aria-pressed={furigana}
          onClick={() => setFurigana((value) => !value)}
        >
          <FuriganaText text={`ふりがな ${furigana ? "あり" : "なし"}`} enabled={furigana} />
        </button>
      </div>
      <div
        ref={historyRef}
        className="npc-dialog__history"
        role="log"
        aria-label="会話履歴"
        aria-live="polite"
      >
        <p className="npc-dialog__answer">
          <FuriganaText text={npc.introduction} enabled={furigana} />
        </p>
        {phase === "disaster" ? (
          <>
            <p className="npc-dialog__answer">
              <FuriganaText text={disaster?.status ?? ""} enabled={furigana} />
            </p>
            <p className="npc-dialog__answer">
              <FuriganaText text={disaster?.tip ?? ""} enabled={furigana} />
            </p>
          </>
        ) : (
          history.map((entry, index) => (
            <div key={index} data-answer-mode={entry.mode}>
              <p className="npc-dialog__question">
                <FuriganaText text={entry.question} enabled={furigana} />
              </p>
              <p className="npc-dialog__answer">
                <span className="npc-dialog__level">ヒント {entry.level} / 3</span>
                <FuriganaText text={entry.answer} enabled={furigana} />
              </p>
            </div>
          ))
        )}
      </div>
      {pending ? (
        <p className="npc-dialog__notice" role="status">
          <FuriganaText text="考え中…" enabled={furigana} />
        </p>
      ) : null}
      {error ? (
        <p className="npc-dialog__notice" role="alert">
          <FuriganaText text={error} enabled={furigana} />
        </p>
      ) : null}
      {phase === "preparation" ? (
        <div className="npc-dialog__actions">
          {last && last.level < 3 ? (
            <button
              type="button"
              className="npc-dialog__deeper"
              disabled={coolingDown || pending || error !== null}
              onClick={() => onAsk(last.questionId, true)}
            >
              <FuriganaText text="もっと詳しく聞く" enabled={furigana} />
            </button>
          ) : null}
          {last?.level === 3 && npc.referralNpcId && !pending ? (
            <button type="button" className="npc-dialog__deeper" onClick={onRefer}>
              <FuriganaText text="教えてもらった人を地図で見る" enabled={furigana} />
            </button>
          ) : null}
          <p>
            <FuriganaText
              text={history.length ? "ほかにも聞いてみる" : "聞きたいことを選ぼう"}
              enabled={furigana}
            />
          </p>
          {npc.questions.map((question) => (
            <button
              type="button"
              key={question.id}
              disabled={coolingDown || pending || error !== null}
              onClick={() => onAsk(question.id)}
            >
              <FuriganaText text={question.text} enabled={furigana} />
              <span aria-hidden="true"> ›</span>
            </button>
          ))}
        </div>
      ) : null}
    </dialog>
  );
}
