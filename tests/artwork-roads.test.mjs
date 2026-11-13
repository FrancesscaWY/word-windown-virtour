import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { artworkRoads } from '../src/data/artwork-roads.js';
import { buildArtworkGraph, artworkNetwork, shortestArtworkPath, artworkPosition } from '../server/ai/artwork-network.ts';
import { planRoute } from '../server/ai/routes.ts';
import { executeTool, modelToolOutput } from '../server/ai/tools.ts';
import { parkCatalog } from '../src/data/park-catalog.js';
import { roadNetworkMarkup } from '../src/components/road-network.js';

const input = ids => ({ title: '图上漫游', summary: '按底图道路游览', stops: ids.map(poi_id => ({ poi_id, reason: '看看这处建筑' })) });
const route = ids => executeTool('plan_route', input(ids));

test('traced network is bound to its exact illustration and has valid connected paths for every mapped stop', async () => {
  const hash = data => createHash('sha256').update(data).digest('hex');
  assert.equal(hash(await readFile(new URL('../public/assets/map.jpg', import.meta.url))), artworkRoads.artworkSha256);
  const { sourceSha256, ...data } = artworkRoads;
  assert.equal(hash(JSON.stringify(data)), sourceSha256);
  const { graph } = artworkNetwork();
  assert.equal(new Set(artworkRoads.roads.map(r => r.id)).size, artworkRoads.roads.length);
  for (const node of graph.nodes.values()) assert.ok(node.x >= 0 && node.x <= 100 && node.y >= 0 && node.y <= 100);
  for (const poi of parkCatalog.filter(p => p.position && p.locationVerified)) {
    assert.ok(shortestArtworkPath(graph, graph.anchors.eiffel, graph.anchors[poi.id]), poi.id);
  }
  assert.match(roadNetworkMarkup(), /data-source="artwork-traced"/);
  assert.doesNotMatch(roadNetworkMarkup(), /data-osm-way/);
});

test('illustration graph connects only shared vertices and cannot invent links over a visual crossing', () => {
  const graph = buildArtworkGraph({ artwork: { width: 100, height: 100 }, sourceSha256: '', anchors: {},
    nodes: [{ id: 1, x: 10, y: 50 }, { id: 2, x: 90, y: 50 }, { id: 3, x: 50, y: 10 }, { id: 4, x: 50, y: 90 }],
    roads: [{ id: 'horizontal', nodeIds: [1, 2] }, { id: 'vertical', nodeIds: [3, 4] }],
  });
  assert.equal(shortestArtworkPath(graph, 1, 4), null);
  assert.deepEqual(shortestArtworkPath(graph, 2, 1).nodes, [2, 1]);
});

test('planned routes follow the authored paths, retain model order and never convert artwork pixels into meters', () => {
  const output = route(['colosseum', 'arc', 'eiffel']), { graph } = artworkNetwork();
  assert.equal(output.status, 'success');
  assert.equal(output.route.geometry.kind, 'artwork-traced'); assert.equal(output.route.geometry.coordinateSpace, 'artwork-percent');
  assert.equal(output.route.distanceMeters, null);
  assert.deepEqual(output.route.stops.map(s => s.poiId), ['colosseum', 'arc', 'eiffel']);
  for (const [i, stop] of output.route.stops.entries()) {
    assert.equal(stop.roadAnchor.entranceVerified, false);
    assert.deepEqual(output.route.geometry.points[output.route.geometry.stopIndices[i]], artworkPosition(graph, graph.anchors[stop.poiId]));
  }
  for (let i = 0; i < output.route.geometry.roadIds.length; i++) {
    const g = output.route.geometry;
    assert.ok(graph.edges.get(g.nodeIds[i]).some(edge => edge.to === g.nodeIds[i + 1] && edge.roadId === g.roadIds[i]));
  }
  const compact = modelToolOutput('plan_route', output);
  assert.equal(compact.route.geometry.points, undefined); assert.equal(compact.route.distanceMeters, null);
  assert.ok(output.route.geometry.points.length > 3);
});

test('shared visual anchors produce repeated stop indices; entirely coincident routes are unavailable', () => {
  const output = route(['himeji', 'fuji', 'eiffel']);
  assert.equal(output.status, 'success'); assert.equal(output.route.geometry.stopIndices[0], output.route.geometry.stopIndices[1]);
  const same = route(['himeji', 'fuji']);
  assert.equal(same.status, 'unavailable'); assert.equal(same.route, null);
});

test('missing artwork data, anchors and disconnected paths return no partial replacement', () => {
  const network = artworkNetwork();
  const isolated = { ...network, graph: { ...network.graph, edges: new Map() } };
  const missing = { ...network, graph: { ...network.graph, anchors: {} } };
  for (const load of [() => { throw new Error('missing source'); }, () => isolated, () => missing]) {
    const output = planRoute(input(['colosseum', 'arc', 'eiffel']), load);
    assert.equal(output.status, 'unavailable'); assert.equal(output.route, null); assert.ok(output.error);
  }
});
