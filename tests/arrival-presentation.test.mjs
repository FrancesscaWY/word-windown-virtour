import test from 'node:test';
import assert from 'node:assert/strict';
import { isArrivalNavigation, mountPageTransitions, mountCardDepth } from '../src/arrival/presentation.js';

function surface() {
  const listeners = new Map(), classes = new Set(), styles = new Map();
  return {
    listeners, classes, styles,
    classList:{ add:name => classes.add(name), remove:name => classes.delete(name), contains:name => classes.has(name) },
    style:{ setProperty:(key, value) => styles.set(key, value), removeProperty:key => styles.delete(key) },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); if (!listeners.get(type)?.size) listeners.delete(type); },
    emit(type, event = {}) { for (const fn of listeners.get(type) || []) fn(event); },
  };
}
function fixture({ reduce = false } = {}) {
  const root = surface(), host = surface(), timers = new Map(), navigations = [];
  let id = 0;
  Object.assign(host, {
    location:{ href:'http://localhost/index.html' },
    matchMedia:query => ({ matches:query.includes('reduced-motion') ? reduce : true }),
    setTimeout:fn => { timers.set(++id, fn); return id; }, clearTimeout:key => timers.delete(key),
    requestAnimationFrame:fn => { timers.set(++id, fn); return id; }, cancelAnimationFrame:key => timers.delete(key),
  });
  const flush = () => { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); };
  const link = Object.assign(surface(), { href:'http://localhost/modes.html', target:'', hasAttribute:() => false });
  const click = (patch = {}) => {
    const event = { button:0, target:{ closest:() => link }, preventDefault() { this.defaultPrevented = true; }, ...patch };
    root.emit('click', event); return event;
  };
  return { root, host, timers, navigations, flush, link, click, options:{ host, navigate:href => navigations.push(href) } };
}

test('animation enhancement preserves native new tabs, downloads, fragments and external links', () => {
  const f = fixture();
  const valid = { button:0 };
  assert.equal(isArrivalNavigation(valid, f.link, f.host.location.href), true);
  for (const event of [{ ctrlKey:true }, { metaKey:true }, { shiftKey:true }, { altKey:true }, { button:1 }, { defaultPrevented:true }]) {
    assert.equal(isArrivalNavigation({ ...valid, ...event }, f.link, f.host.location.href), false);
  }
  for (const patch of [
    { target:'_blank' }, { hasAttribute:() => true }, { href:'https://example.com/' },
    { href:'javascript:alert(1)' }, { href:'http://localhost/index.html#section' },
  ]) assert.equal(isArrivalNavigation(valid, { ...f.link, ...patch }, f.host.location.href), false);
  const transitions = mountPageTransitions(f.root, f.options);
  assert.equal(f.click({ ctrlKey:true }).defaultPrevented, undefined);
  assert.equal(f.timers.size, 0);
  transitions.dispose();
});

test('click and swipe share one exit; restoring, hiding and disposing clear pending navigation', () => {
  const f = fixture();
  const transitions = mountPageTransitions(f.root, f.options);
  f.link.classList.add('arrival-mode-card');
  assert.equal(f.click().defaultPrevented, true);
  f.click();
  assert.equal(transitions.go('/other'), false);
  assert.equal(f.timers.size, 1);
  assert.ok(f.root.classes.has('is-leaving'));
  assert.ok(f.link.classes.has('is-selected'));
  f.flush();
  assert.deepEqual(f.navigations, [f.link.href]);
  f.host.emit('pageshow', { persisted:true });
  assert.equal(f.root.classes.has('is-leaving'), false);
  assert.equal(f.link.classes.has('is-selected'), false);
  f.click(); f.host.emit('pagehide', { persisted:true }); f.flush();
  assert.equal(f.navigations.length, 1);
  assert.equal(transitions.go('/again'), true);
  transitions.dispose(); f.flush();
  assert.equal(f.navigations.length, 1);
  assert.equal(transitions.go('/disposed'), false);
  assert.equal(f.root.listeners.size + f.host.listeners.size, 0);
});

test('reduced motion navigates immediately and a failed navigation restores a usable page', () => {
  const f = fixture({ reduce:true });
  const transitions = mountPageTransitions(f.root, f.options);
  f.click();
  assert.deepEqual(f.navigations, [f.link.href]);
  assert.equal(f.timers.size, 0);
  assert.equal(f.root.classes.has('is-leaving'), false);
  transitions.dispose();
  const failing = mountPageTransitions(f.root, { host:f.host, navigate:() => { throw new Error('unavailable'); } });
  assert.throws(() => failing.go('/failure'), /unavailable/);
  assert.throws(() => failing.go('/retry'), /unavailable/);
  failing.dispose();
});

test('card depth batches mouse movement, bounds tilt, ignores touch and cancels pending frames', () => {
  const f = fixture(), card = surface();
  card.getBoundingClientRect = () => ({ left:0, top:0, width:200, height:300 });
  const dispose = mountCardDepth([card], f.host);
  card.emit('pointermove', { pointerType:'touch', clientX:20, clientY:30 });
  assert.equal(f.timers.size, 0);
  for (let i = 0; i < 8; i++) card.emit('pointermove', { pointerType:'mouse', clientX:1000, clientY:-100 });
  assert.equal(f.timers.size, 1);
  f.flush();
  assert.equal(card.styles.get('--tilt-x'), '2.50deg');
  assert.equal(card.styles.get('--tilt-y'), '2.50deg');
  card.emit('pointerleave');
  assert.equal(card.styles.size, 0);
  card.emit('pointermove', { pointerType:'mouse', clientX:10, clientY:30 });
  dispose(); f.flush();
  assert.equal(card.styles.size + f.timers.size + card.listeners.size + f.host.listeners.size, 0);
  const reduced = fixture({ reduce:true });
  const disposeReduced = mountCardDepth([card], reduced.host);
  card.emit('pointermove', { pointerType:'mouse', clientX:10, clientY:30 });
  assert.equal(reduced.timers.size, 0);
  disposeReduced();
});
