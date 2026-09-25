import {
  Cartesian2,
  Cartesian3,
  ClassificationType,
  Color,
  CornerType,
  CorridorGeometry,
  EllipsoidSurfaceAppearance,
  GeometryInstance,
  GroundPrimitive,
  Material,
  Viewer,
} from "cesium";
import { ABUKUMA_RIVER_CENTERLINE } from "./abukumaRiverGeometry";
import { getCesiumRenderProfile } from "./cesiumPerformance";
import {
  advanceRiverFlow,
  hydraulicsToWaterStyle,
  riverTextureFrame,
  smoothWaterStyle,
} from "./riverWaterSurfaceMath";

const WATER_NORMAL_MAP_URL = "/cesiumStatic/Assets/Textures/waterNormalsSmall.jpg";
const WATER_WIDTH_METERS = 88;

export type RiverHydraulics = {
  riverLevelMeters: number;
  rainfallIntensity: number;
  overflowMeters: number;
  activeFlood: boolean;
  mitigationCalm?: number;
};

export type RiverWaterSurfaceController = {
  setHydraulics: (hydraulics: RiverHydraulics) => void;
  destroy: () => void;
};

/** One terrain-clamped mesh for its entire lifetime; only shader uniforms animate. */
export async function createRiverWaterSurface(
  viewer: Viewer,
): Promise<RiverWaterSurfaceController> {
  const profile = getCesiumRenderProfile();
  await GroundPrimitive.initializeTerrainHeights();
  if (viewer.isDestroyed()) {
    return { setHydraulics: () => undefined, destroy: () => undefined };
  }

  const geometryOptions = {
    positions: Cartesian3.fromDegreesArray(
      ABUKUMA_RIVER_CENTERLINE.flatMap(({ lon, lat }) => [lon, lat]),
    ),
    width: WATER_WIDTH_METERS,
    vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT,
    cornerType: CornerType.ROUNDED,
  };
  const geometry = new CorridorGeometry(geometryOptions);
  const frame = riverTextureFrame(
    CorridorGeometry.computeRectangle(geometryOptions),
    ABUKUMA_RIVER_CENTERLINE,
  );
  // GroundPrimitive corridor ST is west->east / south->north over its rectangle,
  // NOT distance along the corridor. Scale to metres to avoid stretched waves.
  // Cesium Water's frame-number animation is disabled: advect its normal samples
  // with elapsed seconds, including on mobile and in requestRenderMode.
  const material = new Material({
    fabric: {
      type: "AbukumaFlowingWater",
      uniforms: {
        textureMeters: new Cartesian2(frame.widthMeters, frame.heightMeters),
        flowMeters: new Cartesian2(),
        flowDirection: new Cartesian2(frame.east, frame.north),
      },
      materials: {
        riverWater: {
          type: "Water",
          uniforms: {
            normalMap: WATER_NORMAL_MAP_URL,
            baseWaterColor: Color.fromCssColorString("#345451").withAlpha(0.86),
            blendColor: Color.fromCssColorString("#345451").withAlpha(0.86),
            frequency: 1,
            animationSpeed: 0,
            amplitude: 0.22,
            specularIntensity: 0.06,
            fadeFactor: 1,
          },
        },
      },
      source: `
        czm_material czm_getMaterial(czm_materialInput materialInput) {
          vec2 movingMeters = materialInput.st * textureMeters - flowMeters;
          // Broad, low-amplitude normals keep mobile pixels from sparkling.
          // Cesium Water divides its finest noise UV by ~103: ~40 m features.
          materialInput.st = movingMeters * (103.0 / 40.0);
          czm_material surface = riverWater;
          float along = dot(movingMeters, flowDirection);
          float across = dot(movingMeters, vec2(-flowDirection.y, flowDirection.x));
          // Soft transverse ripples advect downstream, gently curved across the
          // channel. No emissive lines or hard thresholds, even at flood stage.
          float ripple = sin(along * (6.2831853 / 38.0) + 0.35 * sin(across * (6.2831853 / 100.0)));
          surface.diffuse *= 0.84 + 0.035 * ripple;
          return surface;
        }
      `,
    },
  });
  // Always retain normal-map motion on phones. No polylines, dynamic entities
  // or extrusions are needed for moving water.
  const water = material.materials.riverWater!;
  const primitive = new GroundPrimitive({
    geometryInstances: new GeometryInstance({ geometry, id: "abukuma-river-water" }),
    appearance: new EllipsoidSurfaceAppearance({ material, aboveGround: false }),
    classificationType: ClassificationType.TERRAIN,
    allowPicking: false,
    asynchronous: true,
    interleave: true,
  });
  viewer.scene.groundPrimitives.add(primitive);

  const clearColor = Color.fromCssColorString("#345451");
  const muddyColor = Color.fromCssColorString("#555849");
  let target = hydraulicsToWaterStyle({
    riverLevelMeters: 2.2,
    rainfallIntensity: 0,
    overflowMeters: 0,
    activeFlood: false,
  });
  let displayed = { ...target };
  let lastUpdateAt = performance.now();
  let destroyed = false;
  // Profiles control scheduling, not whether the river moves.
  const intervalMs = Math.max(1000 / 30, profile.waterFrameIntervalMs);
  const removePreUpdate = viewer.scene.preUpdate.addEventListener(() => {
    if (destroyed || viewer.isDestroyed()) return;
    const now = performance.now();
    if (now - lastUpdateAt < intervalMs) return;
    // Avoid large jumps after a suspended/background tab resumes.
    const seconds = Math.min(0.25, Math.max(0, (now - lastUpdateAt) / 1000));
    lastUpdateAt = now;
    const next = smoothWaterStyle(displayed, target, seconds);
    const flow = material.uniforms.flowMeters as Cartesian2;
    advanceRiverFlow(flow, frame, (displayed.speed + next.speed) / 2, seconds);
    displayed = next;
    Color.lerp(clearColor, muddyColor, displayed.muddy, water.uniforms.baseWaterColor);
    water.uniforms.baseWaterColor.alpha = 0.86;
    water.uniforms.amplitude = displayed.amplitude;
    water.uniforms.specularIntensity = displayed.specular;
    viewer.scene.requestRender();
  });
  viewer.scene.requestRender();

  return {
    setHydraulics: (hydraulics) => {
      if (destroyed || viewer.isDestroyed()) return;
      target = hydraulicsToWaterStyle(hydraulics);
      viewer.scene.requestRender();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      removePreUpdate();
      if (!viewer.isDestroyed()) viewer.scene.groundPrimitives.remove(primitive);
      if (!primitive.isDestroyed()) primitive.destroy();
      // Primitive destroys geometry but does not own appearance materials.
      // Material.destroy also releases its Water submaterial/normal texture.
      if (!material.isDestroyed()) material.destroy();
    },
  };
}
