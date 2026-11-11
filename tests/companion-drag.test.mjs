import test from 'node:test';
import assert from 'node:assert/strict';
import { clampCompanionPosition, mountCompanionDrag } from '../src/components/companion-drag.js';

function dragHarness() {
  class Target {
    constructor() { this.listeners = new Map(); this.dataset = {}; this.style = { touchAction: 'manipulation' }; }
    addEventListener(type, callback, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), { callback, capture }]);
    }
    removeEventListener(type, callback, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item.callback !== callback || item.capture !== capture));
    }
    emit(type, data = {}) {
      const event = { type, target: this, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...data };
      const callbacks = [...(this.listeners.get(type) ?? [])].sort((a, b) => Number(b.capture) - Number(a.capture));
      for (const { callback } of callbacks) { callback(event); if (event.stopped) break; }
      return event;
    }
    listenerCount() { return [...this.listeners.values()].reduce((sum, items) => sum + items.length, 0); }
  }
  const element = new Target(); const view = new Target(); const captures = new Set();
  element.ownerDocument = { defaultView: view };
  element.setPointerCapture = id => captures.add(id);
  element.hasPointerCapture = id => captures.has(id);
  element.releasePointerCapture = id => { captures.delete(id); element.emit('lostpointercapture', { pointerId: id }); };
  const position = { x: 100, y: 120, bounds: { left: 10, right: 200, top: 20, bottom: 240 } };
  const moves = []; let placed = 0; let activated = 0;
  // Register activation first to verify the helper's capture handler wins regardless of registration order.
  element.addEventListener('click', () => { activated++; });
  const cleanup = mountCompanionDrag({ element, getPosition: () => position, onMove(next) { moves.push(next); Object.assign(position, next); }, onPlace() { placed++; } });
  const down = (data = {}) => element.emit('pointerdown', { pointerId: 1, button: 0, isPrimary: true, clientX: 50, clientY: 60, ...data });
  const move = (data = {}) => view.emit('pointermove', { pointerId: 1, clientX: 50, clientY: 60, ...data });
  const up = (data = {}) => view.emit('pointerup', { pointerId: 1, ...data });
  return { element, view, captures, position, moves, cleanup, down, move, up, get placed() { return placed; }, get activated() { return activated; } };
}

test('position clamp handles all edges and collapsed bounds without nonfinite output', () => {
  assert.deepEqual(clampCompanionPosition({ x: -50, y: 500 }, { left: 10, right: 200, top: 20, bottom: 240 }), { x: 10, y: 240 });
  assert.deepEqual(clampCompanionPosition({ x: 500, y: -50 }, { left: 10, right: 200, top: 20, bottom: 240 }), { x: 200, y: 20 });
  assert.deepEqual(clampCompanionPosition({ x: NaN, y: Infinity }, { left: 30, right: 20, top: 40, bottom: 10 }), { x: 30, y: 40 });
});

test('a tap and movement up to six pixels keep the normal replay click', () => {
  const harness = dragHarness();
  const down = harness.down();
  assert.equal(down.defaultPrevented, false);
  assert.equal(harness.captures.has(1), true);
  assert.equal(harness.move({ clientX: 56 }).defaultPrevented, false);
  harness.up();
  assert.deepEqual(harness.moves, []);
  assert.equal(harness.placed, 0);
  assert.equal(harness.captures.size, 0);
  assert.equal(harness.element.dataset.dragging, undefined);
  assert.equal(harness.element.emit('click', { detail: 1 }).defaultPrevented, false);
  assert.equal(harness.activated, 1);
  harness.cleanup();
});

test('drag movement uses the original position, clamps to current bounds, and suppresses its release click', () => {
  const harness = dragHarness();
  harness.down();
  assert.equal(harness.move({ clientX: 57 }).defaultPrevented, true);
  assert.deepEqual(harness.moves.at(-1), { x: 107, y: 120 });
  assert.equal(harness.element.dataset.dragging, 'true');
  harness.move({ clientX: 70, clientY: 80 });
  assert.deepEqual(harness.moves.at(-1), { x: 120, y: 140 });
  harness.position.bounds.right = 150;
  harness.move({ clientX: 500, clientY: -500 });
  assert.deepEqual(harness.moves.at(-1), { x: 150, y: 20 });
  harness.up();
  assert.equal(harness.placed, 1);
  assert.equal(harness.element.dataset.dragging, undefined);
  assert.equal(harness.element.emit('click', { detail: 1 }).defaultPrevented, true);
  assert.equal(harness.activated, 0);
  harness.down({ pointerId: 2 }); harness.up({ pointerId: 2 });
  assert.equal(harness.element.emit('click', { detail: 1 }).defaultPrevented, false);
  assert.equal(harness.activated, 1);
  harness.cleanup();
});

