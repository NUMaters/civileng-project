import { useRef } from "react";
import { resolveDockPointerIntent } from "../dockGesture";
import { formatBudget } from "../services/constructionService";
import { getStructureVisual } from "../structureVisuals";
import type { StructureDefinition } from "../types/construction";

type StructureCardProps = {
  structure: StructureDefinition;
  selected: boolean;
  disabled: boolean;
  onSelect: (structureId: string) => void;
  /** 上方向ドラッグ確定時。start は pointerdown、x/y は確定時点の座標。 */
  onDragStart: (
    structureId: string,
    startX: number,
    startY: number,
    x: number,
    y: number,
    pointerId: number,
  ) => void;
};

export function StructureCard({
  structure,
  selected,
  disabled,
  onSelect,
  onDragStart,
}: StructureCardProps) {
  const visual = getStructureVisual(structure.id);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  return (
    <button
      className={`structure-card structure-card--${visual.tone}${selected ? " is-selected" : ""}`}
      disabled={disabled}
      onClick={(event) => {
        // Pointer capture can still synthesize a click after a touch drag. That click would
        // call selectStructure and clear the pending placement we just dropped on the river.
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          event.preventDefault();
          return;
        }
        onSelect(structure.id);
      }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) {
          return;
        }
        suppressClickRef.current = false;
        // preventDefault しない＝横スクロールを阻害しない
        onSelect(structure.id);
        const target = event.currentTarget;
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startY = event.clientY;
        gestureRef.current = { pointerId, startX, startY };

        const cleanup = () => {
          gestureRef.current = null;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
          target.style.touchAction = "";
        };

        const onMove = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== pointerId || gestureRef.current === null) {
            return;
          }
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          const intent = resolveDockPointerIntent(dx, dy);
          if (intent === "pending") {
            return;
          }
          if (intent === "scroll") {
            cleanup();
            return;
          }
          // 配置ドラッグ確定: 即 touch-action を止め、capture で指を追う
          suppressClickRef.current = true;
          try {
            target.style.touchAction = "none";
            target.setPointerCapture(pointerId);
          } catch {
            // capture 非対応環境でも後続の window リスナーで追従できる
          }
          // Keep the gesture alive until the global drag handler receives pointerup.
          // cleanup() would remove the only reset path and leave touch-action: none stuck.
          window.removeEventListener("pointermove", onMove);
          onDragStart(
            structure.id,
            startX,
            startY,
            moveEvent.clientX,
            moveEvent.clientY,
            pointerId,
          );
        };

        const onUp = (upEvent: PointerEvent) => {
          if (upEvent.pointerId !== pointerId) {
            return;
          }
          target.style.touchAction = "";
          cleanup();
        };

        window.addEventListener("pointermove", onMove, { passive: true });
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      }}
      type="button"
      aria-pressed={selected}
      aria-grabbed={selected}
    >
      <span className="structure-card__thumb" aria-hidden="true">
        <img
          className="structure-card__image"
          src={visual.imageSrc}
          alt=""
          draggable={false}
          width={56}
          height={56}
        />
      </span>
      <span className="structure-card__body">
        <strong>{structure.displayName}</strong>
        <small>{formatBudget(structure.constructionCost)}</small>
      </span>
      {selected ? <span className="structure-card__check" aria-hidden="true" /> : null}
    </button>
  );
}
