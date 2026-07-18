import { Cartesian3, ClassificationType, Ellipsoid } from "cesium";
import { describe, expect, it } from "vitest";
import {
  createGroundObjectEllipseOptions,
  isGroundObjectPositionInPlayArea,
} from "./groundObjectPlacement";
import type { RiverPlayArea } from "./riverPlayArea";

const TEST_PLAY_AREA: RiverPlayArea = {
  riverName: "テスト川",
  centerLine: [
    [140, 37],
    [140, 37.02],
  ],
  polygons: [
    [
      [
        [139.99, 36.99],
        [140.01, 36.99],
        [140.01, 37.03],
        [139.99, 37.03],
        [139.99, 36.99],
      ],
    ],
  ],
  cameraTarget: [140, 37.01],
};

describe("createGroundObjectEllipseOptions", (): void => {
  it("地形上に描画する直径60mの円を生成する", (): void => {
    const options = createGroundObjectEllipseOptions();

    expect(options.semiMajorAxis).toBe(30);
    expect(options.semiMinorAxis).toBe(30);
    expect(options.classificationType).toBe(ClassificationType.TERRAIN);
    expect(options.height).toBeUndefined();
    expect(options.extrudedHeight).toBeUndefined();
  });
});

describe("isGroundObjectPositionInPlayArea", (): void => {
  it("プレイエリア内の地表位置だけを許可する", (): void => {
    const insidePosition: Cartesian3 = Cartesian3.fromDegrees(140, 37.01);
    const outsidePosition: Cartesian3 = Cartesian3.fromDegrees(140.03, 37.01);

    expect(
      isGroundObjectPositionInPlayArea(insidePosition, TEST_PLAY_AREA, Ellipsoid.WGS84),
    ).toBe(true);
    expect(
      isGroundObjectPositionInPlayArea(outsidePosition, TEST_PLAY_AREA, Ellipsoid.WGS84),
    ).toBe(false);
  });
});
