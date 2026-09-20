import * as T from "three";
import { createDioramaFacility } from "./dioramaFacilities";

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
        const bounds = new T.Box3().setFromObject(model),
          size = bounds.getSize(new T.Vector3()),
          center = bounds.getCenter(new T.Vector3());
        const distance = Math.max(size.x, size.z, size.y * 1.5) * 1.4;
        camera.position.copy(center).add(new T.Vector3(distance * 0.65, distance * 0.65, distance));
        camera.lookAt(center);
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
