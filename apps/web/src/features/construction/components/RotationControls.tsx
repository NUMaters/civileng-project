import { useEffect, useRef } from "react";
import { normalizeHeadingDegrees } from "../services/constructionService";

type RotationControlsProps = {
  headingDegrees: number;
  onChange: (headingDegrees: number) => void;
  /** 地図上の施設付近に浮かべるコンパクト表示。 */
  floating?: boolean;
};

const NUDGE_STEP = 15;

/**
 * 施設付近に置くシンプルな向きスライダー。
 */
export function RotationControls({
  headingDegrees,
  onChange,
  floating = true,
}: RotationControlsProps) {
  const displayDegrees = Math.round(normalizeHeadingDegrees(headingDegrees));
  const headingRef = useRef(headingDegrees);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    headingRef.current = headingDegrees;
  }, [headingDegrees]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const applyAbsolute = (nextDegrees: number) => {
    const next = normalizeHeadingDegrees(nextDegrees);
    headingRef.current = next;
    onChangeRef.current(next);
  };

  const nudge = (deltaDegrees: number) => {
    applyAbsolute(headingRef.current + deltaDegrees);
  };

  return (
    <div
      className={`orientation-slider${floating ? " orientation-slider--floating" : ""}`}
      role="group"
      aria-label="施設の向き"
      onPointerDown={(event) => {
        // 地図の回転ドラッグに伝播させない。
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="orientation-slider__nudge"
        aria-label={`左へ ${NUDGE_STEP} 度`}
        onClick={() => nudge(-NUDGE_STEP)}
      >
        ↺
      </button>
      <label className="orientation-slider__track">
        <span className="orientation-slider__value" aria-live="polite">
          {displayDegrees}°
        </span>
        <input
          className="orientation-slider__input"
          type="range"
          min={0}
          max={359}
          step={1}
          value={displayDegrees}
          aria-valuetext={`${displayDegrees}度`}
          aria-label="向きスライダー"
          onChange={(event) => applyAbsolute(Number(event.target.value))}
        />
      </label>
      <button
        type="button"
        className="orientation-slider__nudge"
        aria-label={`右へ ${NUDGE_STEP} 度`}
        onClick={() => nudge(NUDGE_STEP)}
      >
        ↻
      </button>
    </div>
  );
}
