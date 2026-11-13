import { readFile, mkdir, cp, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'dist');
await mkdir(out, { recursive: true });
await cp(resolve(root, 'public'), out, { recursive: true });
await cp(resolve(root, 'src'), resolve(out, 'src'), { recursive: true });

// Fully embed local modules and assets for file:// preview without installing a bundler.
// This intentionally handles this project's static ESM imports only; no runtime code fetching.
const modules = new Map();
const imports = {};
const mime = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
async function embedAsset(path) {
  const bytes = await readFile(resolve(root, 'public', path.replace(/^\.\//, '')));
  return `data:${mime[extname(path)] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
}
async function embedModule(file) {
  if (modules.has(file)) return modules.get(file);
  const key = `virtour/${relative(root, file).replaceAll('\\', '/')}`;
  modules.set(file, key);
  let code = await readFile(file, 'utf8');
  for (const match of [...code.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)]) {
    const url = await embedModule(resolve(dirname(file), match[1]));
    code = code.replace(match[0], `from '${url}'`);
  }
  for (const match of [...code.matchAll(/(['"])(\.\/assets\/[^'"]+)\1/g)]) code = code.replace(match[0], JSON.stringify(await embedAsset(match[2])));
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  imports[key] = url;
  return key;
}
// The normal static site starts at the new welcome page. Keep the existing
// self-contained tour preview available for the established offline workflow.
let html = await readFile(resolve(root, 'public/tour.html'), 'utf8');
const css = await readFile(resolve(root, 'public/styles.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./styles.css" />', `<style>${css}</style>`);
const returnLinkCss = await readFile(resolve(root, 'public/assets/arrival/tour-link.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./assets/arrival/tour-link.css" />', `<style>${returnLinkCss}</style>`);
const tourTheme = (await readFile(resolve(root, 'public/assets/tour-theme.css'), 'utf8'))
  .replace("url('./arrival/paper.png')", `url('${await embedAsset('./assets/arrival/paper.png')}')`);
html = html.replace('<link rel="stylesheet" href="./assets/tour-theme.css" />', `<style>${tourTheme}</style>`);
const callCss = await readFile(resolve(root, 'public/assets/call.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./assets/call.css" />', `<style>${callCss}</style>`);
html = html.replace('./assets/favicon.svg', await embedAsset('./assets/favicon.svg'));
const main = await embedModule(resolve(root, 'src/main.js'));
html = html.replace('<script type="module" src="/src/tour-entry.js"></script>', `<script type="module">import '${main}';</script>`);
html = html.replace('</head>', `<script type="importmap">${JSON.stringify({imports})}</script></head>`);
await writeFile(resolve(out, 'offline-preview.html'), html);
console.log('Built welcome, modes and tour pages; retained self-contained dist/offline-preview.html');
