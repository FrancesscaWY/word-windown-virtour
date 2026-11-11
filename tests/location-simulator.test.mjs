import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSimulator } from '../src/components/location-simulator.js';
import { getPoi } from '../src/data/pois.js';
import { toCoordinates, distanceMeters } from '../src/guide/location.js';

function fixture() {
  let time = 0, next = 0;
  const timers = new Map(), positions = [], sources = [], listeners = new Map(), attributes = new Map();
  const button = { addEventListener:(type, fn) => listeners.set(type, fn), removeEventListener:type => listeners.delete(type), setAttribute:(name, value) => attributes.set(name, value) };
  const container = { hidden:true, querySelector:selector => selector === '[data-companion-toggle]' ? button : null };
  const scope = { Date:{ now:() => time }, setInterval:fn => { timers.set(++next, fn); return next; }, clearInterval:id => timers.delete(id) };
  const simulator = mountSimulator({ container, scope, onPosition:(point, source) => positions.push({ ...point, source }), onSource:source => sources.push(source), onToggleCompanion() {} });
  const advance = ms => { time += ms; for (const tick of [...timers.values()]) tick(); };
  return { simulator, container, timers, positions, sources, listeners, attributes, advance };
}

test('companion starts one local simulated route automatically and pauses without losing its position', () => {
  const f = fixture();
  assert.equal(f.timers.size, 0);
  f.simulator.setActive(true);
  assert.equal(f.container.hidden, false);
  assert.deepEqual(f.sources, ['simulated']);
  assert.equal(f.positions.at(-1).source, '模拟定位');
  assert.equal(distanceMeters(f.positions.at(-1), toCoordinates(getPoi('liberty').position)), 0);
  assert.equal(f.timers.size, 1);
  f.simulator.setActive(true);
  assert.equal(f.positions.length, 1, 'repeated activation cannot reset the route');
  f.advance(250);
  assert.ok(distanceMeters(f.positions[0], f.positions.at(-1)) > 1);
  const paused = f.positions.at(-1), count = f.positions.length;
  f.simulator.setPaused(true); f.advance(30000);
  assert.equal(f.timers.size, 0); assert.equal(f.positions.length, count);
  assert.equal(f.attributes.get('aria-label'), '恢复伴游');
  f.simulator.setPaused(false); f.advance(250);
  assert.ok(distanceMeters(paused, f.positions.at(-1)) > 1);
  assert.ok(distanceMeters(paused, f.positions.at(-1)) < 2, 'resume does not fast-forward across the paused time');
  f.simulator.setActive(false); f.advance(1000);
  assert.equal(f.container.hidden, true); assert.equal(f.timers.size, 0);
  f.simulator.dispose(); assert.equal(f.listeners.size, 0);
});

test('throttled tabs keep simulated steps bounded and disposal cancels future position updates', () => {
  const f = fixture(); f.simulator.setActive(true);
  const first = f.positions.at(-1); f.advance(60000);
  assert.ok(distanceMeters(first, f.positions.at(-1)) <= 7.01);
  const count = f.positions.length;
  f.simulator.dispose(); f.simulator.dispose(); f.advance(1000);
  assert.equal(f.positions.length, count); assert.equal(f.timers.size, 0);
});

test('the route finishes at its last landmark without an out-of-range segment or a running timer', () => {
  const f = fixture(); f.simulator.setActive(true);
  for (let step = 0; step < 2000 && f.timers.size; step++) f.advance(1000);
  assert.equal(f.timers.size, 0);
  assert.ok(f.positions.every(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)));
  assert.ok(distanceMeters(f.positions.at(-1), toCoordinates(getPoi('sydney').position)) < .001);
  f.simulator.dispose();
});
