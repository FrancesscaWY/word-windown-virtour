import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { referenceAvatarData } from '../src/data/reference-avatar-data.js';
import { createHandler } from '../server/handler.ts';

const root = new URL('../', import.meta.url);
const assets = new URL('public/assets/reference-avatars/', root);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pngSize = bytes => {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.subarray(12, 16).toString(), 'IHDR');
  assert.equal(bytes[25], 6, 'use RGBA so the original background is transparent');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};
const within = (rectangle, size, label) => {
  assert.ok(rectangle.every(Number.isFinite), `${label} has finite coordinates`);
  const [x, y, width, height] = rectangle;
  assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= size[0] && y + height <= size[1], `${label} fits its image`);
};

test('reference asset manifest matches the actual supplied artwork and all generated transparent PNGs', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', assets), 'utf8'));
  assert.equal(Object.keys(manifest.sources).length, 2);
  for (const [path, expected] of Object.entries(manifest.sources)) {
    assert.equal(hash(await readFile(new URL(path, root))), expected, 'source artwork remains unchanged');
  }
  for (const [path, expected] of Object.entries(manifest.generators)) {
    assert.equal(hash(await readFile(new URL(path, root))), expected, `${path} changed: regenerate the artwork together`);
  }
  assert.equal(hash(await readFile(new URL(manifest.animationData.path, root))), manifest.animationData.sha256);
  for (const [file, expected] of Object.entries(manifest.outputs)) {
    const bytes = await readFile(new URL(file, assets));
    assert.equal(hash(bytes), expected.sha256, `${file} must be rebuilt together with the manifest`);
    assert.equal(bytes.length, expected.bytes);
    assert.deepEqual(pngSize(bytes), expected.size);
  }
});

test('actual artwork layer, frame and face rectangles fit the decoded texture dimensions', async () => {
  for (const [id, data] of Object.entries(referenceAvatarData)) {
    const artFile = id === 'otter' ? 'otter-layers.png' : 'dandelion-sprites.png';
    const artSize = pngSize(await readFile(new URL(artFile, assets)));
    const faceSize = pngSize(await readFile(new URL(`${id}-face.png`, assets)));
    if (data.layers) {
      for (const layer of data.layers) {
        within([layer.atlasX, layer.atlasY, layer.width, layer.height], artSize, `${id}/${layer.name}`);
        within([layer.x, layer.y, layer.width, layer.height], [data.width, data.height], `${id} source ${layer.name}`);
      }
      for (const name of data.order) assert.ok(data.layers.some(layer => layer.name === name));
    } else {
      assert.ok(data.frames.length >= 24, 'retain distinct walking and waving cycles');
      assert.ok(artSize[0] <= 4096 && artSize[1] <= 4096, 'keep the baked atlas within a modest texture size');
      for (const frame of data.frames) within([frame.x, frame.y, data.frameWidth, data.frameHeight], artSize, `${id} frame`);
      for (const [action, indices] of Object.entries(data.actions)) {
        assert.ok(indices.length);
        for (const index of indices) assert.ok(Number.isInteger(index) && index >= 0 && index < data.frames.length);
        if (indices.length > 1) assert.ok(data.actionDurations[action] > 0, `${action} has its authored playback duration`);
      }
    }
    within(data.face.mouth.rect, [data.width, data.height], `${id} mouth destination`);
    for (const patch of Object.values(data.face.mouth.patches)) within([patch.x, patch.y, patch.width, patch.height], faceSize, `${id} mouth patch`);
    for (const eye of data.face.eyes) {
      within(eye.rect, [data.width, data.height], `${id} eye destination`);
      for (const patch of [eye.patch, eye.happyPatch].filter(Boolean)) within([patch.x, patch.y, patch.width, patch.height], faceSize, `${id} eye patch`);
    }
  }
});

test('all four local artwork player assets are served as PNGs by the existing site handler', async () => {
  const handler = createHandler();
  for (const file of ['otter-layers.png', 'otter-face.png', 'dandelion-sprites.png', 'dandelion-face.png']) {
    const response = await handler(new Request(`http://localhost/assets/reference-avatars/${file}`));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\/png/);
    pngSize(Buffer.from(await response.arrayBuffer()));
  }
});
