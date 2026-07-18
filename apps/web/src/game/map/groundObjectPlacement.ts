import {
  Cartesian3,
  Cartographic,
  ClassificationType,
  Color,
  EllipseGraphics,
  Ellipsoid,
  Math as CesiumMath,
} from "cesium";
import {
  isCoordinateInPlayArea,
  type GeographicCoordinate,
  type RiverPlayArea,
} from "./riverPlayArea";

const GROUND_OBJECT_RADIUS_METERS: number = 30;
const GROUND_OBJECT_COLOR: Color = Color.fromCssColorString("#ff8a00").withAlpha(0.8);

export function createGroundObjectEllipseOptions(): EllipseGraphics.ConstructorOptions {
  return {
    semiMajorAxis: GROUND_OBJECT_RADIUS_METERS,
    semiMinorAxis: GROUND_OBJECT_RADIUS_METERS,
    material: GROUND_OBJECT_COLOR,
    classificationType: ClassificationType.TERRAIN,
    zIndex: 1,
  };
}

export function isGroundObjectPositionInPlayArea(
  position: Cartesian3,
  playArea: RiverPlayArea,
  ellipsoid: Ellipsoid,
): boolean {
  const cartographic: Cartographic = Cartographic.fromCartesian(position, ellipsoid);
  const coordinate: GeographicCoordinate = [
    CesiumMath.toDegrees(cartographic.longitude),
    CesiumMath.toDegrees(cartographic.latitude),
  ];

  return isCoordinateInPlayArea(coordinate, playArea);
}
