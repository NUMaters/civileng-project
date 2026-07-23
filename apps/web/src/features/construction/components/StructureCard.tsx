import { formatBudget } from "../services/constructionService";
import { getStructureVisual } from "../structureVisuals";
import type { StructureDefinition } from "../types/construction";

type StructureCardProps = {
  structure: StructureDefinition;
  selected: boolean;
  disabled: boolean;
  onSelect: (structureId: string) => void;
  onDragStart: (structureId: string, clientX: number, clientY: number) => void;
};

export function StructureCard({
  structure,
  selected,
  disabled,
  onSelect,
  onDragStart,
}: StructureCardProps) {
  const visual = getStructureVisual(structure.id);

  return (
    <button
      className={`structure-card structure-card--${visual.tone}${selected ? " is-selected" : ""}`}
      disabled={disabled}
      onClick={() => onSelect(structure.id)}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) {
          return;
        }
        event.preventDefault();
        onSelect(structure.id);
        onDragStart(structure.id, event.clientX, event.clientY);
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
          width={72}
          height={72}
        />
      </span>
      <span className="structure-card__body">
        <strong>{structure.displayName}</strong>
        <small>{formatBudget(structure.constructionCost)}</small>
        <em className="structure-card__role">{structure.role.primaryHazard === "overtopping"
          ? "対・越水"
          : structure.role.primaryHazard === "erosion"
            ? "対・侵食"
            : structure.role.primaryHazard === "inlandPonding"
              ? "対・内水"
              : "対・水位"}</em>
      </span>
      {selected ? <span className="structure-card__check" aria-hidden="true" /> : null}
    </button>
  );
}
