import test from 'node:test';
import assert from 'node:assert/strict';
import { clampMapTransform, zoomMapAt, pinchMapTransform, MAP_LIMITS } from '../src/components/map-controller.js';
import { pois } from '../src/data/pois.js';
import { externalAssets } from '../src/data/external-assets.js';
import { mapMarkup, mountMap } from '../src/components/map.js';

test('zoom and pan cannot uncover the map edges', () => {
  assert.deepEqual(clampMapTransform({ scale: 2, x: 900, y: -900 }, 400, 300), { scale: 2, x: 200, y: -150 });
  assert.deepEqual(clampMapTransform({ scale: 0.1, x: 10, y: -10 }, 400, 300), { scale: 1, x: 0, y: 0 });
  assert.equal(clampMapTransform({ scale: 100, x: 0, y: 0 }, 400, 300).scale, 5.5);
});

test('zoom preserves the cursor anchor until a viewport edge is reached', () => {
  const before = { scale: 2, x: 30, y: -20 };
  const after = zoomMapAt(before, 1.25, 70, 40, 400, 300);
  assert.equal((70 - before.x) / before.scale, (70 - after.x) / after.scale);
  assert.equal((40 - before.y) / before.scale, (40 - after.y) / after.scale);
  assert.deepEqual(zoomMapAt(before, 0.01, 70, 40, 400, 300), { scale: 1, x: 0, y: 0 });
});

test('pinch combines two-finger scaling with midpoint panning', () => {
  const start = [{ x: 150, y: 150 }, { x: 250, y: 150 }];
  const current = [{ x: 120, y: 170 }, { x: 320, y: 170 }];
  assert.deepEqual(pinchMapTransform({ scale: 1, x: 0, y: 0 }, start, current, { left: 0, top: 0 }, 400, 300), { scale: 2, x: 20, y: 20 });
});

test('pinch preserves its anchor when scaling and moving back from a map edge', () => {
  const state = { scale: 3, x: 400, y: 0 };
  const start = [{ x: 50, y: 150 }, { x: 150, y: 150 }];
  const current = [{ x: -100 / 3, y: 150 }, { x: 100 / 3, y: 150 }];
  const after = pinchMapTransform(state, start, current, { left: 0, top: 0 }, 400, 300);
  assert.equal(after.scale, 2);
  assert.ok(Math.abs(after.x - 400 / 3) < 1e-8);
  // Compare the map coordinate under the initial and final finger midpoint.
  assert.ok(Math.abs((100 - 200 - state.x) / state.scale - (0 - 200 - after.x) / after.scale) < 1e-8);
  assert.equal(after.y, 0);
});

test('pinch still respects minimum and maximum zoom and viewport coverage', () => {
  const start = [{ x: 150, y: 150 }, { x: 250, y: 150 }];
  const rect = { left: 0, top: 0 };
  const large = pinchMapTransform({ scale: 2, x: 0, y: 0 }, start, [{ x: 300, y: 500 }, { x: 1300, y: 500 }], rect, 400, 300);
  assert.equal(large.scale, 5.5);
  assert.equal(large.x, 600); assert.equal(large.y, 350);
  const small = pinchMapTransform({ scale: 2, x: 150, y: -100 }, start, [{ x: 100, y: 100 }, { x: 101, y: 100 }], rect, 400, 300);
  assert.deepEqual(small, { scale: 1, x: 0, y: 0 });
});

