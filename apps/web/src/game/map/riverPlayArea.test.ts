import { describe, expect, it } from "vitest";
import {
  createRiverPlayArea,
  findRiverRoute,
  isCoordinateInPlayArea,
  type GeographicCoordinate,
  type RiverPlayAreaConfig,
} from "./riverPlayArea";

const BASE_CONFIG: RiverPlayAreaConfig = {
  riverName: "テスト川",
  sourceUrl: "https://example.com/{z}/{x}/{y}.geojson",
  zoomLevel: 16,
  start: [140, 37],
  end: [140, 37.02],
  leftWidthMeters: 1_000,
  rightWidthMeters: 1_000,
  searchPaddingMeters: 500,
  maximumConnectionGapMeters: 150,
};

describe("findRiverRoute", (): void => {
  it("開始・終了地点に最も近い河川リンクを、短いデータ欠損をまたいで接続する", (): void => {
    const lines: GeographicCoordinate[][] = [
      [
        [140, 37],
        [140, 37.01],
      ],
      [
        [140, 37.011],
        [140, 37.02],
      ],
      [
        [140, 37.01],
        [140.01, 37.01],
      ],
    ];

    const route: GeographicCoordinate[] = findRiverRoute(
      lines,
      [140.0001, 37.0001],
      [140.0001, 37.0199],
      150,
    );

    expect(route[0]).toEqual([140, 37]);
    expect(route.at(-1)).toEqual([140, 37.02]);
    expect(route).toContainEqual([140, 37.011]);
    expect(route).not.toContainEqual([140.01, 37.01]);
  });

  it("接続できない河川区間ではエラーにする", (): void => {
    const lines: GeographicCoordinate[][] = [
      [
        [140, 37],
        [140, 37.001],
      ],
      [
        [140, 37.01],
        [140, 37.02],
      ],
    ];

    expect((): GeographicCoordinate[] =>
      findRiverRoute(lines, BASE_CONFIG.start, BASE_CONFIG.end, 50),
    ).toThrow("No connected river route");
  });
});

describe("createRiverPlayArea", (): void => {
  it("河川中心線に沿った帯状エリアを生成する", (): void => {
    const centerLine: GeographicCoordinate[] = [
      [140, 37],
      [140.005, 37.005],
      [140, 37.01],
      [140.005, 37.015],
      [140, 37.02],
    ];
    const playArea = createRiverPlayArea(BASE_CONFIG, centerLine);

    expect(playArea.polygons.length).toBeGreaterThan(0);
    expect(isCoordinateInPlayArea([140.005, 37.005], playArea)).toBe(true);
    expect(isCoordinateInPlayArea([140.03, 37.005], playArea)).toBe(false);
  });

  it("開始から終了へ見た左右で異なる幅を反映する", (): void => {
    const config: RiverPlayAreaConfig = {
      ...BASE_CONFIG,
      leftWidthMeters: 100,
      rightWidthMeters: 300,
    };
    const centerLine: GeographicCoordinate[] = [
      [140, 37],
      [140, 37.02],
    ];
    const playArea = createRiverPlayArea(config, centerLine);

    expect(isCoordinateInPlayArea([140.0025, 37.01], playArea)).toBe(true);
    expect(isCoordinateInPlayArea([139.9985, 37.01], playArea)).toBe(false);
  });
});
