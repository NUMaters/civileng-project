import * as T from "three";
import { createDioramaFacility } from "./dioramaFacilities";

/** Thumbnail-only camera: never rotate the world model to make its ports legible. */
export function configureDioramaThumbnailCamera(camera: T.PerspectiveCamera, model: T.Group, id: string): void {
  const bounds = new T.Box3().setFromObject(model);
  const size = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
  const distance = Math.max(size.x, size.z, size.y * 1.5) * 1.4;
  if (id !== "drainage-pump") {
    camera.position.copy(center).add(new T.Vector3(distance * 0.65, distance * 0.65, distance));
  } else {
    const backward = new T.Vector3(0.4, 0.65, -1).normalize();
    const right = new T.Vector3().crossVectors(camera.up, backward).normalize();
    const up = new T.Vector3().crossVectors(backward, right);
    const tanY = Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * 0.9;
    const tanX = tanY * camera.aspect;
    let fit = 0;
    // Fit all eight bounds corners with a 10% margin, including the near pad edge.
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new T.Vector3(x, y, z).sub(center);
        fit = Math.max(fit, point.dot(backward) + Math.max(Math.abs(point.dot(right)) / tanX, Math.abs(point.dot(up)) / tanY));
      }
    }
    camera.position.copy(center).addScaledVector(backward, fit);
  }
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
}

let thumbnails: Promise<Record<string, string>> | undefined;
/** Cards show the exact in-game geometry, rather than a different icon or illustration. */
export function getDioramaThumbnails(): Promise<Record<string, string>> {
  thumbnails ??= Promise.resolve()
    .then(() => {
      const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(256, 192);
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.3;
      const scene = new T.Scene();
      scene.add(new T.HemisphereLight(0xffffff, 0x9ebf8d, 2.4));
      const light = new T.DirectionalLight(0xfff1ce, 3);
      light.position.set(-70, 100, 60);
      scene.add(light);
      const camera = new T.PerspectiveCamera(32, 256 / 192, 0.1, 1000);
      const result: Record<string, string> = {};
      for (const id of [
        "levee",
        "retention-basin",
        "drainage-pump",
        "revetment",
        "channel-dredging",
      ]) {
        const model = createDioramaFacility(id);
        scene.add(model);
        configureDioramaThumbnailCamera(camera, model, id);
        light.position.z = id === "drainage-pump" ? -60 : 60;
        renderer.render(scene, camera);
        result[id] = renderer.domElement.toDataURL("image/png");
        scene.remove(model);
        model.traverse((object) => {
          const mesh = object as T.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material)
            for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
              m.dispose();
        });
      }
      renderer.dispose();
      renderer.forceContextLoss();
      return result;
    })
    .catch(() => ({}));
  return thumbnails;
}