test('coincident touches and zero-size viewport remain finite', () => {
  const point = [{ x: 100, y: 100 }, { x: 100, y: 100 }];
  assert.deepEqual(pinchMapTransform({ scale: 1, x: 0, y: 0 }, point, point, { left: 0, top: 0 }, 0, 0), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(clampMapTransform({ scale: NaN, x: Infinity, y: NaN }, 0, 0), { scale: 1, x: 0, y: 0 });
});

test('all POIs and accessible controls remain in native markup', () => {
  const markup = mapMarkup();
  for (const id of ['eiffel', 'arc', 'pyramid']) assert.ok(markup.includes(`data-poi="${id}"`));
  for (const action of ['zoom-in', 'zoom-out', 'reset']) assert.ok(markup.includes(`data-map-action="${action}"`));
  assert.ok(markup.includes('tabindex="0"'));
  assert.ok(markup.includes('非实时导航'));
  assert.equal((markup.match(/class="map-poi-pin" aria-hidden="true"><svg class="landmark /g) ?? []).length, pois.filter(p => p.position).length);
  assert.ok(markup.includes('class="map-zoom"'));
  assert.ok(markup.includes('id="map-help" class="sr-only"'));
  assert.equal((markup.match(/data-map-view="relief"/g) ?? []).length, 1);
  assert.ok(!markup.includes('map-view-toggle'));
  assert.ok(!markup.includes('data-map-preview'));
  assert.ok(!markup.includes('map-photo-preview'));
  assert.ok(markup.includes(externalAssets.map ? '© OpenStreetMap' : 'class="map-caption">示意地图</span>'));
  if (externalAssets.map) assert.ok(markup.includes(externalAssets.map.file));
  assert.ok(!markup.includes('演示起点'));
});

// A minimal event harness exercises the controller, without copying its math.
function mapHarness() {
  class Node {
    constructor() { this.listeners = new Map(); this.style = { setProperty(key, value) { this[key] = value; } }; this.dataset = {}; this.classes = new Set(); this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name) }; }
    addEventListener(name, callback) { const callbacks = this.listeners.get(name) || []; callbacks.push(callback); this.listeners.set(name, callbacks); }
    removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== callback)); }
    emit(name, data = {}) {
      const event = { type: name, target: this, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...data };
      for (const callback of this.listeners.get(name) || []) { callback(event); if (event.stopped) break; }
      return event;
    }
    closest() { return null; }
    querySelectorAll() { return []; }
  }
  const view = new Node(); const viewport = new Node(); const art = new Node(); const controls = new Node(); const output = new Node();
  let resizeCallback = null;
  view.ResizeObserver = class {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    disconnect() { resizeCallback = null; }
  };
  const zoomIn = new Node(); const zoomOut = new Node(); const reset = new Node(); const poi = new Node();
  const nodes = { '.map-art': art, '.map-controls': controls, '.map-zoom': output, '[data-map-action="zoom-in"]': zoomIn, '[data-map-action="zoom-out"]': zoomOut };
  viewport.clientWidth = 400; viewport.clientHeight = 300; viewport.ownerDocument = { defaultView: view };
  viewport.matches = (selector) => selector === '.map-viewport'; viewport.querySelector = (selector) => nodes[selector];
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
  viewport.style.touchAction = 'pan-y'; art.style.transform = ''; art.style.transformOrigin = '';
  const captures = new Set(); viewport.setPointerCapture = (id) => captures.add(id); viewport.hasPointerCapture = (id) => captures.has(id); viewport.releasePointerCapture = (id) => captures.delete(id);
  viewport.contains = (node) => node === poi;
  poi.dataset.poi = 'eiffel'; poi.closest = (selector) => selector === 'button[data-poi]' ? poi : null;
  for (const [button, action] of [[zoomIn, 'zoom-in'], [zoomOut, 'zoom-out'], [reset, 'reset']]) {
    button.dataset.mapAction = action;
    button.closest = (selector) => selector.startsWith('.map-controls') ? controls : selector === '[data-map-action]' ? button : null;
  }
  return { view, viewport, art, controls, output, zoomIn, zoomOut, reset, poi, resize: () => resizeCallback?.(), nodes: [view, viewport, controls] };
}

