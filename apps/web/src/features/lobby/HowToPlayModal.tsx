import { useEffect, useRef } from "react";
import { hazardChipLabel, HOWTO_FACILITIES, HOWTO_PURPOSE, HOWTO_STEPS } from "./howtoContent";

type HowToPlayModalProps = {
  titleId: string;
  onClose: () => void;
};

/**
 * 目的・操作・各施設の役割／仕組み／現実の用い方を端的に伝える。
 */
export function HowToPlayModal({ titleId, onClose }: HowToPlayModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;
    const getFocusable = () =>
      panel === null
        ? []
        : Array.from(
            panel.querySelectorAll<HTMLElement>(
              "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
            ),
          );
    getFocusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const outside = !panel?.contains(document.activeElement);
      if (outside || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [onClose]);

  return (
    <div className="howto-modal" role="presentation">
      <button
        className="howto-modal__backdrop"
        type="button"
        aria-label="閉じる"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="howto-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="howto-modal__head">
          <div>
            <p className="howto-modal__kicker">CivilCraft · 治水ガイド</p>
            <h2 id={titleId}>遊び方</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>

        <div className="howto-modal__body">
          <section className="howto-modal__section" aria-labelledby={`${titleId}-purpose`}>
            <h3 id={`${titleId}-purpose`}>{HOWTO_PURPOSE.title}</h3>
            <p>{HOWTO_PURPOSE.body}</p>
          </section>

          <section className="howto-modal__section" aria-labelledby={`${titleId}-steps`}>
            <h3 id={`${titleId}-steps`}>操作の流れ</h3>
            <ol className="howto-modal__steps">
              {HOWTO_STEPS.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <span>{step.body}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="howto-modal__section" aria-labelledby={`${titleId}-facilities`}>
            <h3 id={`${titleId}-facilities`}>施設ガイド</h3>
            <p className="howto-modal__lead">
              施設は万能ではありません。弱点の種類に合うものを、正しい場所へ。
            </p>
            <ul className="howto-modal__facilities">
              {HOWTO_FACILITIES.map((facility) => (
                <li key={facility.id} className="howto-facility">
                  <div className="howto-facility__head">
                    <img
                      className="howto-facility__icon"
                      src={facility.iconSrc}
                      alt=""
                      width={48}
                      height={48}
                      decoding="async"
                    />
                    <div className="howto-facility__titles">
                      <strong>{facility.displayName}</strong>
                      <span className="howto-facility__chip">
                        {hazardChipLabel(facility.primaryHazard)}
                      </span>
                    </div>
                  </div>
                  <dl className="howto-facility__meta">
                    <div>
                      <dt>役割</dt>
                      <dd>{facility.role}</dd>
                    </div>
                    <div>
                      <dt>仕組み</dt>
                      <dd>{facility.mechanism}</dd>
                    </div>
                    <div>
                      <dt>現実では</dt>
                      <dd>{facility.realWorld}</dd>
                    </div>
                  </dl>
                  <p className="howto-facility__tip">{facility.tip}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <button className="howto-modal__ok" type="button" onClick={onClose}>
          了解
        </button>
      </div>
    </div>
  );
}
