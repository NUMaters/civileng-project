import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  CornerType,
  HeightReference,
  Viewer,
} from "cesium";
import {
  ABUKUMA_RIVER_CENTERLINE,
  PLACEABLE_CORRIDOR_HALF_WIDTH_M,
} from "./abukumaRiverGeometry";

const FILL_ID = "placeable-river-bank-fill";
const EDGE_ID = "placeable-river-bank-edge";

/**
 * 河道＋河岸の配置可能帯。
 * 水色だと浸水に見えるため、工事エリア寄りのアンバー系で示す。
 */
export function createPlaceableZone(viewer: Viewer): { destroy: () => void } {
  const positions = Cartesian3.fromDegreesArray(
    ABUKUMA_RIVER_CENTERLINE.flatMap((point) => [point.lon, point.lat]),
  );
  const width = PLACEABLE_CORRIDOR_HALF_WIDTH_M * 2;

  viewer.entities.add({
    id: EDGE_ID,
    corridor: {
      positions,
      width: width + 10,
      height: 0.03,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: new ColorMaterialProperty(Color.fromCssColorString("#d4a84b").withAlpha(0.22)),
      outline: false,
      cornerType: CornerType.ROUNDED,
    },
  });

  viewer.entities.add({
    id: FILL_ID,
    corridor: {
      positions,
      width,
      height: 0.02,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: new ColorMaterialProperty(Color.fromCssColorString("#c4922e").withAlpha(0.08)),
      outline: false,
      cornerType: CornerType.ROUNDED,
    },
  });

  return {
    destroy: () => {
      viewer.entities.removeById(FILL_ID);
      viewer.entities.removeById(EDGE_ID);
    },
  };
}
