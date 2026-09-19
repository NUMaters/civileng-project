import { Cartesian3, Cartographic, type Viewer } from "cesium";
import { useEffect, useRef } from "react";
import { NpcIcon } from "./NpcIcon";
import type { NpcDefinition } from "./types";

type Props = {
  viewer: Viewer;
  npcs: NpcDefinition[];
  highlightedId: string | null;
  onSelect: (id: string) => void;
};
const MARKER_CLEARANCE_METERS = 12;

/** 地図と同じ座標を投影し、カメラ移動・地形読込に追従するHTMLボタン。 */
export function NpcMapMarkers({ viewer, npcs, highlightedId, onSelect }: Props) {
  const elements = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (viewer.isDestroyed()) return;
    const sync = () => {
      if (viewer.isDestroyed()) return;
      const { clientWidth: width, clientHeight: height } = viewer.canvas;
      for (const npc of npcs) {
        const element = elements.current.get(npc.id);
        if (!element) continue;
        const { longitude, latitude, height: fallback } = npc.position;
        const terrainHeight = viewer.scene.globe.getHeight(
          Cartographic.fromDegrees(longitude, latitude),
        );
        const world = Cartesian3.fromDegrees(
          longitude,
          latitude,
          (terrainHeight ?? fallback) + MARKER_CLEARANCE_METERS,
        );
        const inFront =
          Cartesian3.dot(
            Cartesian3.subtract(world, viewer.camera.positionWC, new Cartesian3()),
            viewer.camera.directionWC,
          ) > 0;
        const screen = viewer.scene.cartesianToCanvasCoordinates(world);
        const visible =
          inFront &&
          screen !== undefined &&
          screen.x >= 0 &&
          screen.y >= 0 &&
          screen.x <= width &&
          screen.y <= height;
        element.style.visibility = visible ? "visible" : "hidden";
        if (screen) {
          element.style.left = `${screen.x}px`;
          element.style.top = `${screen.y}px`;
        }
      }
    };
    sync();
    const remove = viewer.scene.postRender.addEventListener(sync);
    viewer.scene.requestRender();
    return remove;
  }, [viewer, npcs]);

  return (
    <div className="npc-map-markers" aria-label="地域の人たち">
      {npcs.map((npc) => (
        <button
          type="button"
          key={npc.id}
          data-npc-id={npc.id}
          ref={(element) => {
            if (element) elements.current.set(npc.id, element);
            else elements.current.delete(npc.id);
          }}
          className={`npc-map-marker${highlightedId === npc.id ? " is-recommended" : ""}`}
          aria-label={`${npc.name}に話しかける（${npc.occupation}）`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onSelect(npc.id)}
        >
          {highlightedId === npc.id ? (
            <span className="npc-map-marker__recommended">この人に聞いてみよう</span>
          ) : null}
          <NpcIcon experienced={npc.kind === "experienced"} />
          <strong>{npc.name}</strong>
          <span>{npc.occupation}</span>
        </button>
      ))}
    </div>
  );
}
