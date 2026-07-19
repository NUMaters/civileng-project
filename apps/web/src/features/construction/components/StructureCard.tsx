import { formatBudget } from "../services/constructionService";
import type { StructureDefinition } from "../types/construction";

type StructureCardProps = {
  structure: StructureDefinition;
  selected: boolean;
  disabled: boolean;
  onSelect: (structureId: string) => void;
  onDragStart: (structureId: string, clientX: number, clientY: number) => void;
};

const structureMeta: Record<string, { glyph: string; tone: string }> = {
  levee: { glyph: "堤", tone: "amber" },
  "retention-basin": { glyph: "遊", tone: "river" },
  "drainage-pump": { glyph: "排", tone: "ember" },
  revetment: { glyph: "護", tone: "slate" },
  "channel-dredging": { glyph: "掘", tone: "moss" },
};

export function StructureCard({
  structure,
  selected,
  disabled,
  onSelect,
  onDragStart,
}: StructureCardProps) {
  const meta = structureMeta[structure.id] ?? { glyph: "工", tone: "moss" };

  return (
    <button
      className={`structure-card structure-card--${meta.tone}${selected ? " is-selected" : ""}`}
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
      <span className="structure-card__icon" aria-hidden="true">
        {meta.glyph}
      </span>
      <span className="structure-card__body">
        <strong>{structure.displayName}</strong>
        <small>{formatBudget(structure.constructionCost)}</small>
      </span>
      {selected ? <span className="structure-card__check" aria-hidden="true" /> : null}
    </button>
  );
}
