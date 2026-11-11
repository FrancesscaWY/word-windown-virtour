import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

export const sampleAnimal3DCapabilities = Object.freeze({
  actions: Object.freeze(['idle', 'walk', 'run', 'turn']),
  expressions: Object.freeze([]),
  supportedActions: Object.freeze(['idle', 'walk', 'run', 'turn']),
  supportedExpressions: Object.freeze([]),
  lipSync: false,
});

const MODEL_URL = '.' + '/assets/avatars/3d/Fox.glb';

export async function createSampleAnimal3D(canvas) {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
  renderer.setSize(300, 400, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.0, 1.0, 1.33, -1.33, 0.1, 30);
  camera.position.set(3.9, 2.15, 5.6);
  camera.lookAt(0, 0.51, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x889279, 2.5));
  const key = new THREE.DirectionalLight(0xfff5e8, 3.2);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.4);
  rim.position.set(3, 3, -4);
  scene.add(rim);

  const root = new THREE.Group();
  const fox = gltf.scene;
  fox.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(fox);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = 2.05 / Math.max(size.x, size.y, size.z);
  fox.scale.setScalar(scale);
  fox.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  root.add(fox);
  scene.add(root);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.84, 48),
    new THREE.MeshBasicMaterial({ color: 0x23483b, opacity: 0.09, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  shadow.scale.y = 0.55;
  scene.add(shadow);

  const mixer = new THREE.AnimationMixer(fox);
  const clips = Object.fromEntries(gltf.animations.map(clip => [clip.name.toLowerCase(), mixer.clipAction(clip)]));
  let active = clips.survey || Object.values(clips)[0];
  active?.play();
  let lastTime = null;
  let disposed = false;

  return {
    capabilities: sampleAnimal3DCapabilities,
    draw({ time = 0, walk = false, run = false, turn = 0 } = {}) {
      if (disposed) return;
      const dt = lastTime === null ? 0 : Math.max(0, Math.min(time - lastTime, 0.1));
      lastTime = time;
      const next = run ? clips.run : walk ? clips.walk : clips.survey;
      if (next && next !== active) {
        next.reset().fadeIn(0.22).play();
        active?.fadeOut(0.22);
        active = next;
      }
      mixer.update(dt);
      root.rotation.y = turn - 0.35;
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(fox);
      scene.traverse(object => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
          material.dispose();
        }
      });
      renderer.dispose();
    },
  };
}
