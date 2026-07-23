import { getHazardKindLabel } from "@civilcraft/game-data/types";
import type { StructureDefinition } from "../types/construction";
import { StructureCard } from "./StructureCard";

type ConstructionMenuProps = {
  budget: number;
  selectedStructureId: string;
  structures: StructureDefinition[];
  onSelect: (structureId: string) => void;
  onDragStart: (structureId: string, clientX: number, clientY: number) => void;
};

export function ConstructionMenu({
  budget,
  selectedStructureId,
  structures,
  onSelect,
  onDragStart,
}: ConstructionMenuProps) {
  const selected = structures.find(({ id }) => id === selectedStructureId);

  return (
    <section className="construction-menu" aria-label="建設ドック">
      <div className="construction-menu__heading">
        <div>
          <span className="construction-menu__heading-label">建設ドック</span>
          <strong>施設を川の青い帯へドラッグして配備</strong>
        </div>
        {selected !== undefined ? (
          <div className="construction-menu__detail" key={selected.id}>
            <div className="construction-menu__role">
              <span className="construction-menu__role-chip">
                対 {getHazardKindLabel(selected.role.primaryHazard)}
              </span>
            </div>
            <ul className="construction-menu__bullets">
              {selected.role.strengths.slice(0, 1).map((line) => (
                <li key={`s-${line}`} className="is-strength">
                  {line}
                </li>
              ))}
              {selected.role.weaknesses.slice(0, 1).map((line) => (
                <li key={`w-${line}`} className="is-weakness">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <small>タップでは建てられない。ドックから引きずり出せ</small>
        )}
      </div>
      <div className="construction-menu__list">
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
    </section>
  );
}
