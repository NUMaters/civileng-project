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
    <section className="construction-menu" aria-label="土木施設">
      <div className="construction-menu__heading">
        <div>
          <span className="construction-menu__heading-label">建設ドック</span>
          <strong>カードを青い河道へドラッグして配置</strong>
        </div>
        {selected !== undefined ? (
          <p className="construction-menu__hint" key={selected.id}>
            {selected.description}
          </p>
        ) : (
          <small>タップでは配置されません。ドックからドラッグしてください</small>
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
