import { useRef } from "react";
import { resolveDockPointerIntent } from "../dockGesture";
import { formatBudget } from "../services/constructionService";
import { getStructureVisual } from "../structureVisuals";
import type { StructureDefinition } from "../types/construction";

const TOOL_PURPOSES: Record<string, string> = {
  levee: "せき止める",
  "retention-basin": "ためる",
  "drainage-pump": "くみ出す",
  revetment: "岸を守る",
  "channel-dredging": "流れを広げる",
};

const TOOL_SILHOUETTES: Record<string, string> = {
  levee: "M5 32 17 12h10l12 20Z M17 12l5 20 M5 37h34",
  "retention-basin": "M5 15v16q17 10 34 0V15 M5 15q17-10 34 0-17 10-34 0Z M11 27q11 6 22 0",
  "drainage-pump":
    "M7 35V19h18v16Z M11 19v-7h10v7 M25 26h7V12h7 M11 35h10 M13 26h6 M35 18v5m-3-3 3 3 3-3",
  revetment: "M5 35 19 10h8L17 35Z M15 18h12 M11 26h12 M26 31q3-3 6 0t7 0 M24 37q3-3 6 0t9 0",
  "channel-dredging":
    "M4 13h7l6 22h10l6-22h7 M17 14h10 M22 14v14m-4-4 4 4 4-4 M3 24h7m-3-3 3 3-3 3 M41 24h-7m3-3-3 3 3 3",
};

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
      aria-label={`${structure.displayName}、${TOOL_PURPOSES[structure.id] ?? "川を守る"}、${formatBudget(structure.constructionCost)}${disabled ? "、予算不足" : ""}`}
    >
      <span className="structure-card__thumb" aria-hidden="true">
        <svg
          className="structure-card__image"
          viewBox="0 0 44 44"
          width={36}
          height={36}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          <path d={TOOL_SILHOUETTES[structure.id] ?? TOOL_SILHOUETTES.levee} />
        </svg>
      </span>
      <span className="structure-card__body">
        <strong>{structure.displayName}</strong>
        <span className="structure-card__purpose">{TOOL_PURPOSES[structure.id] ?? "川を守る"}</span>
        <small>{formatBudget(structure.constructionCost)}</small>
      </span>
      {selected ? <span className="structure-card__check" aria-hidden="true" /> : null}
    </button>
  );
}
