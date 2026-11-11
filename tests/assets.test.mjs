import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { jpegDimensions, validatePanorama, fetchAssets, SOURCES, MAP_BBOX } from '../scripts/fetch-assets.mjs';

// A real flat-gray baseline JPEG generated offline with Pillow. The optimized
// grayscale scan encodes every 8x8 block with two zero bits (DC=0, then EOB).
// Rebuild its dimensions and zero scan locally; no image package/network is used.
const JPEG_HEADER = Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080200040001011100ffc40014000100000000000000000000000000000000ffc40014100100000000000000000000000000000000ffda0008010100003f00', 'hex');
const EOI = Buffer.from([0xff, 0xd9]);
const THUMB_URL = 'https://upload.wikimedia.org/fixture/eiffel-360.jpg';

function jpeg(width = 1024, height = 512) {
  const header = Buffer.from(JPEG_HEADER);
  const frame = header.indexOf(Buffer.from([0xff, 0xc0]));
  header.writeUInt16BE(height, frame + 5);
  header.writeUInt16BE(width, frame + 7);
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  return Buffer.concat([header, Buffer.alloc(Math.ceil(blocks / 4)), EOI]);
}

function missingScan() {
  return Buffer.concat([JPEG_HEADER.subarray(0, JPEG_HEADER.indexOf(Buffer.from([0xff, 0xda]))), EOI]);
}

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'virtour-assets-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function fakeFetch({ image = jpeg(), thumburl = THUMB_URL, imageHeaders = {}, imageStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (value, options) => {
    const url = new URL(value);
    calls.push({ url: url.href, method: options?.method ?? 'GET' });
    if (url.hostname === 'commons.wikimedia.org' && url.pathname === '/w/api.php') {
      return Response.json({ query: { pages: { 1: { imageinfo: [{ thumburl, width: 10000, height: 5000 }] } } } });
    }
    if (url.href === THUMB_URL) return new Response(image, { status: imageStatus, headers: { 'Content-Type': 'image/jpeg', ...imageHeaders } });
    return new Response('Fixture intentionally excludes other assets', { status: 503 });
  };
  return { fetchImpl, calls };
}

async function generatedConfig(root) {
  const source = await readFile(join(root, 'src/data/external-assets.js'), 'utf8');
  const match = /export const externalAssets = ([\s\S]*);\s*$/.exec(source);
  assert.ok(match, 'generated local config must contain the active asset object');
  return JSON.parse(match[1]);
}

test('JPEG geometry is read from image bytes without changing the supplied buffer', () => {
  for (const [width, height] of [[1024, 512], [4096, 2048], [1200, 800]]) {
    const input = jpeg(width, height);
    const before = Buffer.from(input);
    assert.deepEqual(jpegDimensions(input), { width, height });
    assert.deepEqual(input, before);
  }
});

test('panorama geometry enforces exact 2:1 shape and bounded mobile texture sizes', () => {
  for (const width of [1024, 2048, 4096]) assert.deepEqual(validatePanorama(jpeg(width, width / 2)), { width, height: width / 2 });
  for (const [width, height] of [[1024, 1024], [1200, 800], [4096, 2047], [512, 256], [8192, 4096]]) {
    assert.throws(() => validatePanorama(jpeg(width, height)), undefined, `${width}x${height}`);
  }
});

test('HTML, empty, incomplete and corrupted JPEG segments cannot provide usable dimensions', () => {
  const valid = jpeg();
  const damagedLength = Buffer.from(valid);
  damagedLength.writeUInt16BE(0xffff, 4);
  const zeroDimension = jpeg(0, 512);
  for (const input of [Buffer.alloc(0), Buffer.from('<html>Access denied</html>'), valid.subarray(0, -2), Buffer.from([0xff, 0xd8, 0xff, 0xd9]), damagedLength, zeroDimension]) {
    assert.throws(() => jpegDimensions(input));
    assert.throws(() => validatePanorama(input));
  }
});

test('a frame header without any image scan cannot be activated as a complete panorama', () => {
  assert.throws(() => validatePanorama(missingScan()), 'a valid size header alone is not a usable panorama image');
});

