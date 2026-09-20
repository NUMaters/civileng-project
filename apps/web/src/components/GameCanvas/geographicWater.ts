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
    uniforms: { time: { value: 0 }, storm: { value: 0 } },
    vertexShader: `varying vec2 flowUv;
      void main(){ flowUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 flowUv; uniform float time; uniform float storm;
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
        vec3 clear=mix(vec3(.018,.36,.68),vec3(.035,.66,.81),.5+.22*broad);
        vec3 color=mix(clear,vec3(.12,.33,.39),clamp(storm,0.,1.)*.55);
        color=mix(color,vec3(.79,.95,1.),foam*.48*distant);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  material.name = "abukuma-flow-north";
  material.userData.provenance = "Illustrative flow and color; source polygon boundary unchanged; no invented shoreline foam";
  return material;
}
