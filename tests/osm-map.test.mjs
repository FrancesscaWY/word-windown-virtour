import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOsmMap, withOsmGeometry } from '../scripts/osm-map.mjs';

const bbox = [113.96, 22.53, 113.98, 22.55];
const point = (x, y) => ({ lon: bbox[0] + (bbox[2] - bbox[0]) * x / 100, lat: bbox[3] - (bbox[3] - bbox[1]) * y / 100 });
const node = (id, name, x, y, extras = {}) => ({ type: 'node', id, ...point(x, y), tags: { name, ...extras } });
const polygon = (id, name, x, y, tags = {}) => ({ type: 'way', id, tags: { name, building: 'yes', ...tags }, geometry: [[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1], [x - 1, y - 1]].map(([a, b]) => point(a, b)) });
const fixture = () => ({ elements: [polygon(1, 'Eiffel Tower replica', 25, 40), node(2, 'Arc de Triomphe replica', 60, 70), polygon(3, 'Pyramids of Giza replica', 80, 20)] });

test('verified landmark centers map to the same bbox as the static SVG', () => {
  const input = fixture(); const before = JSON.stringify(input);
  const result = buildOsmMap(input, { bbox });
  assert.deepEqual(result.positions, { eiffel: { x: 25, y: 40 }, arc: { x: 60, y: 70 }, pyramid: { x: 80, y: 20 } });
  assert.ok(result.svg.includes('viewBox="0 0 1200 '));
  assert.ok(!result.svg.includes('NaN'));
  assert.equal(JSON.stringify(input), before);
});

test('name:en and Chinese 埃菲尔 / 艾菲尔 aliases are accepted', () => {
  const input = fixture();
  input.elements[0].tags = { 'name:zh': '艾菲尔铁塔', building: 'yes' };
  input.elements[1].tags = { 'name:en': 'Arc de Triomphe replica' };
  input.elements[2].tags = { 'name:zh': '吉萨金字塔', building: 'yes' };
  assert.equal(buildOsmMap(input, { bbox }).positions.eiffel.x, 25);
  input.elements[0].tags['name:zh'] = '埃菲尔';
  assert.equal(buildOsmMap(input, { bbox }).positions.eiffel.y, 40);
});

test('unknown or absent landmarks fail instead of guessing positions', () => {
  const input = fixture(); input.elements[2].tags.name = 'Louvre Pyramid';
  assert.throws(() => buildOsmMap(input, { bbox }), /OSM_MAP_MISSING_POI:.*pyramid/);
  input.elements[2].tags.name = 'Pyramids of Giza replica'; delete input.elements[2].geometry;
  assert.throws(() => buildOsmMap(input, { bbox }), /pyramid.*missing geometry/);
});

test('out-of-bounds names are ignored and cannot replace a missing in-park landmark', () => {
  const input = fixture(); input.elements[0] = node(1, 'Eiffel Tower replica', 130, 40);
  assert.throws(() => buildOsmMap(input, { bbox }), /OSM_MAP_MISSING_POI:.*eiffel/);
  input.elements.push(polygon(11, 'Eiffel Tower replica', 25, 40));
  assert.deepEqual(buildOsmMap(input, { bbox }).positions.eiffel, { x: 25, y: 40 });
});

test('a supplied Window of the World park boundary excludes similarly named outside objects', () => {
  const input = fixture();
  const boundary = { type: 'way', id: 100, tags: { tourism: 'theme_park', name: '世界之窗' }, geometry: [[10, 10], [90, 10], [90, 90], [10, 90], [10, 10]].map(([x, y]) => point(x, y)) };
  input.elements.push(boundary, node(999, 'Eiffel Tower replica', 5, 5));
  assert.equal(buildOsmMap(input, { bbox }).positions.eiffel.x, 25);
  input.elements = input.elements.filter(element => element.id !== 1);
  assert.throws(() => buildOsmMap(input, { bbox }), /OSM_MAP_MISSING_POI:.*eiffel/);
});