test('failed downloads retain existing active config and image files', async t => {
  const root = await workspace(t);
  const assets = join(root, 'public/assets');
  const data = join(root, 'src/data');
  await mkdir(assets, { recursive: true });
  await mkdir(data, { recursive: true });
  const existing = {
    map: { file: './assets/prior-map.svg', attribution: 'Existing map attribution' },
    eiffel: { file: './assets/prior-panorama.jpg', attribution: 'Existing panorama attribution', width: 1024, height: 512 },
    referenceMap: null,
  };
  const previous = jpeg();
  await writeFile(join(assets, 'prior-panorama.jpg'), previous);
  await writeFile(join(assets, 'downloaded-manifest.json'), JSON.stringify({ active: existing }));
  await writeFile(join(data, 'external-assets.js'), `export const externalAssets = ${JSON.stringify(existing)};\n`);
  const reports = [];
  const result = await fetchAssets({ targetRoot: root, fetchImpl: async () => { throw new Error('Offline test failure'); }, report: text => reports.push(text) });
  assert.deepEqual(result.active, existing);
  assert.deepEqual(result.failures.map(item => item.key).sort(), ['eiffel', 'map', 'referenceMap']);
  assert.deepEqual(await generatedConfig(root), existing);
  assert.deepEqual(JSON.parse(await readFile(join(assets, 'downloaded-manifest.json'), 'utf8')).active, existing);
  assert.deepEqual(await readFile(join(assets, 'prior-panorama.jpg')), previous);
  assert.equal((await readdir(assets)).some(name => name.endsWith('.pending')), false);
  assert.equal(reports.length, 3);
  await assert.rejects(readFile(join(assets, 'eiffel-paris-360.jpg')), { code: 'ENOENT' });
});

test('HTTP errors, HTML, empty or incomplete image responses never enable a panorama', async t => {
  for (const options of [
    { image: Buffer.from('<!doctype html><title>Permission denied</title>') },
    { image: Buffer.alloc(0) },
    { image: jpeg().subarray(0, -2) },
    { image: jpeg(), imageStatus: 503 },
  ]) {
    const root = await workspace(t);
    const fixture = fakeFetch(options);
    const result = await fetchAssets({ targetRoot: root, fetchImpl: fixture.fetchImpl, report() {} });
    assert.equal(result.active.eiffel, null);
    assert.ok(result.failures.some(failure => failure.key === 'eiffel'));
    assert.equal((await generatedConfig(root)).eiffel, null);
    await assert.rejects(readFile(join(root, 'public/assets/eiffel-paris-360.jpg')), { code: 'ENOENT' });
  }
});

test('only the official thumbnail host is fetched and oversized responses stay inactive', async t => {
  const untrustedRoot = await workspace(t);
  const untrusted = fakeFetch({ thumburl: 'https://upload.wikimedia.org.invalid/not-a-panorama.jpg' });
  const rejected = await fetchAssets({ targetRoot: untrustedRoot, fetchImpl: untrusted.fetchImpl, report() {} });
  assert.equal(rejected.active.eiffel, null);
  assert.equal(untrusted.calls.some(call => call.url.includes('wikimedia.org.invalid')), false);
  const oversizedRoot = await workspace(t);
  const oversized = fakeFetch({ imageHeaders: { 'Content-Length': String(21 * 1024 * 1024) } });
  const limited = await fetchAssets({ targetRoot: oversizedRoot, fetchImpl: oversized.fetchImpl, report() {} });
  assert.equal(limited.active.eiffel, null);
  await assert.rejects(readFile(join(oversizedRoot, 'public/assets/eiffel-paris-360.jpg')), { code: 'ENOENT' });
});

