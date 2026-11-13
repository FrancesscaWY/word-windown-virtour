import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWalkingGraph, walkingNetwork, nearestRoadNode, shortestRoadPath, distanceMeters } from '../server/ai/walking-network.ts';
import { parkCatalog } from '../src/data/park-catalog.js';

const node = (id, x, y, tags) => ({ type: 'node', id, lon: x / 1000, lat: y / 1000, tags });
const way = (id, nodes, tags = {}) => ({ type: 'way', id, nodes, tags: { highway: 'footway', ...tags } });
const square = [node(901, 0, 0), node(902, 10, 0), node(903, 10, 10), node(904, 0, 10)];
function graph(elements, ring = square) {
  return buildWalkingGraph({ elements: [...ring, way(900, [...ring.map(n => n.id), ring[0].id], { highway: undefined }), ...elements] }, [0, 0, .01, .01], 900);
}

test('road crossings, nearby endpoints and missing nodes never create invented links', () => {
  const elements = [node(1, 2, 5), node(2, 8, 5), node(3, 5, 2), node(4, 5, 8), way(10, [1, 2]), way(11, [3, 4])];
  assert.equal(shortestRoadPath(graph(elements), 1, 4), null, 'a visual crossing without a shared node is disconnected');
  const near = graph([node(1, 1, 1), node(2, 2, 2), node(3, 2.001, 2), node(4, 3, 3), way(10, [1, 2]), way(11, [3, 4])]);
  assert.equal(shortestRoadPath(near, 1, 4), null);
  const gap = graph([node(1, 1, 1), node(2, 2, 2), node(3, 3, 3), node(4, 4, 4), way(10, [1, 2, 999, 3, 4])]);
  assert.equal(shortestRoadPath(gap, 1, 4), null, 'a missing node cannot be skipped');
  assert.deepEqual(shortestRoadPath(graph([...elements, way(12, [2, 4])]), 1, 4).nodes, [1, 2, 4]);
});

test('Dijkstra uses recorded edge lengths and pedestrian direction rather than car one-way tags', () => {
  const elements = [node(1, 1, 1), node(2, 3, 8), node(3, 5, 1), node(4, 3, 1)];
  const g = graph([...elements, way(10, [1, 2, 3]), way(11, [1, 4, 3], { oneway: 'yes' })]);
  const forward = shortestRoadPath(g, 1, 3), backward = shortestRoadPath(g, 3, 1);
  assert.deepEqual(forward.nodes, [1, 4, 3]); assert.deepEqual(backward.nodes, [3, 4, 1]);
  assert.ok(Math.abs(forward.meters - distanceMeters(g.nodes.get(1), g.nodes.get(3))) < .01);
  for (const tags of [{ 'oneway:foot': 'yes' }, { 'foot:backward': 'no' }, { 'foot:backward': 'private' }]) {
    const directed = graph([...elements, way(11, [1, 4, 3], tags)]);
    assert.ok(shortestRoadPath(directed, 1, 3)); assert.equal(shortestRoadPath(directed, 3, 1), null);
  }
  const reversed = graph([...elements, way(11, [1, 4, 3], { 'oneway:foot': '-1' })]);
  assert.equal(shortestRoadPath(reversed, 1, 3), null); assert.ok(shortestRoadPath(reversed, 3, 1));
});

test('walking restrictions, blocked nodes, areas and construction are excluded; steps and gates are reported', () => {
  const nodes = [node(1, 1, 1), node(2, 2, 2), node(3, 3, 3)];
  for (const tags of [{ foot: 'no' }, { access: 'private' }, { area: 'yes' }, { construction: 'footway' }, { highway: 'motorway' }]) {
    assert.equal(graph([...nodes, way(10, [1, 2, 3], tags)]).edges.size, 0);
  }
  for (const tags of [{ access: 'private' }, { foot: 'no' }, { barrier: 'wall' }, { barrier: 'fence' }, { barrier: 'gate', locked: 'yes' }]) {
    assert.equal(graph([nodes[0], node(2, 2, 2, tags), nodes[2], way(10, [1, 2, 3])]).edges.size, 0);
  }
  const g = graph([nodes[0], node(2, 2, 2, { barrier: 'gate' }), nodes[2], way(10, [1, 2, 3], { access: 'private', foot: 'yes', highway: 'steps' })]);
  const path = shortestRoadPath(g, 1, 3);
  assert.ok(path.edges.every(e => e.steps && e.gate));
});

test('park boundary excludes outside roads and edges crossing a concave notch even when their midpoint is inside', () => {
  assert.equal(graph([node(1, 1, 1), node(2, 11, 1), way(10, [1, 2])]).edges.size, 0);
  const ring = [node(901, 0, 0), node(902, 10, 0), node(903, 10, 10), node(904, 3, 10), node(905, 3, 4), node(906, 2, 4), node(907, 2, 10), node(908, 0, 10)];
  assert.equal(graph([node(1, 1, 8), node(2, 9, 8), way(10, [1, 2])], ring).edges.size, 0);
  assert.throws(() => buildWalkingGraph({ elements: [way(900, [1, 2, 1])] }, [0, 0, 1, 1], 900), /incomplete/);
  assert.throws(() => buildWalkingGraph({ elements: [...square, way(900, square.map(n => n.id))] }, [0, 0, 1, 1], 900), /not closed/);
});

test('anchors have a strict distance limit and route endpoints are recorded nodes, not fabricated entrances', async () => {
  const { graph: g } = walkingNetwork();
  assert.equal(nearestRoadNode(g, { x: -100, y: -100 }), null);
  const raw = JSON.parse(await readFile(new URL('../public/assets/world-window-osm-source.json', import.meta.url)));
  const ways = new Map(raw.elements.filter(e => e.type === 'way').map(w => [w.id, w]));
  for (const poi of parkCatalog.filter(p => p.locationVerified && p.position)) {
    const anchor = nearestRoadNode(g, poi.position);
    assert.ok(anchor && anchor.offsetMeters <= 100, poi.id);
    const path = shortestRoadPath(g, 2699879607, anchor.nodeId);
    assert.ok(path, poi.id);
    for (let i = 0; i < path.edges.length; i++) {
      const ids = ways.get(path.edges[i].wayId).nodes, a = path.nodes[i], b = path.nodes[i + 1];
      assert.ok(ids.some((id, j) => j > 0 && ((id === a && ids[j - 1] === b) || (id === b && ids[j - 1] === a))), 'every returned edge must exist in the original OSM way');
    }
  }
});