test('multiple in-bounds Giza pyramids use their group center; conflicting towers fail', () => {
  const input = fixture(); input.elements.push(node(4, 'Pyramids of Giza replica', 60, 40));
  assert.deepEqual(buildOsmMap(input, { bbox }).positions.pyramid, { x: 70, y: 30 });
  input.elements.push(node(10, 'Eiffel Tower replica', 45, 40));
  assert.throws(() => buildOsmMap(input, { bbox }), /OSM_MAP_AMBIGUOUS_POI:.*eiffel/);
});

test('feature names are XML escaped and the embeddable map retains provenance metadata', () => {
  const input = fixture();
  input.elements.push(polygon(50, '<script>"A&B\'s"</script>', 45, 50));
  input.elements.push({ type: 'way', id: 51, tags: { highway: 'footway', name: '步道 & 水边' }, geometry: [point(10, 20), point(70, 80)] });
  const { svg, sourceNote } = buildOsmMap(input, { bbox });
  assert.ok(svg.includes('&lt;script&gt;&quot;A&amp;B&apos;s&quot;&lt;/script&gt;'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('步道 &amp; 水边'));
  assert.ok(svg.includes('© OpenStreetMap contributors · ODbL'));
  assert.ok(sourceNote.includes('https://www.openstreetmap.org/copyright'));
  assert.ok(!svg.includes('<text'), 'the host UI provides the single visible attribution');
  assert.ok(sourceNote.includes('ODbL 1.0'));
  assert.ok(!svg.includes('tile.openstreetmap.org'));
});

test('out geom multipolygon members are stitched and retain their true center', () => {
  const input = fixture();
  const tower = input.elements[0];
  input.elements[0] = { type: 'relation', id: 1001, tags: { type: 'multipolygon', name: tower.tags.name, building: 'yes' }, members: [
    { type: 'way', ref: 1, role: 'outer', geometry: tower.geometry.slice(0, 3) },
    { type: 'way', ref: 2, role: 'outer', geometry: tower.geometry.slice(2) },
  ] };
  assert.deepEqual(buildOsmMap(input, { bbox }).positions.eiffel, { x: 25, y: 40 });
});

test('park land, water, pathways and buildings use local SVG geometry layers', () => {
  const input = fixture();
  input.elements.push(polygon(60, 'Garden', 40, 30, { building: undefined, leisure: 'garden' }));
  input.elements.push(polygon(61, 'Lake', 30, 60, { building: undefined, natural: 'water' }));
  input.elements.push({ type: 'way', id: 62, tags: { highway: 'footway' }, geometry: [point(30, 30), point(70, 70)] });
  const { svg } = buildOsmMap(input, { bbox });
  for (const color of ['#e1e8dc', '#d7e7ed', '#e3dfd7', '#fdfdfb']) assert.ok(svg.includes(color));
  assert.ok(svg.includes('fill-rule="evenodd"'));
  assert.ok(!svg.includes('<image'));
});

test('invalid bounds and malformed Overpass responses fail clearly', () => {
  for (const invalid of [undefined, [0, 0, 0, 1], [0, 1, 1, 0], [NaN, 0, 1, 1], [0, -90, 1, 1]]) assert.throws(() => buildOsmMap(fixture(), { bbox: invalid }), /OSM_MAP_INVALID_BBOX/);
  assert.throws(() => buildOsmMap({}, { bbox }), /OSM_MAP_INVALID_DATA/);
});


test('native OSM node references produce the same verified positions without altering raw source', () => {
  const original = fixture(); let id = 100;
  const native = { elements: original.elements.flatMap(item => {
    if (!item.geometry) return [item];
    const nodes = item.geometry.map(point => ({ type: 'node', id: ++id, ...point }));
    const { geometry, ...rest } = item;
    return [...nodes, { ...rest, nodes: nodes.map(node => node.id) }];
  }) };
  const before = JSON.stringify(native);
  assert.deepEqual(buildOsmMap(native, { bbox }).positions, buildOsmMap(original, { bbox }).positions);
  assert.equal(JSON.stringify(native), before);
  const broken = { elements: [{ type: 'way', id: 1, nodes: [999], tags: { name: 'Eiffel Tower replica' } }] };
  assert.deepEqual(withOsmGeometry(broken).elements[0].geometry, []);
  assert.throws(() => buildOsmMap(broken, { bbox }), /MISSING_POI/);
});