test('a validated mock panorama produces local bytes, geometry, provenance and attribution config', async t => {
  const root = await workspace(t);
  const bytes = jpeg();
  const fixture = fakeFetch({ image: bytes });
  const result = await fetchAssets({ targetRoot: root, fetchImpl: fixture.fetchImpl, report() {} });
  assert.deepEqual(result.failures.map(item => item.key).sort(), ['map', 'referenceMap']);
  const record = result.active.eiffel;
  assert.ok(record);
  assert.equal(record.file, './assets/eiffel-paris-360.jpg');
  assert.equal(record.download, THUMB_URL);
  assert.equal(record.width, 1024);
  assert.equal(record.height, 512);
  assert.equal(record.projection, 'equirectangular');
  assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'));
  for (const key of ['source', 'originalSource', 'attribution', 'license', 'licenseUrl', 'location', 'label']) {
    assert.equal(record[key], SOURCES.eiffel[key], `attribution field ${key} must survive local activation`);
  }
  assert.equal(record.realSitePhotography, false, 'Paris source photography must not become Shenzhen park photography');
  assert.deepEqual(await readFile(join(root, 'public/assets/eiffel-paris-360.jpg')), bytes);
  assert.deepEqual((await generatedConfig(root)).eiffel, record);
  const manifest = JSON.parse(await readFile(join(root, 'public/assets/downloaded-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.active.eiffel, record);
  const metadataCall = fixture.calls.find(call => new URL(call.url).hostname === 'commons.wikimedia.org');
  assert.equal(new URL(metadataCall.url).searchParams.get('iiurlwidth'), '3840');
  assert.equal(fixture.calls.filter(call => call.url === THUMB_URL).length, 1);
  assert.equal((await readdir(join(root, 'public/assets'))).some(name => name.endsWith('.pending')), false);
});

test('validated map and photo records activate together with geographic pins and photographic narration', async t => {
  const root = await workspace(t);
  const [west, south, east, north] = MAP_BBOX;
  const point = (x, y) => ({ lon: west + (east - west) * x / 100, lat: north - (north - south) * y / 100 });
  const osm = { elements: [
    { type: 'node', id: 1, ...point(25, 40), tags: { name: 'Eiffel Tower replica' } },
    { type: 'node', id: 2, ...point(60, 70), tags: { name: 'Arc de Triomphe replica' } },
    { type: 'node', id: 3, ...point(80, 20), tags: { name: 'Pyramids of Giza replica' } },
    { type: 'way', id: 4, geometry: [point(20, 20), point(80, 80)], tags: { highway: 'footway' } },
  ] };
  const photo = fakeFetch();
  const result = await fetchAssets({ targetRoot: root, report() {}, fetchImpl: async (url, options) => {
    if (url === SOURCES.map.dataUrl) {
      assert.equal(new URL(url).searchParams.get('bbox'), MAP_BBOX.join(','));
      return Response.json(osm);
    }
    if (url === SOURCES.referenceMap.download) return new Response(jpeg(805, 519));
    return photo.fetchImpl(url, options);
  } });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.active.map.positions, { eiffel: { x: 25, y: 40 }, arc: { x: 60, y: 70 }, pyramid: { x: 80, y: 20 } });
  const svg = await readFile(join(root, 'public/assets/world-window-map.svg'), 'utf8');
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(svg, /© OpenStreetMap contributors/);
  assert.equal(result.active.map.sha256, createHash('sha256').update(svg).digest('hex'));
  assert.deepEqual(JSON.parse(await readFile(join(root, 'public/assets/world-window-osm-source.json'), 'utf8')), osm);
  // Optional Paris test assets must never be mapped to the park's current catalog.
  const current = await import('../src/data/pois.js');
  assert.ok(current.pois.every(poi => !poi.panorama || (poi.id === 'eiffel' && poi.panorama === './assets/demo-panorama.png' && poi.panoramaKind === 'illustration')));
  assert.ok(current.pois.filter(poi => poi.photo).every(poi => poi.photo.label.includes('深圳')));

});


test('maps-only refresh keeps an existing panorama and never requests a photo', async t => {
  const root = await workspace(t);
  await mkdir(join(root, 'public/assets'), { recursive: true });
  const photo = { file: './assets/existing.jpg', sha256: 'previous-photo' };
  await writeFile(join(root, 'public/assets/downloaded-manifest.json'), JSON.stringify({ active: { eiffel: photo } }));
  const requests = [];
  const result = await fetchAssets({ targetRoot: root, only: ['map', 'referenceMap'], report() {}, fetchImpl: async url => {
    requests.push(url);
    return url === SOURCES.referenceMap.download ? new Response(jpeg(805, 519)) : new Response('Offline', { status: 503 });
  } });
  assert.deepEqual(requests.sort(), [SOURCES.map.dataUrl, SOURCES.referenceMap.download].sort());
  assert.deepEqual(result.active.eiffel, photo);
  assert.ok(result.active.referenceMap);
  assert.deepEqual(result.failures.map(item => item.key), ['map']);
});
