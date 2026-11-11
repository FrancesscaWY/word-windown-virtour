import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPanorama, normalizePanoramaView, projectPanoramaHotspot, PANORAMA_LIMITS } from '../src/components/panorama.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

test('panorama clamps zoom and pitch, wraps yaw and rejects non-finite angles', () => {
  const view = normalizePanoramaView({ yaw: Math.PI * 6 + 0.3, pitch: 10, fov: -10 });
  near(view.yaw, 0.3);
  assert.equal(view.pitch, PANORAMA_LIMITS.maxPitch);
  assert.equal(view.fov, PANORAMA_LIMITS.minFov);
  assert.equal(normalizePanoramaView({ fov: 500 }).fov, PANORAMA_LIMITS.maxFov);
  assert.deepEqual(normalizePanoramaView({ yaw: NaN, pitch: Infinity, fov: undefined }), { yaw: 0, pitch: 0.08, fov: 65 });
});

test('spherical hotspots track camera rotation and viewport aspect, hiding the back hemisphere', () => {
  const viewport = { width: 400, height: 800 };
  const camera = { yaw: 0.7, pitch: 0.2, fov: 65 };
  const center = projectPanoramaHotspot({ yaw: 0.7, pitch: 0.2 }, camera, viewport);
  assert.equal(center.visible, true);
  near(center.x, 200);
  near(center.y, 400);
  const right = projectPanoramaHotspot({ yaw: 0.9, pitch: 0.2 }, camera, viewport);
  assert.ok(right.x > center.x);
  const above = projectPanoramaHotspot({ yaw: 0.7, pitch: 0.4 }, camera, viewport);
  assert.ok(above.y < center.y);
  const behind = projectPanoramaHotspot({ yaw: 0.7 + Math.PI, pitch: -0.2 }, camera, viewport);
  assert.equal(behind.visible, false);
  assert.equal(behind.x, null);
  assert.equal(projectPanoramaHotspot({ yaw: 1.4, pitch: 0 }, { yaw: 0, pitch: 0, fov: 35 }, viewport).visible, false);
  assert.equal(projectPanoramaHotspot({ yaw: 0, pitch: 0 }, camera, { width: 0, height: 0 }).visible, false);
  assert.equal(projectPanoramaHotspot({ yaw: NaN, pitch: 0 }, camera, viewport).visible, false);
});

function fixture(t, supported = true) {
  const calls = [];
  const gl = new Proxy({ NO_ERROR: 0 }, {
    get(target, name) {
      if (name in target) return target[name];
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      return (...args) => {
        calls.push({ name, args });
        if (name.startsWith('create') || name === 'getUniformLocation') return {};
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return true;
        if (name === 'getError' || name === 'getAttribLocation') return 0;
      };
    },
  });
  class Canvas extends EventTarget {
    style = { touchAction: 'pan-y' };
    attributes = new Map();
    captures = new Set();
    getContext() { return supported ? gl : null; }
    getBoundingClientRect() { return { width: 400, height: 600 }; }
    hasAttribute(name) { return this.attributes.has(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    focus() {}
  }
  let image;
  let observer;
  class TestImage { constructor() { image = this; } }
  class TestResizeObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'Image', { configurable: true, writable: true, value: TestImage });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: TestResizeObserver });
  t.after(() => {
    if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage); else delete globalThis.Image;
    if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver); else delete globalThis.ResizeObserver;
  });
  const canvas = new Canvas();
  const statuses = [];
  const control = mountPanorama(canvas, '/test-sphere.png', (status, info) => statuses.push({ status, info }));
  t.after(control);
  return {
    canvas, control, statuses, calls,
    get image() { return image; },
    get observer() { return observer; },
    dispatch(type, properties = {}) {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, properties);
      canvas.dispatchEvent(event);
      return event;
    },
  };
}

