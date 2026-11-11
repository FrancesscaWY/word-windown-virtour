import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildOsmMap } from './osm-map.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const MAP_BBOX = [113.9624, 22.533, 113.9736, 22.5421];
const PANORAMA_FILE = 'Eiffel Tower and Champ-de-Mars panorama, April 2008.jpg';
export const SOURCES = Object.freeze({
  map: {
    source: 'https://www.openstreetmap.org/way/236402460',
    dataUrl: 'https://api.openstreetmap.org/api/0.6/map.json?bbox=113.9624,22.533,113.9736,22.5421',
    attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0',
    licenseUrl: 'https://www.openstreetmap.org/copyright',
  },
  referenceMap: {
    source: 'https://commons.wikimedia.org/wiki/File:Windows_On_The_World_(Shenzhen)_Monorail_route_map_(OpenStreetMaps).jpg',
    download: 'https://upload.wikimedia.org/wikipedia/commons/f/f5/Windows_On_The_World_%28Shenzhen%29_Monorail_route_map_%28OpenStreetMaps%29.jpg',
    attribution: 'OpenStreetMap contributors; Tjej / Timothy Joy', license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    note: '世界之窗单轨路线地图，只作参考，不作为全园底图或自动定位依据。',
  },
  eiffel: {
    source: 'https://commons.wikimedia.org/wiki/File:Eiffel_Tower_and_Champ-de-Mars_panorama,_April_2008.jpg',
    originalSource: 'https://www.flickr.com/photos/gadl/2806483175/',
    attribution: 'Alexandre Duret-Lutz', license: 'CC-BY-SA-2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
    realSitePhotography: false,
    location: '巴黎铁塔原址，非深圳世界之窗',
    label: '巴黎原址实拍 · 非深圳园区',
  },
});

export function jpegDimensions(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new Error('不是完整的 JPEG 文件');
  let cursor = 2;
  let dimensions = null;
  while (cursor + 3 < bytes.length) {
    if (bytes[cursor++] !== 0xff) throw new Error('JPEG 标记损坏');
    while (bytes[cursor] === 0xff) cursor += 1;
    const marker = bytes[cursor++];
    if (marker === 0xd9) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (cursor + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(cursor);
    if (length < 2 || cursor + length > bytes.length) throw new Error('JPEG 分段损坏');
    if (marker === 0xda) {
      if (!dimensions || cursor + length >= bytes.length - 2) throw new Error('JPEG 缺少尺寸或扫描数据');
      return dimensions;
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) throw new Error('JPEG 尺寸分段损坏');
      const height = bytes.readUInt16BE(cursor + 3), width = bytes.readUInt16BE(cursor + 5);
      if (!width || !height) throw new Error('JPEG 尺寸无效');
      dimensions = { width, height };
    }
    cursor += length;
  }
  throw new Error('JPEG 缺少尺寸或完整扫描数据');
}

export function validatePanorama(bytes) {
  const dimensions = jpegDimensions(bytes);
  if (dimensions.width !== dimensions.height * 2) throw new Error(`全景必须是完整 2:1 等距柱状图，实际 ${dimensions.width}×${dimensions.height}；不会拉伸图片冒充球形全景`);
  if (dimensions.width < 1024 || dimensions.width > 4096) throw new Error('全景宽度须在 1024—4096 像素，避免手机纹理过大');
  return dimensions;
}

