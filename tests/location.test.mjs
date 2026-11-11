import test from 'node:test';
import assert from 'node:assert/strict';
import { createArrivalTracker, toCoordinates, toMapPosition, nearestPoi, distanceMeters } from '../src/guide/location.js';
import { getPoi } from '../src/data/pois.js';
import { createStore } from '../src/guide/store.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { createGuideController } from '../src/guide/controller.js';

test('simulated coordinates round trip through the geographic map and find the correct POI',()=>{
  const poi=getPoi('eiffel'), coordinates=toCoordinates(poi.position);
  const point=toMapPosition(coordinates);
  assert.ok(Math.abs(point.x-poi.position.x)<0.000001);
  assert.ok(Math.abs(point.y-poi.position.y)<0.000001);
  assert.equal(nearestPoi(coordinates).poi.id,'eiffel');
  assert.equal(distanceMeters(coordinates,coordinates),0);
});

test('arrival triggers once within 35m and rearms only after leaving 65m',()=>{
  const calls=[],tracker=createArrivalTracker(p=>calls.push(p.id));
  const point=toCoordinates(getPoi('eiffel').position);
  tracker.update(point); tracker.update(point);
  tracker.update({...point,latitude:point.latitude+0.0004});
  tracker.update(point);
  assert.deepEqual(calls,['eiffel']);
  tracker.update({latitude:0,longitude:0});tracker.update(point);
  assert.deepEqual(calls,['eiffel','eiffel']);
  tracker.reset();tracker.update(point);
  assert.equal(calls.length,3);
});

test('arrival narration plays without a loaded scene and a new arrival cancels the previous story',()=>{
  const store=createStore({tourMode:'companion'}),calls=[];
  let stops=0;
  const speech={stop(){stops++;},speak(text){calls.push(text);return new Promise(()=>{});}};
  const guide=createGuideController({store,actions:createTourActions(store),speech});
  guide.narrateLocation('eiffel');
  assert.equal(store.get().view,'map');
  assert.equal(store.get().pendingNarration,null);
  assert.match(calls[0],/埃菲尔铁塔/);
  guide.narrateLocation('pyramid');
  assert.equal(calls.length,2);assert.equal(stops,2);
  assert.equal(store.get().selectedPoiId,'pyramid');
  store.set({ companionPaused: true });
  assert.equal(guide.narrateLocation('eiffel'),false);
  assert.equal(calls.length,2);
  store.set({ companionPaused: false });
  guide.narrateLocation('eiffel');
  assert.equal(calls.length,3);
  guide.dispose();
});
