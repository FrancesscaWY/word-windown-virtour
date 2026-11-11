import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { osmParkServices } from '../scripts/osm-map.mjs';
import { externalAssets } from '../src/data/external-assets.js';
import { facilities, parkServices } from '../src/data/facilities.js';
import { resolveLocalIntent } from '../src/guide/intent.js';
import { createGuideController } from '../src/guide/controller.js';
import { createStore } from '../src/guide/store.js';
import { createTourActions } from '../src/guide/tour-actions.js';
const raw=JSON.parse(await readFile(new URL('../public/assets/world-window-osm-source.json',import.meta.url),'utf8'));

test('full park boundary and generated facility pins share the refreshed geographic extent',()=>{
 const result=osmParkServices(raw,externalAssets.map.bbox);
 assert.deepEqual(result,parkServices);
 assert.ok(result.boundary.rings[0].length>10);
 for(const p of result.boundary.rings.flat()) assert.ok(p.x>=0 && p.x<=100 && p.y>=0 && p.y<=100);
 assert.throws(()=>osmParkServices(raw,[113.964,22.533,113.973,22.541]),/clips/);
});
test('nearby city facilities, internal gates and restricted access cannot become visitor exits',()=>{
 const result=osmParkServices(raw,externalAssets.map.bbox);
 const ids=result.facilities.map(f=>f.id);
 assert.ok(ids.includes('node-4809251648'));
 assert.deepEqual(result.facilities.filter(f=>f.kind==='gate').map(f=>f.id).sort(),['node-2444331156','node-2698482340']);
 for(const id of ['node-5574955208','node-6520453217','node-5356621139','node-1116458640'])assert.ok(!ids.includes(id));
 for(const gate of result.facilities.filter(f=>f.kind==='gate')){assert.equal(gate.accessVerified,false);assert.match(gate.note,/尚未核实/);}
 const changed=structuredClone(raw);changed.elements.find(e=>e.id===2444331156).tags.access='private';
 assert.ok(!osmParkServices(changed,externalAssets.map.bbox).facilities.some(f=>f.id==='node-2444331156'));
 for(const item of facilities.filter(f=>f.kind==='service')){assert.equal(item.position,null);assert.ok(item.source.startsWith('https://'));}
});
test('facility requests and negations do not borrow the previous attraction topic',()=>{
 const state={mentionedPoiId:'eiffel'};
 for(const [input,kind] of [['卫生间在哪','toilets'],['最近的厕所怎么走','toilets'],['找出口','gate'],['游客服务中心在哪里','service'],['想吃饭','food'],['停车场在哪','parking']])assert.deepEqual(resolveLocalIntent(input,state),{type:'facility',kind});
 for(const input of ['不用找厕所','不想找出口','不要带我去卫生间','别找出口'])assert.equal(resolveLocalIntent(input,state).type,'reject');
});
test('facility command cancels pending scenery narration and leaves no stale attraction context',async()=>{
 const store=createStore();const calls=[];
 const guide=createGuideController({store,actions:createTourActions(store),speech:{stop(){},speak(text,callbacks){calls.push({text,callbacks});return new Promise(()=>{});}}});
 guide.openPoi('eiffel');assert.equal(store.get().view,'panorama');
 await guide.submit('卫生间在哪');
 assert.equal(store.get().view,'map');assert.equal(store.get().pendingNarration,null);assert.equal(store.get().mentionedPoiId,null);
 assert.equal(store.get().facilityInfo.kind,'toilets');assert.equal(store.get().detailsOpen,false);
 assert.equal(guide.whenSceneReady('eiffel'),false);
 assert.match(store.get().guideText,/不能判断哪一处最近/);
 const count=calls.length;guide.whenSceneReady('eiffel');assert.equal(calls.length,count);
 store.set({guideStatus:'idle'});assert.equal(guide.proactive('next',999999),false);
 await guide.submit('它远不远');assert.equal(store.get().clarification.kind,'choose-poi');
 guide.showMap();assert.equal(store.get().facilityInfo,null);
 guide.showFacilities('gate');assert.match(store.get().guideText,/不能确认/);
 guide.openPoi('pyramid');assert.equal(store.get().facilityInfo,null);
 guide.dispose();
});