async function responseBytes(fetchImpl, url, { limit = 20 * 1024 * 1024, ...options } = {}) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'VirTour-demo/0.1 (local asset preparation)', ...options.headers } });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}，${url}`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('素材超过下载大小限制');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('素材超过下载大小限制'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function atomicWrite(file, data) {
  const temporary = `${file}.pending`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}

/** Testable, bounded downloads. Failed assets never replace an existing active configuration. */
export async function fetchAssets({ targetRoot = ROOT, fetchImpl = globalThis.fetch, report = console.log, only = Object.keys(SOURCES) } = {}) {
  if (!Array.isArray(only) || !only.length || only.some(key => !Object.hasOwn(SOURCES, key))) throw new Error('未知素材选择');
  const assetDir = resolve(targetRoot, 'public/assets');
  const configFile = resolve(targetRoot, 'src/data/external-assets.js');
  await mkdir(assetDir, { recursive: true });
  await mkdir(resolve(targetRoot, 'src/data'), { recursive: true });
  let active = { map: null, eiffel: null, referenceMap: null };
  try {
    const manifest = JSON.parse(await readFile(resolve(assetDir, 'downloaded-manifest.json'), 'utf8'));
    active = { ...active, ...manifest.active };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const failures = [];
  async function task(key, operation) {
    if (!only.includes(key)) return;
    try { active[key] = await operation(); report(`已准备：${key}`); }
    catch (error) { failures.push({ key, message: error.message }); report(`未启用 ${key}：${error.message}`); }
  }

  await task('referenceMap', async () => {
    const bytes = await responseBytes(fetchImpl, SOURCES.referenceMap.download, { limit: 4 * 1024 * 1024 });
    const dimensions = jpegDimensions(bytes);
    if (dimensions.width < 400 || dimensions.height < 200) throw new Error('参考地图尺寸过小');
    const record = { ...SOURCES.referenceMap, file: './assets/world-window-reference-map.jpg', ...dimensions, sha256: digest(bytes) };
    await atomicWrite(resolve(assetDir, 'world-window-reference-map.jpg'), bytes);
    return record;
  });
  await task('map', async () => {
    const bytes = await responseBytes(fetchImpl, SOURCES.map.dataUrl, { limit: 16 * 1024 * 1024 });
    const data = JSON.parse(bytes.toString('utf8'));
    const map = buildOsmMap(data, { bbox: MAP_BBOX });
    await atomicWrite(resolve(assetDir, 'world-window-osm-source.json'), bytes);
    await atomicWrite(resolve(assetDir, 'world-window-map.svg'), map.svg);
    return { ...SOURCES.map, file: './assets/world-window-map.svg', positions: map.positions, poiSources: map.poiSources, sourceSha256: digest(bytes), bbox: MAP_BBOX, sha256: digest(Buffer.from(map.svg)), changes: '将 OSM 地理几何转换为本地 SVG，采用项目配色。', sourceNote: map.sourceNote };
  });
  await task('eiffel', async () => {
    const api = new URL('https://commons.wikimedia.org/w/api.php');
    api.search = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', titles: `File:${PANORAMA_FILE}`, iiprop: 'url|size', iiurlwidth: '3840' }).toString();
    const metadataBytes = await responseBytes(fetchImpl, api.href, { limit: 1024 * 1024 });
    const metadata = JSON.parse(metadataBytes.toString('utf8'));
    const item = Object.values(metadata.query?.pages ?? {}).find(page => page.imageinfo?.[0])?.imageinfo[0];
    if (!item?.thumburl || new URL(item.thumburl).hostname !== 'upload.wikimedia.org') throw new Error('未取得 Wikimedia 官方缩略全景，不退回未经核对的图片');
    const bytes = await responseBytes(fetchImpl, item.thumburl);
    const dimensions = validatePanorama(bytes);
    const record = { ...SOURCES.eiffel, file: './assets/eiffel-paris-360.jpg', download: item.thumburl, ...dimensions, projection: 'equirectangular', sha256: digest(bytes), changes: '通过 Wikimedia 提供的缩略版本缩小尺寸，未裁切或拉伸。' };
    await atomicWrite(resolve(assetDir, 'eiffel-paris-360.jpg'), bytes);
    return record;
  });

  const manifest = { fetchedAt: new Date().toISOString(), requested: only, active, failures };
  await atomicWrite(resolve(assetDir, 'downloaded-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await atomicWrite(configFile, `// Generated by npm run assets:fetch. Only validated local files are activated.\nexport const externalAssets = ${JSON.stringify(active, null, 2)};\n`);
  return { active, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--list')) console.log(JSON.stringify(SOURCES, null, 2));
  else {
    try {
      const result = await fetchAssets(process.argv.includes('--maps') ? { only: ['map', 'referenceMap'] } : {});
      if (result.failures.length) process.exitCode = 1;
      console.log('素材准备结束；请运行 npm test 和 npm run build。没有通过校验的素材仍使用原有演示资源。');
    } catch (error) { console.error(`素材准备失败：${error.message}`); process.exitCode = 1; }
  }
}
