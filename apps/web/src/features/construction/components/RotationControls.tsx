import { useEffect, useRef, useState } from "react";
import { normalizeHeadingDegrees } from "../services/constructionService";

type RotationControlsProps = {
  headingDegrees: number;
  /** 確定値（ポインタを離したとき／キーボード変更時）。 */
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
  const draftRef = useRef(draftDegrees);
  draftRef.current = draftDegrees;

  useEffect(() => {
    if (draggingRef.current) {
      return;
    }
    setDraftDegrees(Math.round(normalizeHeadingDegrees(headingDegrees)));
  }, [headingDegrees]);

  const commit = (raw: number) => {
    const next = normalizeHeadingDegrees(raw);
    const rounded = Math.round(next);
    setDraftDegrees(rounded);
    draftRef.current = rounded;
    onChange(next);
  };

  const live = (raw: number) => {
    const next = normalizeHeadingDegrees(raw);
    const rounded = Math.round(next);
    setDraftDegrees(rounded);
    draftRef.current = rounded;
    // ライブ未指定時も操作中に向きが変わるよう onChange へフォールバック
    if (onLiveChange !== undefined) {
      onLiveChange(next);
    } else {
      onChange(next);
    }
  };

  const endDrag = () => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    commit(draftRef.current);
  };

  return (
    <div
      className={`orientation-slider${floating ? " orientation-slider--floating" : ""}`}
      role="group"
      aria-label="施設の向き"
      onPointerDown={(event) => {
        // 地図のドラッグ操作に伝播させない。
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
          value={draftDegrees}
          aria-valuetext={`${draftDegrees}度`}
          aria-label="向きスライダー"
          onPointerDown={(event) => {
            event.stopPropagation();
            draggingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onInput={(event) => {
            // input はドラッグ中の連続イベント。ここで即ライブ回転する。
            live(Number(event.currentTarget.value));
          }}
          onChange={(event) => {
            const value = Number(event.target.value);
            // キーボード等: pointer ドラッグ中でなければ確定更新。
            if (draggingRef.current) {
              live(value);
              return;
            }
            commit(value);
          }}
        />
      </label>
    </div>
  );
}
