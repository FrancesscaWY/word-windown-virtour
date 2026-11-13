import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Fixed npm versions + package-lock integrity pin the bytes; no runtime CDN dependency.
const root = new URL('../', import.meta.url);
const target = new URL('public/assets/call-vad/', root);
await mkdir(target, { recursive: true });
const files = [
  ['@ricky0123/vad-web', '0.0.31', 'silero_vad_v5.onnx'],
  ...['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map(file => ['onnxruntime-web', '1.22.0', file]),
];
const manifest = [];
for (const [name, version, file] of files) {
  const pkg = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root), 'utf8'));
  if (pkg.version !== version) throw new Error(`Expected ${name}@${version}`);
  const source = new URL(`node_modules/${name}/dist/${file}`, root);
  const bytes = await readFile(source);
  await copyFile(source, new URL(file, target));
  manifest.push({ file, source: `${name}@${version}/dist/${file}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(new URL('manifest.json', target), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared local call VAD assets in ${fileURLToPath(target)}`);
