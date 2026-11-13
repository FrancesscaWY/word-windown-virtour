import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { experienceMarkup, detailMarkup } from '../src/components/experience.js';
import { pois, panoramaHotspots, detailSections } from '../src/data/pois.js';

// This reads the generated, trusted HTML contract; it is not a browser or a layout test.
// Keep parent relationships so a duplicate/relocated control cannot pass by text alone.
function elements(markup) {
  const result = [];
  const stack = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const match of markup.matchAll(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g)) {
    const token = match[0];
    if (token.startsWith('<!--')) continue;
    const name = /^<\/?([\w:-]+)/.exec(token)[1].toLowerCase();
    if (token.startsWith('</')) {
      assert.equal(stack.pop()?.tag, name, `unbalanced closing tag ${name}`);
      continue;
    }
    const attrs = {};
    const source = token.slice(/^<[\w:-]+/.exec(token)[0].length, token.length - 1);
    for (const attr of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      attrs[attr[1]] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    }
    const element = { tag: name, attrs, parent: stack.at(-1) ?? null };
    result.push(element);
    if (!voidTags.has(name) && !/\/\s*>$/.test(token)) stack.push(element);
  }
  assert.equal(stack.length, 0, 'generated markup must close all non-void elements');
  return result;
}

function under(element, ancestor) {
  for (let parent = element.parent; parent; parent = parent.parent) if (parent === ancestor) return true;
  return false;
}

const markup = experienceMarkup();
const nodes = elements(markup);
const byId = new Map(nodes.filter(node => node.attrs.id).map(node => [node.attrs.id, node]));

