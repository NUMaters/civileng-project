import * as THREE from "three";

/** CPU mirror of the fragment alpha, used only to choose a visible focus anchor. */
export function inlandWaterAlpha(depth: number, edge: number): number {
  if (!Number.isFinite(depth) || !Number.isFinite(edge)) return 0;
  const smooth = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t);
  };
  return smooth(0, 1, edge) * smooth(0.04, 0.20, depth) * (0.48 + 0.34 * smooth(0.04, 1.8, depth));
}

/** Depth is the educational field's head above rendered ground, not a surveyed
 * depth. Domain fade hides the bounded illustration's artificial square edge;
 * it is presentation only, never a hydraulic barrier or a change to scoring. */
export function createInlandWaterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec2 inlandAppearance;
      varying vec2 vInlandAppearance;
      void main() {
        vInlandAppearance = inlandAppearance;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vInlandAppearance;
      void main() {
        float depth = max(0.0, vInlandAppearance.x);
        float edge = smoothstep(0.0, 1.0, clamp(vInlandAppearance.y, 0.0, 1.0));
        float deep = smoothstep(0.04, 1.8, depth);
        vec3 tint = mix(vec3(0.10, 0.66, 0.76), vec3(0.015, 0.24, 0.42), deep);
        float alpha = edge * smoothstep(0.04, 0.20, depth) * mix(0.48, 0.82, deep);
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(tint, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
