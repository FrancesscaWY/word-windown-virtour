import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceCompanionMotion, companionSize } from '../src/components/companion-motion.js';

const initial = { x: 100, target: 100, bounds: { left: 10, right: 300 }, action: 'walk', roaming: false, placed: true, dt: 1 / 30, height: 180 };

test('a selected walk or run moves a manually placed guide with automatic roaming off', () => {
  for (const action of ['walk', 'run']) {
    const frame = advanceCompanionMotion({ ...initial, action });
    assert.ok(frame.x > initial.x);
    assert.equal(frame.target, 300);
    assert.equal(frame.walk, true);
    assert.equal(frame.run, action === 'run');
    assert.equal(frame.action, action);
    assert.equal(frame.direction, 1);
    assert.equal(frame.distance, frame.x - initial.x);
  }
});

test('a manual patrol turns at both edges without teleporting or walking in place', () => {
  let frame = advanceCompanionMotion({ ...initial, x: 299.5, target: 300 });
  assert.equal(frame.target, 10);
  assert.equal(frame.direction, -1);
  assert.ok(frame.x < 299.5 && frame.x > 290);
  frame = advanceCompanionMotion({ ...initial, x: 10, target: 10 });
  assert.equal(frame.target, 300);
  assert.equal(frame.direction, 1);
  assert.ok(frame.x > 10 && frame.x < 20);
});

test('repeated patrol frames move across the stage and keep every animated step inside bounds', () => {
  let x = initial.x; let target = initial.target; let reversals = 0; let direction = 0;
  const visited = [];
  for (let index = 0; index < 1400; index++) {
    const frame = advanceCompanionMotion({ ...initial, x, target });
    assert.ok(frame.x >= 10 && frame.x <= 300);
    assert.equal(frame.walk, frame.distance > .001);
    assert.ok(Math.abs(frame.x - x) <= 70 / 30 + .001);
    if (direction && direction !== frame.direction) reversals++;
    direction = frame.direction; ({ x, target } = frame); visited.push(x);
  }
  assert.ok(reversals >= 5);
  assert.ok(Math.min(...visited) <= 12 && Math.max(...visited) >= 298);
});

test('automatic docking moves only when roaming is enabled and the guide was not manually placed', () => {
  for (const roaming of [false, true]) for (const placed of [false, true]) {
    const frame = advanceCompanionMotion({ ...initial, action: 'idle', target: 300, roaming, placed });
    assert.equal(frame.moving, roaming && !placed);
    assert.equal(frame.walk, frame.moving);
    assert.equal(frame.run, false);
    assert.equal(frame.action, 'idle');
  }
  const arrived = advanceCompanionMotion({ ...initial, action: 'idle', x: 300, target: 300, roaming: true, placed: false });
  assert.equal(arrived.x, 300);
  assert.equal(arrived.walk, false);
});

test('dragging, hidden/details suspension, reduced motion and zero time never request a stationary gait', () => {
  for (const action of ['walk', 'run']) {
    for (const suspension of [{ blocked: true }, { reduced: true }, { dt: 0 }, { dt: NaN }, { dt: -1 }]) {
      const frame = advanceCompanionMotion({ ...initial, action, ...suspension });
      assert.equal(frame.x, initial.x);
      assert.equal(frame.moving, false);
      assert.equal(frame.walk, false);
      assert.equal(frame.run, false);
      assert.equal(frame.action, 'idle');
    }
  }
});

test('collapsed bounds suppress locomotion and resumed frames cap elapsed time to avoid jumps', () => {
  const collapsed = advanceCompanionMotion({ ...initial, bounds: { left: 40, right: 30 } });
  assert.equal(collapsed.x, 40);
  assert.equal(collapsed.target, 40);
  assert.equal(collapsed.action, 'idle');
  assert.equal(collapsed.walk, false);
  const resumed = advanceCompanionMotion({ ...initial, dt: 900 });
  const limited = advanceCompanionMotion({ ...initial, dt: .1 });
  assert.deepEqual(resumed, limited);
});

test('run moves faster than walk and both speeds adapt to the rendered character height', () => {
  const walking = advanceCompanionMotion(initial);
  const running = advanceCompanionMotion({ ...initial, action: 'run' });
  const small = advanceCompanionMotion({ ...initial, height: 100 });
  assert.ok(Math.abs(running.distance / walking.distance - 1.7) < 1e-9);
  assert.ok(small.distance < walking.distance);
});

test('character height follows the viewport and caps at 210 pixels while preserving a 3:4 surface', () => {
  const normal = companionSize({ viewportHeight: 800, stageWidth: 1000, availableHeight: 600 });
  assert.equal(normal.height, 176);
  assert.equal(normal.width, 132);
  const tall = companionSize({ viewportHeight: 1440, stageWidth: 1000, availableHeight: 1100 });
  assert.equal(tall.height, 210);
  const short = companionSize({ viewportHeight: 420, stageWidth: 320, availableHeight: 300 });
  assert.equal(short.height, 100);
  const mobile = companionSize({ viewportHeight: 844, stageWidth: 366, availableHeight: 490 });
  assert.ok(mobile.height < 190 && mobile.width < 143);
});

test('limited stage space further shrinks the character without covering controls or producing invalid sizes', () => {
  const shortStage = companionSize({ viewportHeight: 844, stageWidth: 366, availableHeight: 180 });
  assert.ok(shortStage.height <= 180 * .58);
  const narrow = companionSize({ viewportHeight: 800, stageWidth: 90, availableHeight: 600 });
  assert.ok(narrow.width <= 66);
  for (const values of [
    { viewportHeight: NaN, stageWidth: NaN, availableHeight: NaN },
    { viewportHeight: 800, stageWidth: 0, availableHeight: -100 },
  ]) {
    const size = companionSize(values);
    assert.deepEqual(size, { width: 0, height: 0 });
  }
});