test('only the primary button and active pointer can move or end the character drag', () => {
  const harness = dragHarness();
  harness.down({ button: 2 }); harness.move({ clientX: 100 }); harness.up();
  harness.down({ pointerId: 2, isPrimary: false });
  assert.equal(harness.captures.size, 0);
  assert.deepEqual(harness.moves, []);
  harness.down();
  harness.down({ pointerId: 2 });
  harness.move({ pointerId: 2, clientX: 100 }); harness.up({ pointerId: 2 });
  assert.deepEqual(harness.moves, []);
  assert.equal(harness.captures.has(1), true);
  harness.move({ clientX: 60 }); harness.up();
  assert.deepEqual(harness.moves, [{ x: 110, y: 120 }]);
  assert.equal(harness.placed, 1);
  harness.cleanup();
});

test('pointer cancellation places a dragged character once and leaves no active capture', () => {
  const harness = dragHarness();
  harness.down(); harness.move({ clientX: -500, clientY: 500 });
  assert.deepEqual(harness.moves.at(-1), { x: 10, y: 240 });
  harness.view.emit('pointercancel', { pointerId: 1 });
  harness.up(); harness.move({ clientX: 80 });
  assert.equal(harness.placed, 1);
  assert.equal(harness.moves.length, 1);
  assert.equal(harness.captures.size, 0);
  assert.equal(harness.element.dataset.dragging, undefined);
  assert.equal(harness.element.emit('click', { detail: 1 }).defaultPrevented, true);
  harness.cleanup();
});

test('lost capture ends a real drag, but a child losing capture does not end it', () => {
  const harness = dragHarness();
  harness.down(); harness.move({ clientX: 60 });
  harness.element.emit('lostpointercapture', { pointerId: 1, target: {} });
  harness.move({ clientX: 70 });
  assert.equal(harness.moves.length, 2);
  harness.element.emit('lostpointercapture', { pointerId: 1 });
  harness.move({ clientX: 90 });
  assert.equal(harness.moves.length, 2);
  assert.equal(harness.placed, 1);
  assert.equal(harness.captures.size, 0);
  assert.equal(harness.element.dataset.dragging, undefined);
  harness.cleanup();
});

test('arrow keys place the character in 16 or 32 pixel steps and respect all bounds', () => {
  const harness = dragHarness();
  const key = (name, data = {}) => harness.element.emit('keydown', { key: name, ...data });
  assert.equal(key('ArrowRight').defaultPrevented, true);
  assert.deepEqual(harness.moves.at(-1), { x: 116, y: 120 });
  key('ArrowDown', { shiftKey: true });
  assert.deepEqual(harness.moves.at(-1), { x: 116, y: 152 });
  key('ArrowLeft'); key('ArrowUp', { shiftKey: true });
  assert.deepEqual(harness.moves.at(-1), { x: 100, y: 120 });
  Object.assign(harness.position, { x: 195, y: 235 });
  key('ArrowRight', { shiftKey: true }); key('ArrowDown');
  assert.deepEqual(harness.moves.at(-1), { x: 200, y: 240 });
  Object.assign(harness.position, { x: 15, y: 25 });
  key('ArrowLeft'); key('ArrowUp', { shiftKey: true });
  assert.deepEqual(harness.moves.at(-1), { x: 10, y: 20 });
  assert.equal(harness.placed, 8);
  assert.equal(key('Enter').defaultPrevented, false);
  assert.equal(key('ArrowLeft', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(harness.placed, 8);
  harness.cleanup();
});

test('keyboard replay stays available after a drag and cleanup removes only helper listeners', () => {
  const harness = dragHarness();
  harness.down(); harness.move({ clientX: 60 }); harness.up();
  assert.equal(harness.element.emit('click', { detail: 0 }).defaultPrevented, false);
  assert.equal(harness.activated, 1);
  harness.down({ pointerId: 2 }); harness.move({ pointerId: 2, clientX: 70 });
  assert.equal(harness.element.style.touchAction, 'none');
  harness.cleanup(); harness.cleanup();
  assert.equal(harness.placed, 1);
  assert.equal(harness.element.dataset.dragging, undefined);
  assert.equal(harness.captures.size, 0);
  assert.equal(harness.element.style.touchAction, 'manipulation');
  assert.equal(harness.element.listenerCount(), 1);
  assert.equal(harness.view.listenerCount(), 0);
  const count = harness.moves.length;
  harness.move({ pointerId: 2, clientX: 100 }); harness.up({ pointerId: 2 });
  harness.element.emit('keydown', { key: 'ArrowLeft' });
  assert.equal(harness.moves.length, count);
  harness.element.emit('click', { detail: 1 });
  assert.equal(harness.activated, 2);
});
