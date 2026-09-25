import { useEffect, useId, useState } from "react";
import { getHazardKindLabel } from "@civilcraft/game-data/types";
import { formatBudget } from "../services/constructionService";
import { getStructureEffectLabel, getStructureZoneMeaning } from "../structureVisuals";
import type { StructureDefinition } from "../types/construction";
import { StructureCard } from "./StructureCard";
import { effectRangeLabel } from "../../hud/commandCenterUtils";
import "./construction-dock.css";

type ConstructionMenuProps = {
  budget: number;
  selectedStructureId: string;
  structures: StructureDefinition[];
  onSelect: (structureId: string) => void;
  onKeyboardPlace: (structureId: string) => void;
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
  onKeyboardPlace,
  onDragStart,
}: ConstructionMenuProps) {
  const selected = structures.find(({ id }) => id === selectedStructureId);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();

  useEffect(() => {
    setDetailsOpen(false);
  }, [selectedStructureId]);

  return (
    <section className="cmd-dock" aria-label="建設ドック">
      {selected !== undefined ? (
        <div
          className={`cmd-dock__tooltip${detailsOpen ? " is-expanded" : ""}`}
          key={selected.id}
          id={detailsId}
          hidden={!detailsOpen}
        >
          <header className="cmd-dock__tooltip-head">
            <strong>{selected.displayName}</strong>
            <span>{formatBudget(selected.constructionCost)}</span>
          </header>
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
          <button
            className="cmd-dock__keyboard-place"
            type="button"
            onClick={() => onKeyboardPlace(selected.id)}
          >
            キーボードで配置
          </button>
        </div>
      ) : null}

      <div className="cmd-dock__bar">
        <div className="cmd-dock__label">
          <span>治水ツール</span>
          <small className="cmd-dock__hint">上へドラッグして川に配置</small>
          {selected !== undefined ? (
            <button
              className="cmd-dock__tooltip-toggle"
              type="button"
              aria-label={`${selected.displayName}の詳細${detailsOpen ? "を閉じる" : "を見る"}`}
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              {detailsOpen ? "閉じる" : "詳細"}
            </button>
          ) : null}
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