test('drag suppresses its accidental click; a new tap and keyboard activation still select', () => {
  const harness = mapHarness(); const selected = [];
  const { view, viewport, art, poi } = harness;
  const cleanup = mountMap(viewport, { onSelect: (id) => selected.push(id) });
  viewport.emit('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 150, target: poi });
  view.emit('pointermove', { pointerId: 1, clientX: 220, clientY: 150 });
  view.emit('pointerup', { pointerId: 1 });
  assert.notEqual(art.style.transform, 'translate(0px, 0px) scale(1.3)');
  assert.equal(viewport.emit('click', { target: poi, detail: 1 }).defaultPrevented, true);
  assert.deepEqual(selected, []);
  viewport.emit('click', { target: poi, detail: 0 });
  assert.deepEqual(selected, ['eiffel']);
  viewport.emit('pointerdown', { pointerId: 2, button: 0, clientX: 200, clientY: 150, target: poi });
  view.emit('pointerup', { pointerId: 2 });
  viewport.emit('click', { target: poi, detail: 1 });
  assert.deepEqual(selected, ['eiffel', 'eiffel']);
  cleanup(); cleanup();
  assert.equal(art.style.transform, ''); assert.equal(viewport.style.touchAction, 'pan-y');
  assert.equal(harness.nodes.reduce((count, node) => count + [...node.listeners.values()].flat().length, 0), 0);
  cleanup.focusPoi('arc'); cleanup.reset(); assert.equal(art.style.transform, '');
});

test('control buttons clamp zoom, reset, and remove listeners on disposal', () => {
  const { viewport, controls, output, zoomIn, zoomOut, reset } = mapHarness();
  const cleanup = mountMap(viewport);
  for (let count = 0; count < 30; count += 1) controls.emit('click', { target: zoomIn });
  assert.equal(output.textContent, '550%'); assert.equal(zoomIn.disabled, true);
  for (let count = 0; count < 30; count += 1) controls.emit('click', { target: zoomOut });
  assert.equal(output.textContent, '100%'); assert.equal(zoomOut.disabled, true);
  controls.emit('click', { target: reset }); assert.equal(output.textContent, '100%');
  cleanup(); controls.emit('click', { target: zoomIn }); assert.equal(output.textContent, '100%');
});

test('hiding a map preserves its pan; restoring only clamps to the actual visible size', () => {
  const { viewport, art, resize } = mapHarness();
  const cleanup = mountMap(viewport);
  cleanup.focusPoi('pyramid');
  const before = art.style.transform;
  assert.ok(!before.startsWith('translate(0px, 0px)'));
  viewport.clientWidth = 0; viewport.clientHeight = 0; resize();
  assert.equal(art.style.transform, before);
  viewport.clientWidth = 400; viewport.clientHeight = 300; resize();
  assert.equal(art.style.transform, before);
  // If the device layout changed while hidden, the restored viewport gets its
  // real bounds instead of either keeping invalid bounds or centering the map.
  viewport.clientWidth = 0; viewport.clientHeight = 0; resize();
  viewport.clientWidth = 200; viewport.clientHeight = 150; resize();
  const values = art.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/).slice(1).map(Number);
  const oldValues = before.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).slice(1).map(Number);
  const xLimit = Math.max(0,(parseFloat(art.style.width)*1.6-200)/2);
  const yLimit = Math.max(0,(parseFloat(art.style.height)*1.6-150)/2);
  assert.ok(Math.abs(values[0] - Math.max(-xLimit, Math.min(xLimit, oldValues[0]))) < 1e-8);
  assert.ok(Math.abs(values[1] - Math.max(-yLimit, Math.min(yLimit, oldValues[1]))) < 1e-8);
  assert.equal(values[2], 1.6);
  cleanup();
});

test('a child losing pointer capture does not end the viewport drag', () => {
  const { viewport, view, art, poi } = mapHarness();
  const cleanup = mountMap(viewport);
  viewport.emit('keydown', { key: '+' });
  viewport.emit('keydown', { key: '+' });
  viewport.emit('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 150, target: poi });
  view.emit('pointermove', { pointerId: 1, clientX: 210, clientY: 150 });
  assert.equal(art.style.transform, 'translate(10px, 0px) scale(1.6900000000000002)');
  viewport.emit('lostpointercapture', { pointerId: 1, target: poi });
  view.emit('pointermove', { pointerId: 1, clientX: 220, clientY: 150 });
  assert.equal(art.style.transform, 'translate(20px, 0px) scale(1.6900000000000002)');
  // Losing the viewport's own capture must still end the gesture.
  viewport.emit('lostpointercapture', { pointerId: 1, target: viewport });
  view.emit('pointermove', { pointerId: 1, clientX: 225, clientY: 150 });
  assert.equal(art.style.transform, 'translate(20px, 0px) scale(1.6900000000000002)');
  cleanup();
});

test('portrait geometry clamps to the real artwork bounds and keeps zoom anchors stable', () => {
  const state={scale:1,x:0,y:0};
  const moved=clampMapTransform({...state,x:999,y:999},360,600,MAP_LIMITS,624,600);
  assert.deepEqual(moved,{scale:1,x:132,y:0});
  const zoomed=zoomMapAt(state,2,70,40,360,600,624,600);
  assert.equal((70-zoomed.x)/zoomed.scale,70);
  assert.equal((40-zoomed.y)/zoomed.scale,40);
});