test('generated experience has unique IDs and all controller and accessibility targets exist', async () => {
  const ids = nodes.filter(node => node.attrs.id).map(node => node.attrs.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs make native selectors and labels ambiguous');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const references = [...main.matchAll(/\$\(\s*(['"])#([\w:-]+)\1\s*\)/g)].map(match => match[2]);
  assert.ok(references.length > 0);
  for (const id of new Set(references)) assert.ok(byId.has(id), `main.js target #${id} is absent from initial markup`);
  for (const node of nodes) {
    for (const attribute of ['aria-labelledby', 'aria-describedby']) {
      for (const id of node.attrs[attribute]?.split(/\s+/) ?? []) assert.ok(byId.has(id), `${attribute} references missing #${id}`);
    }
    if (node.tag === 'label' && node.attrs.for) assert.ok(byId.has(node.attrs.for), `label references missing #${node.attrs.for}`);
  }
});

test('one shared scene surface starts on the map and information remains outside its loading mask', () => {
  assert.equal(byId.has('detail-panel'), false, 'written stories use the conversation, not a fifth surface');
  const map = byId.get('map-scene');
  const panorama = byId.get('panorama-scene');
  const status = byId.get('panorama-status');
  const visit = byId.get('visit-card');
  assert.equal(map.tag, 'section');
  assert.equal(panorama.tag, 'section');
  assert.equal(Object.hasOwn(map.attrs, 'hidden'), false);
  assert.equal(Object.hasOwn(panorama.attrs, 'hidden'), true);
  assert.equal(map.parent, panorama.parent, 'both views must reuse a single primary surface');
  assert.ok(under(status, panorama));
  assert.equal(visit.parent, map.parent.parent, 'query information must be a sibling of the primary surface');
  assert.equal(under(visit, panorama), false, 'a hidden or failed panorama cannot hide a query card');
  for (const id of ['visit-card', 'retry-panorama', 'back-map']) {
    assert.equal(Object.hasOwn(byId.get(id).attrs, 'hidden'), true, `${id} is not part of the initial map state`);
  }
});

test('each landmark is one native map entrance and only the message send button submits the form', () => {
  const entrances = nodes.filter(node => Object.hasOwn(node.attrs, 'data-poi'));
  assert.deepEqual(entrances.map(node => node.attrs['data-poi']).sort(), pois.filter(poi => poi.position).map(poi => poi.id).sort());
  for (const node of entrances) {
    assert.equal(node.tag, 'button');
    assert.equal(node.attrs.type, 'button');
    assert.ok(under(node, byId.get('map-scene')));
    assert.ok(node.attrs['aria-label'], 'landmark controls need an accessible name');
  }
  const forms = nodes.filter(node => node.tag === 'form');
  assert.equal(forms.length, 1);
  const form = byId.get('voice-form');
  assert.equal(forms[0], form);
  const input = byId.get('voice-input');
  assert.equal(input.tag, 'input');
  assert.equal(input.attrs.type, 'text');
  assert.ok(under(input, form));
  assert.ok(nodes.some(node => node.tag === 'label' && node.attrs.for === input.attrs.id));
  assert.equal(input.attrs.enterkeyhint, 'send');
  const formButtons = nodes.filter(node => node.tag === 'button' && under(node, form));
  assert.deepEqual(formButtons.filter(node => node.attrs.type === 'submit').map(node => node.attrs.id), ['send-button']);
  assert.equal(byId.get('speech-button').attrs.type, 'button', 'microphone activation must not submit stale text');
  for (const node of nodes.filter(node => node.tag === 'button')) {
    assert.ok(['button', 'submit'].includes(node.attrs.type), 'native button type must be explicit');
    if (node !== byId.get('send-button')) assert.equal(node.attrs.type, 'button');
  }
});

test('map search and quick categories form one unique top navigation area', () => {
  const header = nodes.find(node => node.tag === 'header' && node.attrs.class === 'app-header');
  const search = byId.get('open-catalog');
  const categories = byId.get('top-categories');
  assert.ok(header);
  assert.ok(under(search, header));
  assert.ok(under(categories, header));
  assert.equal(nodes.filter(node => node.attrs.id === 'open-catalog').length, 1);
  assert.deepEqual(nodes.filter(node => Object.hasOwn(node.attrs, 'data-top-facility-kind')).map(node => node.attrs['data-top-facility-kind']), ['all','food','toilets','service','gate']);
});

test('details preserve real photo attribution and show explicit 360 coverage gaps where needed', () => {
  for (const poi of pois) {
    const resolved = [];
    const html = detailMarkup(poi,null,detailSections[poi.id],path => {resolved.push(path); return `local:${path}`;});
    const nodes = elements(html);
    const pictures = nodes.filter(node => node.tag === 'img');
    assert.equal(pictures.length, poi.photo ? 1 : 0, poi.id);
    assert.deepEqual(resolved, poi.photo ? [poi.photo.file] : []);
    if (poi.panorama) assert.doesNotMatch(html, /尚无可用的 360° 全景/);
    else assert.match(html, /尚无可用的 360° 全景/);
    if (poi.photo) { assert.ok(html.includes(poi.photo.licenseUrl)); assert.ok(html.includes(poi.photo.source)); }
    assert.ok(html.includes(poi.source.replaceAll('&','&amp;')));
  }
});

test('hotspot detail uses that hotspot story and provenance rather than unrelated general narration', () => {
  for (const poi of pois) {
    const hotspots = panoramaHotspots[poi.id] ?? [];
    if (poi.panoramaSource) assert.deepEqual(hotspots, [], 'photographic panoramas must not reuse illustration anchors');
    if (!hotspots.length) {
      const detail = detailMarkup(poi, null, detailSections[poi.id] ?? [], path => `local:${path}`);
      for (const section of detailSections[poi.id] ?? []) assert.ok(detail.includes(section.text), 'a scene without hotspots still exposes its general detail');
    }
    for (const hotspot of hotspots) {
      const detail = detailMarkup(poi, hotspot, detailSections[poi.id] ?? [], path => `local:${path}`);
      assert.ok(detail.includes(hotspot.title));
      assert.ok(detail.includes(hotspot.body));
      assert.ok(detail.includes(hotspot.note));
      for (const section of detailSections[poi.id] ?? []) assert.equal(detail.includes(section.text), false);
    }
  }
});
