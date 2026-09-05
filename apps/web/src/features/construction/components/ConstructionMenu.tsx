import { useEffect, useState } from "react";
import { getHazardKindLabel } from "@civilcraft/game-data/types";
import { formatBudget } from "../services/constructionService";
import {
  getStructureEffectLabel,
  getStructureZoneMeaning,
} from "../structureVisuals";
import type { StructureDefinition } from "../types/construction";
import { StructureCard } from "./StructureCard";
import { effectRangeLabel } from "../../hud/commandCenterUtils";

type ConstructionMenuProps = {
  budget: number;
  selectedStructureId: string;
  structures: StructureDefinition[];
  onSelect: (structureId: string) => void;
  onDragStart: (
    structureId: string,
    startX: number,
    startY: number,
    x: number,
    y: number,
    pointerId: number,
  ) => void;
};

export function ConstructionMenu({
  budget,
  selectedStructureId,
  structures,
  onSelect,
  onDragStart,
}: ConstructionMenuProps) {
  const selected = structures.find(({ id }) => id === selectedStructureId);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setDetailsOpen(false);
  }, [selectedStructureId]);

  return (
    <section className="cmd-dock" aria-label="建設ドック">
      {selected !== undefined ? (
        <div
          className={`cmd-dock__tooltip${detailsOpen ? " is-expanded" : ""}`}
          key={selected.id}
        >
          <header className="cmd-dock__tooltip-head">
            <strong>{selected.displayName}</strong>
            <span>{formatBudget(selected.constructionCost)}</span>
          </header>
          <button
            className="cmd-dock__tooltip-toggle"
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? "閉じる" : "詳細"}
          </button>
          <p className="cmd-dock__tooltip-desc">{selected.description}</p>
          <dl className="cmd-dock__tooltip-meta">
            <div>
              <dt>効果</dt>
              <dd>{getStructureEffectLabel(selected.id)}</dd>
            </div>
            <div>
              <dt>影響範囲</dt>
              <dd>{effectRangeLabel(selected.id)}</dd>
            </div>
            <div>
              <dt>維持費</dt>
              <dd>{selected.maintenanceCostPerSecond} pt/s</dd>
            </div>
            <div>
              <dt>弱点</dt>
              <dd>{getHazardKindLabel(selected.role.primaryHazard)}</dd>
            </div>
          </dl>
          <p className="cmd-dock__tooltip-zone">{getStructureZoneMeaning(selected.id)}</p>
        </div>
      ) : null}

      <div className="cmd-dock__bar">
        <div className="cmd-dock__label">
          <span>施設</span>
          <small className="cmd-dock__hint">上へドラッグ → 黄色い帯</small>
        </div>
        <div className="cmd-dock__list">
          {structures.map((structure) => (
            <StructureCard
              key={structure.id}
              structure={structure}
              selected={selectedStructureId === structure.id}
              disabled={budget < structure.constructionCost}
              onSelect={onSelect}
              onDragStart={onDragStart}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
