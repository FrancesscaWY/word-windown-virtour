import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/guide/store.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { mountViewport } from '../src/components/viewport.js';
import { panoramaHotspots } from '../src/data/pois.js';

const detailId = panoramaHotspots.eiffel?.[0]?.id ?? null;

test('map → panorama → configured detail → map keeps selection and visitor origin', () => {
  const store = createStore(); let cancellations = 0;
  const actions = createTourActions(store, () => { cancellations += 1; });
  assert.equal(actions.enterPanorama('eiffel'), true);
  assert.equal(store.get().view, 'panorama');
  assert.equal(actions.showDetails(detailId), true);
  assert.equal(store.get().activeHotspotId, detailId);
  assert.equal(store.get().detailsOpen, false);
  actions.closeDetails(); assert.equal(store.get().view, 'panorama');
  actions.showMap(); assert.equal(store.get().view, 'map');
  assert.equal(store.get().selectedPoiId, 'eiffel');
  assert.equal(store.get().visitorOrigin, null);
  assert.equal(cancellations, 2);
});

test('missing panorama stays on the map without a detail page; invalid targets do not mutate state', () => {
  const store = createStore(); const actions = createTourActions(store);
  assert.equal(actions.enterPanorama('taj'), false);
  assert.equal(store.get().view, 'map'); assert.equal(store.get().detailsOpen, false);
  const snapshot = { ...store.get() };
  assert.equal(actions.enterPanorama('unknown'), false);
  assert.equal(actions.selectPoi('unknown'), false);
  assert.equal(actions.showDetails(detailId ?? 'unknown-hotspot'), false);
  assert.deepEqual(store.get(), snapshot);
});

test('changing points closes stale panorama and details while keeping physical position', () => {
  const store = createStore(); let cancellations = 0;
  const actions = createTourActions(store, () => { cancellations += 1; });
  actions.enterPanorama();
  assert.equal(actions.showDetails(detailId), true);
  assert.equal(store.get().detailsOpen, false);
  assert.equal(store.get().activeHotspotId, detailId);
  actions.selectPoi('pyramid');
  assert.equal(store.get().view, 'map'); assert.equal(store.get().detailsOpen, false);
  assert.equal(store.get().activeHotspotId, null); assert.equal(store.get().selectedPoiId, 'pyramid');
  assert.equal(store.get().visitorOrigin, null); assert.equal(cancellations, 2);
});

test('visible viewport shrinks for keyboard, recovers, and disconnects cleanly', () => {
  const scope = new EventTarget(); const visual = new EventTarget();
  Object.assign(scope, { innerHeight: 844, visualViewport: visual });
  Object.assign(visual, { height: 844, offsetTop: 0 });
  const values = new Map();
  const root = { dataset: {}, style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) } };
  const cleanup = mountViewport(root, scope);
  assert.equal(values.get('--viewport-height'), '844px');
  Object.assign(visual, { height: 360, offsetTop: 20 }); visual.dispatchEvent(new Event('resize'));
  assert.equal(values.get('--viewport-height'), '360px'); assert.equal(values.get('--viewport-top'), '20px');
  assert.equal(root.dataset.compact, 'true');
  visual.height = 260; visual.dispatchEvent(new Event('resize'));
  assert.equal(root.dataset.constrained, 'true');
  Object.assign(visual, { height: 844, offsetTop: 0 }); scope.dispatchEvent(new Event('focusout'));
  assert.equal(values.get('--viewport-height'), '844px'); assert.equal(root.dataset.compact, 'false');
  assert.equal(root.dataset.constrained, 'false');
  cleanup(); visual.height = 200; visual.dispatchEvent(new Event('resize'));
  assert.equal(values.size, 0); assert.equal(root.dataset.compact, undefined);
  assert.equal(root.dataset.constrained, undefined);
});
