/*
 * Official Live2D Cubism Web sample wrapper.
 *
 * The Wanko model and Cubism Core are distributed by Live2D under their
 * respective sample/proprietary licenses. See public/assets/avatars/live2d/LICENSE.md.
 * This adapter deliberately exposes only the motions that Wanko actually has:
 * Idle and TapBody. It does not claim that a 2D model can turn or walk when
 * those animations are not present in its source assets.
 */

// Keep URLs relative to the document so the same local assets work from the
// dev server, a deployment sub-path, and dist/offline-preview.html.
const RUNTIME_ROOT = './src/vendor/live2d';
const MODEL_ROOT = '.' + '/assets/avatars/live2d/Wanko/Wanko.model3.json';
let runtimePromise;

function loadScript(src, globalName) {
  if (globalName && globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-live2d-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve(globalName ? globalThis[globalName] : undefined);
        return;
      }
      if (existing.dataset.failed === 'true') existing.remove();
      else {
        existing.addEventListener('load', () => resolve(globalThis[globalName]), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.live2dSrc = src;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(globalName ? globalThis[globalName] : undefined); };
    script.onerror = () => { script.dataset.failed = 'true'; reject(new Error(`Live2D runtime failed to load: ${src}`)); };
    document.head.appendChild(script);
  });
}

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      await loadScript(`${RUNTIME_ROOT}/pixi.min.js`, 'PIXI');
      await loadScript(`${RUNTIME_ROOT}/live2dcubismcore.min.js`, 'Live2DCubismCore');
      // Cubism4 extends the existing PIXI namespace, so checking `PIXI` here
      // would incorrectly skip this script after Pixi itself was loaded.
      await loadScript(`${RUNTIME_ROOT}/cubism4.min.js`);
      if (!globalThis.PIXI?.live2d?.Live2DModel) {
        throw new Error('Live2D display runtime is unavailable');
      }
      return globalThis.PIXI;
    })().catch(error => {
      runtimePromise = undefined;
      throw error;
    });
  }
  return runtimePromise;
}

function emitStatus(options, detail) {
  options.onStatus?.(detail);
}

function setParameter(core, id, value) {
  if (!core?.getParameterIndex || !core?.setParameterValueById) return;
  if (core.getParameterIndex(id) >= 0) core.setParameterValueById(id, value);
}

/**
 * Mounts the official Wanko Cubism model into a canvas.
 *
 * The promise rejects when WebGL, the local runtime, or model assets are not
 * available. Callers should keep their fallback avatar visible until it settles.
 * draw() is intentionally synchronous so the existing 30fps controller can
 * drive it without awaiting a frame.
 */
