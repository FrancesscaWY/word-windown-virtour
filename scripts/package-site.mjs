import './build.mjs';
import { cp, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
// A fresh folder prevents stale files from a previous release being published.
const site = await mkdtemp(resolve(artifacts, 'virtour-site-'));
for (const entry of ['index.html', 'modes.html', 'tour.html', 'styles.css', 'assets', 'src']) {
  await cp(resolve(root, 'dist', entry), resolve(site, entry), { recursive: true });
}
await cp(resolve(root, 'ASSET_SOURCES.md'), resolve(site, 'ASSET_SOURCES.md'));
await writeFile(resolve(site, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Permissions-Policy: microphone=(self), camera=(), geolocation=(self)
  Cache-Control: public, max-age=0, must-revalidate
`);
let files = 0;
async function inspect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw new Error(`Unexpected private file or symlink: ${entry.name}`);
    if (entry.isDirectory()) await inspect(resolve(dir, entry.name));
    else files += 1;
  }
}
await inspect(site);
const archive = `${site}.zip`;
const zip = spawnSync('zip', ['-q', '-r', archive, basename(site)], { cwd: artifacts, encoding: 'utf8' });
if (zip.error || zip.status !== 0) throw new Error(zip.error?.message ?? zip.stderr);
console.log(JSON.stringify({ folder: site, archive, files, note: 'Upload this folder to Netlify Drop. No account, site, or deployment has been created by this command.' }, null, 2));
