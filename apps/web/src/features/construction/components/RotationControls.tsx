import { normalizeHeadingDegrees } from "../services/constructionService";

type RotationControlsProps = {
  headingDegrees: number;
  onChange: (headingDegrees: number) => void;
  /** 地図上の施設付近に浮かべるコンパクト表示。 */
  floating?: boolean;
};

/**
 * 施設付近に置くシンプルな向きスライダー。
 */
export function RotationControls({
  headingDegrees,
  onChange,
  floating = true,
}: RotationControlsProps) {
  const displayDegrees = Math.round(normalizeHeadingDegrees(headingDegrees));

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
      <label className="orientation-slider__track">
        <input
          className="orientation-slider__input"
          type="range"
          min={0}
          max={359}
          step={1}
          value={displayDegrees}
          aria-valuetext={`${displayDegrees}度`}
          aria-label="向きスライダー"
          onChange={(event) => onChange(normalizeHeadingDegrees(Number(event.target.value)))}
        />
      </label>
    </div>
  );
}
