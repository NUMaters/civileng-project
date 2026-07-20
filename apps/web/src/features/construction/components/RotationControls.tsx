import { useEffect, useRef, useState } from "react";
import { normalizeHeadingDegrees } from "../services/constructionService";

type RotationControlsProps = {
  headingDegrees: number;
  /** 確定値（ポインタを離したとき／変更終了時）。 */
  onChange: (headingDegrees: number) => void;
  /** ドラッグ中のライブ更新（地図モデルを即回転させる）。 */
  onLiveChange?: (headingDegrees: number) => void;
  /** 地図上の施設付近に浮かべるコンパクト表示。 */
  floating?: boolean;
};

/**
 * 施設付近に置く向きスライダー。
 * ドラッグ中は onLiveChange で見た目を更新し、離したときに onChange で確定する。
 */
export function RotationControls({
  headingDegrees,
  onChange,
  onLiveChange,
  floating = true,
}: RotationControlsProps) {
  const [draftDegrees, setDraftDegrees] = useState(() =>
    Math.round(normalizeHeadingDegrees(headingDegrees)),
  );
  const draggingRef = useRef(false);

  useEffect(() => {
    if (draggingRef.current) {
      return;
    }
    setDraftDegrees(Math.round(normalizeHeadingDegrees(headingDegrees)));
  }, [headingDegrees]);

  const commit = (raw: number) => {
    const next = normalizeHeadingDegrees(raw);
    setDraftDegrees(Math.round(next));
    onChange(next);
  };

  const live = (raw: number) => {
    const next = normalizeHeadingDegrees(raw);
    setDraftDegrees(Math.round(next));
    onLiveChange?.(next);
  };

  return (
    <div
      className={`orientation-slider${floating ? " orientation-slider--floating" : ""}`}
      role="group"
      aria-label="施設の向き"
      onPointerDown={(event) => {
        // 地図のドラッグ操作に伝播させない。
        event.stopPropagation();
        draggingRef.current = true;
      }}
      onPointerUp={() => {
        draggingRef.current = false;
        commit(draftDegrees);
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
        commit(draftDegrees);
      }}
    >
      <label className="orientation-slider__track">
        <input
          className="orientation-slider__input"
          type="range"
          min={0}
          max={359}
          step={1}
          value={draftDegrees}
          aria-valuetext={`${draftDegrees}度`}
          aria-label="向きスライダー"
          onChange={(event) => {
            // React の onChange は range ではドラッグ中も発火する → ライブ反映。
            live(Number(event.target.value));
          }}
        />
      </label>
    </div>
  );
}
