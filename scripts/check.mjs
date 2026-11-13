import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
let count = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) { await walk(file); continue; }
    if (!/\.(m?js|ts)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) await access(resolve(dirname(file), match[1]));
    count += 1;
  }
}
for (const dir of ['src', 'server', 'scripts', 'tests']) await walk(resolve(root, dir));
await access(resolve(root, 'public/assets/world-window-map.svg'));
await access(resolve(root, 'public/assets/park-catalog.json'));
console.log(`Syntax and local imports OK: ${count} modules; map and catalog assets exist.`);
