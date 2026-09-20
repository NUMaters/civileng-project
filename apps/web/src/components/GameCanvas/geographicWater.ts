import * as THREE from "three";
import { ABUKUMA_RIVER_CENTERLINE } from "./abukumaRiverGeometry";
import { geoToWorld } from "./dioramaSpace";

// Source centreline is ordered south → north, upstream → downstream.
// Direction: https://www.city.koriyama.lg.jp/soshiki/126/2166.html
const points = ABUKUMA_RIVER_CENTERLINE.map(p => geoToWorld(p.lon, p.lat));
let station = 0;
const segments = points.slice(1).map((end, i) => {
  const start = points[i]!;
  const dx = end.x - start.x, dz = end.z - start.z, length = Math.hypot(dx, dz);
  const segment = { start, dx, dz, length, station };
  station += length;
  return segment;
});

/** Metres across/along the actual centreline. Not river width, measured speed or shoreline distance. */
export function riverFlowCoordinates(x: number, z: number) {
  let bestDistance = Infinity, lateral = 0, along = 0;
  for (const segment of segments) {
    const { start, dx, dz, length, station } = segment;
    const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / (length * length)));
    const ex = x - start.x - t * dx, ez = z - start.z - t * dz;
    const distance = ex * ex + ez * ez;
    if (distance < bestDistance) {
      bestDistance = distance;
      lateral = (ex * -dz + ez * dx) / length;
      along = station + t * length;
    }
  }
  return { lateral, along };
}

/** One shared opaque shader for source water polygons, no extra wave meshes. */
export function createGeographicWaterMaterial() {
  const material = new THREE.ShaderMaterial({
    lights: true,
    // CSS swatches are converted once into working linear RGB, not treated as linear literals.
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      { time: { value: 0 }, storm: { value: 0 },
        bodyLow: { value: new THREE.Color("#0064ae") }, bodyHigh: { value: new THREE.Color("#00b5dc") },
        skyTint: { value: new THREE.Color("#62d8f0") }, foamTint: { value: new THREE.Color("#d5fbff") },
        stormTint: { value: new THREE.Color("#316c80") } },
    ]),
    vertexShader: `varying vec2 flowUv; varying vec3 waterWorldPosition;
      #include <common>
      #include <normal_pars_vertex>
      #include <shadowmap_pars_vertex>
      void main(){
        flowUv=uv;
        vec3 transformed=position;
        #include <beginnormal_vertex>
        #include <defaultnormal_vertex>
        vec4 mvPosition=modelViewMatrix*vec4(transformed,1.);
        vec4 waterWorldPosition4=modelMatrix*vec4(transformed,1.);
        waterWorldPosition=waterWorldPosition4.xyz;
        gl_Position=projectionMatrix*mvPosition;
        #ifdef USE_SHADOWMAP
          vec4 worldPosition=waterWorldPosition4;
          #include <shadowmap_vertex>
        #endif
      }`,
    fragmentShader: `varying vec2 flowUv; varying vec3 waterWorldPosition;
      #include <common>
      #include <lights_pars_begin>
      #include <packing>
      #include <shadowmap_pars_fragment>
      // The game has one directional sun. Keep water to one hardware-filtered
      // PCF lookup rather than the standard five-tap disk on every water pixel.
      float riverStructureShadow(){
        #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
          if(!receiveShadow) return 1.;
          vec4 coord=vDirectionalShadowCoord[0];
          if(coord.w<=0.) return 1.;
          vec3 p=coord.xyz/coord.w;
          #ifdef USE_REVERSED_DEPTH_BUFFER
            p.z-=directionalLightShadows[0].shadowBias;
          #else
            p.z+=directionalLightShadows[0].shadowBias;
          #endif
          if(p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z<0.||p.z>1.) return 1.;
          #ifdef SHADOWMAP_TYPE_PCF
            return mix(1.,texture(directionalShadowMap[0],p),directionalLightShadows[0].shadowIntensity);
          #else
            return getShadow(directionalShadowMap[0],directionalLightShadows[0].shadowMapSize,
              directionalLightShadows[0].shadowIntensity,directionalLightShadows[0].shadowBias,
              directionalLightShadows[0].shadowRadius,coord);
          #endif
        #else
          return 1.;
        #endif
      }
      uniform float time; uniform float storm;
      uniform vec3 bodyLow; uniform vec3 bodyHigh; uniform vec3 skyTint;
      uniform vec3 foamTint; uniform vec3 stormTint;
      void main(){
        // Increasing station is north/downstream. Speed is illustrative, not observed hydrology.
        float along=flowUv.y-time*7.;
        float across=flowUv.x;
        float ripple=sin(along*.20+sin(across*.11+along*.018)*1.8);
        float broad=sin(along*.046-across*.07);
        float aa=max(fwidth(ripple),.008);
        float foam=smoothstep(.955-aa,.99+aa,ripple);
        foam*=smoothstep(.45,.92,sin(across*.29+along*.024));
        float distant=1.-smoothstep(1.5,5.,length(fwidth(flowUv)));
        // Analytic shading normals add volume without changing the source river
        // boundary or the raycast surface. Fade fine waves below pixel scale.
        vec2 p=waterWorldPosition.xz;
        float fineFade=1.-smoothstep(1.,4.,length(fwidth(p)));
        vec2 slope=vec2(cos(p.x*.12+p.y*.07-time*1.3),
          sin(p.y*.16-p.x*.05-time*1.7))*.075*fineFade;
        slope+=vec2(cos(p.x*.025+p.y*.018-time*.5),
          sin(p.y*.032-p.x*.021-time*.7))*.035;
        vec3 normal=normalize(vec3(-slope.x,1.,-slope.y));
        vec3 viewDirection=normalize(cameraPosition-waterWorldPosition);
        vec3 halfDirection=normalize(viewDirection+normalize(vec3(-360.,650.,300.)));
        float fresnel=pow(1.-clamp(dot(normal,viewDirection),0.,1.),4.);
        float highlight=pow(max(dot(normal,halfDirection),0.),72.);
        // Optical body shading only: NOT bathymetry, centreline depth or distance to a bank.
        float bodyTone=clamp(.52+.18*broad+.08*ripple*fineFade,0.,1.);
        vec3 clear=mix(bodyLow,bodyHigh,bodyTone);
        clear=mix(clear,skyTint,fresnel*.28);
        clear+=vec3(.85,.94,1.)*highlight*.18*(.3+.7*fineFade);
        vec3 color=mix(clear,stormTint,clamp(storm,0.,1.)*.55);
        color=mix(color,foamTint,foam*.55*distant);
        // Keep real bridge/facility shadows readable without turning water black.
        float shadowTint=1.-riverStructureShadow();
        color=mix(color,color*vec3(.55,.68,.80),shadowTint*.8);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  material.name = "abukuma-flow-north";
  material.userData.provenance = "Illustrative flow, optical body color, analytic wave normals and sky/sun highlights; receives the existing renderer shadow map for real structure shadows with subdued tint; not measured speed, depth or reflection capture. Source polygon boundary unchanged; no invented shoreline foam or bathymetry";
  return material;
}
