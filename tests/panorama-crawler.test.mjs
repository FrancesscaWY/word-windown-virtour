import test from 'node:test';
import assert from 'node:assert/strict';
import { distance, validateImage, crawl } from '../scripts/crawl-panoramas.mjs';

test('coordinate distance rejects distant originals and measures nearby scenes', () => {
  const p = { lat: 22.537039, lon: 113.969433 };
  assert.equal(distance(p, p), 0);
  assert.ok(distance(p, { ...p, lat: p.lat + 0.001 }) > 110);
  assert.ok(distance(p, { lat: 48.8584, lon: 2.2945 }) > 1000000);
});

test('image validation refuses invalid image data', () => {
  assert.throws(() => validateImage(Buffer.from('<html>login</html>'), true));
});

test('invalid platform, radius and unknown coordinates fail before network', async () => {
  await assert.rejects(crawl({ platforms: ['unknown'] }), /platform/);
  await assert.rejects(crawl({ radius: NaN }), /Radius/);
  await assert.rejects(crawl({ ids: ['windmills'] }), /coordinates/);
});
