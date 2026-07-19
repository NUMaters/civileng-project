import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  CesiumGameMap,
  type CesiumGameMapHandle,
} from "./components/GameCanvas/CesiumGameMap";
import { ConstructionMenu, useConstruction } from "./features/construction";
import { formatBudget } from "./features/construction/services/constructionService";

type DockDragState = {
  structureId: string;
  displayName: string;
  glyph: string;
  x: number;
  y: number;
};

const structureGlyphs: Record<string, string> = {
  levee: "堤",
  "retention-basin": "遊",
  "drainage-pump": "排",
  revetment: "護",
  "channel-dredging": "掘",
};

export function App() {
  const construction = useConstruction();
  const mapRef = useRef<CesiumGameMapHandle>(null);
  const dragRef = useRef<DockDragState | null>(null);
  const [drag, setDrag] = useState<DockDragState | null>(null);
  const budgetRatio = Math.max(0, Math.min(1, construction.budget / 10_000));

  const beginDockDrag = useCallback(
    (structureId: string, clientX: number, clientY: number) => {
      const structure = construction.structures.find(({ id }) => id === structureId);
      if (structure === undefined) {
        return;
      }
      if (construction.budget < structure.constructionCost) {
        construction.setMessage("予算が足りません");
        return;
      }
      const next: DockDragState = {
        structureId,
        displayName: structure.displayName,
        glyph: structureGlyphs[structureId] ?? "工",
        x: clientX,
        y: clientY,
      };
      dragRef.current = next;
      setDrag(next);
    },
    [construction],
  );

  useEffect(() => {
    if (drag === null) {
      return;
    }

    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (current === null) {
        return;
      }
      const next = { ...current, x: event.clientX, y: event.clientY };
      dragRef.current = next;
      setDrag(next);
    };

    const onUp = (event: PointerEvent) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (current === null) {
        return;
      }
      mapRef.current?.tryDropStructure(current.structureId, event.clientX, event.clientY);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag]);

  return (
    <main className={`game-shell${drag !== null ? " is-dock-dragging" : ""}`}>
      <div className="game-shell__veil game-shell__veil--top" aria-hidden="true" />
      <div className="game-shell__veil game-shell__veil--bottom" aria-hidden="true" />

      <CesiumGameMap
        ref={mapRef}
        placements={construction.placements}
        structures={construction.structures}
        selectedPlacementId={construction.selectedPlacementId}
        onDropPlace={construction.placeStructureAt}
        onRotatePlacement={construction.rotatePlacement}
        onSelectPlacement={construction.setSelectedPlacementId}
        onInvalidPosition={construction.setMessage}
      />

      <header className="game-header game-header--budget-only">
        <div className="budget-panel" aria-label="残り予算">
          <div className="budget-panel__meta">
            <span>BUDGET</span>
            <strong key={construction.budget}>{formatBudget(construction.budget)}</strong>
          </div>
          <div className="budget-panel__track" aria-hidden="true">
            <div className="budget-panel__fill" style={{ width: `${budgetRatio * 100}%` }} />
          </div>
        </div>
      </header>

      {construction.message !== "" ? (
        <p key={construction.message} className="game-toast" role="status">
          {construction.message}
        </p>
      ) : null}

      <ConstructionMenu
        budget={construction.budget}
        selectedStructureId={construction.selectedStructureId}
        structures={construction.structures}
        onSelect={construction.selectStructure}
        onDragStart={beginDockDrag}
      />

      {drag !== null ? (
        <div
          className="dock-drag-ghost"
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <span className="dock-drag-ghost__icon">{drag.glyph}</span>
          <span>{drag.displayName}</span>
        </div>
      ) : null}
    </main>
  );
}
