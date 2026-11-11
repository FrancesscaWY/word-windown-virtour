import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createStore } from '../src/guide/store.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { createGuideController } from '../src/guide/controller.js';
import { resolveLocalIntent } from '../src/guide/intent.js';
import { searchPois } from '../src/components/catalog.js';
import { pois } from '../src/data/pois.js';
import { osmAttractions } from '../scripts/osm-map.mjs';
import { externalAssets } from '../src/data/external-assets.js';

function fixture() {
 const store=createStore(); const calls=[];
 const speech={stop(){},speak(text, callbacks){calls.push({text,callbacks}); callbacks.onStart(); return new Promise(()=>{});}};
 const guide=createGuideController({store,actions:createTourActions(store),speech});
 return {store,guide,calls};
}
test('welcome is silent, limited and cannot navigate on elapsed time', () => {
 const f=fixture();
 assert.equal(f.guide.proactive('welcome',0),true);
 assert.equal(f.calls.length,0); assert.equal(f.store.get().view,'map');
 assert.equal(f.guide.proactive('welcome',120000),false);
 assert.equal(f.guide.proactive('next',59000),false);
 assert.equal(f.guide.proactive('next',60000),true);
 assert.equal(f.store.get().view,'map');
});
test('busy states, details and explicit refusals suppress unsolicited offers', async () => {
 for (const status of ['listening','requesting','thinking','preparing','speaking','waiting']) {
  const f=fixture(); f.store.set({guideStatus:status}); assert.equal(f.guide.proactive(),false,status);
 }
 const f=fixture(); await f.guide.submit('不用了');f.store.set({guideStatus:'idle'});
 assert.equal(f.guide.proactive('next',900000),false);
 const g=fixture();g.guide.stop();assert.equal(g.guide.proactive(),false);
});
test('interest selection highlights a real point; only confirmation enters its photograph', async () => {
 const f=fixture();await f.guide.submit('我想看建筑');
 assert.equal(f.store.get().view,'map');assert.deepEqual(f.store.get().recommendedPoiIds,['colosseum']);
 assert.equal(f.store.get().preference,'architecture');
 await f.guide.submit('好的'); assert.equal(f.store.get().selectedPoiId,'colosseum');assert.equal(f.store.get().view,'photo');
 assert.equal(f.store.get().guideStatus,'waiting');
});
test('a repeat visit does not replay automatically but an explicit introduction does', async () => {
 const f=fixture(); f.guide.openPoi('eiffel');f.guide.whenSceneReady('eiffel');assert.equal(f.calls.length,1);
 f.guide.openPoi('eiffel');assert.equal(f.calls.length,1);assert.equal(f.store.get().guideStatus,'idle');
 await f.guide.submit('介绍铁塔');assert.equal(f.calls.length,2);
});
test('actual speech boundaries drive picture cues and stale events cannot restore them', async () => {
 const f=fixture();f.guide.openPoi('eiffel');f.guide.whenSceneReady('eiffel');
 const old=f.calls[0];const index=old.text.indexOf('。')+1;old.callbacks.onBoundary(index);
 assert.equal(f.store.get().narrationCue.poiId,'eiffel');assert.equal(f.store.get().narrationCue.sentence,1);
 f.guide.stop();old.callbacks.onBoundary(index);assert.equal(f.store.get().narrationCue,null);
 assert.equal(f.store.get().speechCharIndex,null);
});
test('all catalog names are reachable through text and specific names win overlapping aliases', () => {
 for (const poi of pois) assert.deepEqual(resolveLocalIntent(poi.name),{type:'open-poi',poiId:poi.id},poi.name);
 assert.equal(resolveLocalIntent('看看卢浮宫金字塔').poiId,pois.find(p=>p.name==='卢浮宫金字塔').id);
 assert.equal(resolveLocalIntent('金字塔探秘').poiId,'pyramid-adventure');
 assert.deepEqual(resolveLocalIntent('这个建筑有什么故事',{mentionedPoiId:'eiffel'}),{type:'details',poiId:'eiffel'});
 assert.deepEqual(searchPois('大本钟').map(p=>p.id),['westminster']);
 assert.ok(searchPois('', '非洲区').every(p=>p.region==='非洲区'));
});
test('catalog positions match in-park OSM anchors and exclude the external wetland museum', async () => {
 const raw=JSON.parse(await readFile(new URL('../public/assets/world-window-osm-source.json',import.meta.url),'utf8'));
 const anchors=osmAttractions(raw,externalAssets.map.bbox);
 assert.equal(anchors.some(p=>p.osmId===835229208),false);
 for(const poi of pois.filter(p=>p.position)) assert.deepEqual(poi.position,anchors.find(p=>p.source===poi.source)?.position,poi.name);
});
test('photo files match their provenance hashes and are never passed as spherical panoramas', async () => {
 for(const poi of pois.filter(p=>p.photo)) {
  const bytes=await readFile(new URL('../public/'+poi.photo.file.slice(2),import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),poi.photo.sha256);
  assert.equal(poi.photo.kind,'photo');assert.notEqual(poi.panorama,poi.photo.file);
  if (poi.panorama) assert.equal(poi.panoramaKind,'illustration');
  assert.ok(poi.photo.licenseUrl.startsWith('https://creativecommons.org/'));
 }
});

test('returning to a scene waits for the new load before replay; failed revisits can retry', () => {
 const f=fixture(); f.guide.openPoi('eiffel'); f.guide.whenSceneReady('eiffel');
 f.guide.openPoi('arc'); f.guide.whenSceneReady('arc');
 f.guide.openPoi('eiffel'); const count=f.calls.length;
 f.guide.resumeNarration();assert.equal(f.calls.length,count);assert.equal(f.store.get().guideStatus,'waiting');
 f.guide.whenSceneFailed('eiffel');assert.equal(f.calls.length,count);
 f.guide.retryScene('eiffel');assert.equal(f.store.get().pendingNarration.id,'eiffel');
 f.guide.whenSceneReady('eiffel');assert.equal(f.calls.length,count+1);
});