test('touch drag, two-pointer pinch and keyboard controls share bounded view state', (t) => {
  const f = fixture(t);
  assert.equal(typeof f.control, 'function');
  assert.equal(f.statuses.at(-1).status, 'loading');
  f.image.onload();
  assert.equal(f.control.getView().ready, true);
  assert.ok(f.calls.some(call => call.name === 'drawArrays'));
  let updates = 0;
  f.control.setOnViewChange(() => updates++);
  f.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, pointerType: 'touch' });
  f.dispatch('pointermove', { pointerId: 1, clientX: 200, clientY: 130 });
  assert.ok(f.control.getView().yaw < 0);
  assert.ok(f.control.getView().pitch > 0.08);
  f.dispatch('pointerdown', { pointerId: 2, clientX: 300, clientY: 130, pointerType: 'touch' });
  f.dispatch('pointermove', { pointerId: 2, clientX: 400, clientY: 130 });
  assert.equal(f.control.getView().fov, PANORAMA_LIMITS.minFov);
  f.dispatch('pointerup', { pointerId: 2 });
  const before = f.control.getView().yaw;
  f.dispatch('pointermove', { pointerId: 1, clientX: 210, clientY: 130 });
  assert.ok(Math.abs(f.control.getView().yaw - before) < 0.02, 'one-finger drag resumes without a jump');
  f.dispatch('pointercancel', { pointerId: 1 });
  const released = f.control.getView();
  f.dispatch('pointermove', { pointerId: 1, clientX: 300, clientY: 300 });
  assert.deepEqual(f.control.getView(), released);
  assert.equal(f.dispatch('keydown', { key: 'Home' }).defaultPrevented, true);
  assert.equal(f.control.getView().yaw, 0);
  assert.equal(f.control.getView().fov, 65);
  f.dispatch('keydown', { key: '+' });
  assert.equal(f.control.getView().fov, 60);
  f.dispatch('wheel', { deltaY: 10000, deltaMode: 0 });
  assert.equal(f.control.getView().fov, PANORAMA_LIMITS.maxFov);
  const hotspot = f.control.projectHotspot({ yaw: 0, pitch: 0.08 });
  near(hotspot.x, 200);
  near(hotspot.y, 300);
  assert.ok(updates >= 6);
  f.observer.callback();
  assert.ok(updates >= 7);
});

test('lost WebGL contexts rebuild resources, and cleanup prevents stale callbacks and releases resources', (t) => {
  const f = fixture(t);
  f.image.onload();
  assert.equal(f.dispatch('webglcontextlost').defaultPrevented, true);
  assert.equal(f.statuses.at(-1).info.reason, 'webgl-context-lost');
  assert.equal(f.control.getView().ready, false);
  f.dispatch('webglcontextrestored');
  assert.equal(f.statuses.at(-1).status, 'ready');
  assert.equal(f.calls.filter(call => call.name === 'createProgram').length, 2);
  const lateImageCallback = f.image.onload;
  const updateCount = f.statuses.length;
  f.control();
  f.control();
  lateImageCallback();
  f.dispatch('webglcontextrestored');
  assert.equal(f.statuses.length, updateCount);
  assert.equal(f.calls.filter(call => call.name === 'deleteProgram').length, 1);
  assert.equal(f.control.getView().ready, false);
  assert.equal(f.observer.disconnected, true);
  assert.equal(f.canvas.style.touchAction, 'pan-y');
  assert.equal(f.canvas.hasAttribute('tabindex'), false);
});

test('image failure and absent WebGL produce explicit states with compatible cleanup APIs', (t) => {
  const f = fixture(t);
  f.image.onerror();
  assert.equal(f.statuses.at(-1).status, 'error');
  assert.equal(f.statuses.at(-1).info.reason, 'image-load-failed');
  assert.equal(f.control.getView().ready, false);
  const unsupported = fixture(t, false);
  assert.equal(unsupported.statuses.at(-1).status, 'unsupported');
  assert.equal(unsupported.control.zoomBy(-100).fov, PANORAMA_LIMITS.minFov);
  unsupported.control.reset();
  assert.equal(unsupported.control.getView().fov, 65);
});