export async function createLive2D(canvas, options = {}) {
  if (typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement)) {
    throw new TypeError('createLive2D expects a canvas');
  }
  const PIXI = await loadRuntime();
  const parent = canvas.parentElement;
  const width = Math.max(1, Math.round(canvas.clientWidth || parent?.clientWidth || 180));
  const height = Math.max(1, Math.round(canvas.clientHeight || parent?.clientHeight || 240));
  const app = new PIXI.Application({
    view: canvas,
    width,
    height,
    transparent: true,
    antialias: true,
    autoStart: true,
    resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  app.stop();
  app.renderer.resize(width, height);
  if (!app.renderer.gl) {
    app.destroy(false);
    throw new Error('Live2D requires WebGL on this device');
  }
  const model = await PIXI.live2d.Live2DModel.from(MODEL_ROOT, {
    autoInteract: false,
    autoUpdate: false,
  });
  app.stage.addChild(model);
  // Start one of Wanko's native idle clips; its built-in Cubism physics and
  // eye blink continue to run through the normal renderer update.
  model.motion?.('Idle', 0, PIXI.live2d.MotionPriority?.IDLE ?? 1);
  model.anchor?.set?.(0.5, 0.5);
  const fit = () => {
    const w = canvas.clientWidth || parent?.clientWidth || width;
    const h = canvas.clientHeight || parent?.clientHeight || height;
    app.renderer.resize(Math.max(1, w), Math.max(1, h));
    const bounds = model.getLocalBounds();
    const scale = Math.min((w * 0.94) / Math.max(bounds.width, 1), (h * 0.94) / Math.max(bounds.height, 1));
    model.scale.set(scale);
    model.position.set(w / 2, h / 2 + h * 0.04);
  };
  fit();
  const resizeObserver = typeof ResizeObserver === 'function' && parent
    ? new ResizeObserver(fit)
    : null;
  resizeObserver?.observe(parent);

  let previousAction = 'idle';
  let previousTime = 0;
  let disposed = false;
  const supportedActions = ['idle', 'tap'];
  const unsupportedActions = ['walk', 'run', 'turn', 'point', 'wave'];
  emitStatus(options, { state: 'ready', model: 'Wanko', supportedActions, unsupportedActions });

  const playTap = () => {
    try {
      const index = Math.floor(Math.random() * 2);
      model.motion?.('TapBody', index, PIXI.live2d.MotionPriority?.NORMAL ?? 2);
    } catch (error) {
      emitStatus(options, { state: 'motion-error', error });
    }
  };

  return {
    metadata: {
      id: 'live2d-wanko',
      name: 'Wanko · 官方 Live2D 小狗',
      source: 'Live2D CubismWebSamples / Wanko',
      sourceCommit: 'b1de66b0b1f1cb881d95fb6158622aeb6a2827bd',
      supportedActions,
      unsupportedActions,
      licensePath: './assets/avatars/live2d/LICENSE.md',
    },
    draw({ time = 0, action = 'idle', emotion = 'neutral', talk = false, listen = false } = {}) {
      if (disposed) return;
      const core = model.internalModel?.coreModel;
      const dt = previousTime ? Math.min(0.1, Math.max(0, time - previousTime)) : 1 / 30;
      previousTime = time;
      const tapRequested = action === 'tap';
      if (tapRequested && previousAction !== action) playTap();
      previousAction = action;
      // Wanko's actual parameter IDs come from Wanko.cdi3.json.
      setParameter(core, 'PARAM_MOUTH_OPEN_Y', talk ? 0.55 + Math.abs(Math.sin(time * 13)) * 0.45 : 0);
      setParameter(core, 'PARAM_MOUTH_FORM', emotion === 'happy' ? 0.8 : emotion === 'concerned' ? 0.25 : 0.2);
      setParameter(core, 'PARAM_TERE', emotion === 'happy' ? 0.55 : emotion === 'concerned' ? 0.2 : 0);
      setParameter(core, 'PARAM_ANGLE_X', listen ? Math.sin(time * 1.4) * 8 : Math.sin(time * 0.7) * 3);
      setParameter(core, 'PARAM_ANGLE_Z', listen ? 5 : Math.sin(time * 0.9) * 2);
      setParameter(core, 'PARAM_BREATH', Math.sin(time * 1.7) * 0.5 + 0.5);
      // Advance the Cubism model locally; no remote render or GPU service is used.
      // pixi-live2d-display measures `Live2DModel.update()` in milliseconds;
      // the host controller supplies seconds.
      model.update?.(dt * 1000);
      app.renderer.render(app.stage);
    },
    resize: fit,
    dispose() {
      disposed = true;
      resizeObserver?.disconnect();
      app.stage.removeChild(model);
      model.destroy?.({ children: true, texture: false, baseTexture: false });
      app.destroy(false);
    },
  };
}

export const live2dMetadata = {
  model: 'Wanko',
  source: 'Live2D CubismWebSamples',
  sourceCommit: 'b1de66b0b1f1cb881d95fb6158622aeb6a2827bd',
  licensePath: './assets/avatars/live2d/LICENSE.md',
};
