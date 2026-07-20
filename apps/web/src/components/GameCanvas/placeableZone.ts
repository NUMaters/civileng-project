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
 * 河道＋河岸の配置可能帯を薄いシアンで示す（水面より広く、氾濫原より狭い）。
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
      width: width + 12,
      height: 0.03,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: new ColorMaterialProperty(Color.fromCssColorString("#7ec8e8").withAlpha(0.14)),
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
      material: new ColorMaterialProperty(Color.fromCssColorString("#2f9fc8").withAlpha(0.09)),
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
