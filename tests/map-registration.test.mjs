import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mapCalibration } from '../src/data/map-calibration.js';
import { mapRoads } from '../src/data/map-roads.js';
import { projectMapPosition, projectMapLine } from '../src/components/map-projection.js';
import { buildWalkingGraph, roadPosition } from '../server/ai/walking-network.ts';
import { externalAssets } from '../src/data/external-assets.js';
import { parkCatalog } from '../src/data/park-catalog.js';
import { toCoordinates, toMapPosition } from '../src/guide/location.js';

test('registration covers the whole canvas continuously without folded triangles', () => {
  const { source, target, triangles } = mapCalibration;
  const area = (a, b, c) => ((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/2;
  let covered = 0;
  for (const triangle of triangles) {
    const a = area(...triangle.map(i => source[i])), b = area(...triangle.map(i => target[i]));
    assert.ok(a*b > 0, 'display registration must not flip a piece of the park');
    covered += Math.abs(a);
  }
  assert.ok(Math.abs(covered-10000) < 1e-6, 'mesh must cover the entire canvas exactly once');
  for (let x=0;x<=100;x+=2) for (let y=0;y<=100;y+=2) {
    const p = projectMapPosition({x,y});
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -1e-8 && p.x <= 100+1e-8 && p.y >= -1e-8 && p.y <= 100+1e-8);
  }
  for (const triangle of triangles) for (const [a,b] of [[0,1],[1,2],[2,0]]) {
    const i=triangle[a],j=triangle[b];
    const p=projectMapPosition({x:(source[i][0]+source[j][0])/2,y:(source[i][1]+source[j][1])/2});
    assert.ok(Math.hypot(p.x-(target[i][0]+target[j][0])/2,p.y-(target[i][1]+target[j][1])/2)<1e-7, 'shared edges must have no seams');
  }
});

test('artwork registration never changes geographic coordinates or pulls outside GPS onto the map', () => {
  const poi=parkCatalog.find(p=>p.id==='eiffel');
  const before=JSON.stringify(poi);
  const display=projectMapPosition(poi.position);
  assert.ok(Math.abs(display.x*1339/100-785)<.001 && Math.abs(display.y*1174/100-672)<.001);
  assert.equal(JSON.stringify(poi),before);
  const raw=toMapPosition(toCoordinates(poi.position));
  assert.ok(Math.hypot(raw.x-poi.position.x,raw.y-poi.position.y)<1e-7);
  assert.deepEqual(projectMapPosition({x:-5,y:75}),{x:-5,y:75});
  assert.equal(projectMapPosition(null),null);
});

test('generated road display is tied to the artwork and contains only sourced, non-private in-park lines', async () => {
  const root=new URL('../',import.meta.url);
  const raw=await readFile(new URL('public/assets/world-window-osm-source.json',root));
  const image=await readFile(new URL('public/assets/map.jpg',root));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(raw),mapCalibration.sourceSha256,'regenerate after OSM changes');
  assert.equal(hash(image),mapCalibration.artworkSha256,'recalibrate after artwork changes');
  const data=JSON.parse(raw), ways=new Map(data.elements.filter(e=>e.type==='way').map(e=>[e.id,e]));
  assert.ok(mapRoads.length>40);
  assert.equal(new Set(mapRoads.map(p=>p.osmId)).size,mapRoads.length);
  for(const road of mapRoads){
    const tags=ways.get(road.osmId)?.tags;
    assert.equal(tags.highway,road.kind);
    assert.notEqual(tags.area,'yes');
    assert.ok(!['no','private'].includes(tags.foot??tags.access));
    assert.doesNotMatch(road.d,/NaN|Infinity|undefined/);
    assert.match(road.d,/^M[\d.]+,[\d.]+ L/);
  }
  const graph = buildWalkingGraph(data, externalAssets.map.bbox);
  const samples = new Map(mapRoads.map(road => [road.osmId, [...road.d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(([,x,y]) => ({x:+x,y:+y}))]));
  for (const [from, edges] of graph.edges) for (const edge of edges) {
    const projected = projectMapLine([roadPosition(graph, from), roadPosition(graph, edge.to)]).points;
    assert.ok(projected.every(p => samples.get(edge.wayId)?.some(q => Math.hypot(q.x - p.x * 13.39, q.y - p.y * 11.74) < .02)), 'every routable edge must appear in the calibrated road overlay, including boundary gates');
  }
});
