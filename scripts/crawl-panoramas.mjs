import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { jpegDimensions, MAP_BBOX } from './fetch-assets.mjs';

export function distance(a, b) {
  const rad = n => n * Math.PI / 180;
  const dlat = rad(b.lat - a.lat), dlon = rad(b.lon - a.lon);
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2)));
}

export function validateImage(bytes, declaredSpherical = false) {
  const size = jpegDimensions(bytes);
  const xmp = bytes.toString('latin1');
  const field = key => xmp.match(new RegExp(`GPano:${key}=["']([^"']+)["']`))?.[1] ?? xmp.match(new RegExp(`<GPano:${key}>([^<]+)</GPano:${key}>`))?.[1];
  if (!declaredSpherical && field('ProjectionType') !== 'equirectangular') throw new Error('Missing spherical projection evidence');
  for (const [full, cropped] of [['FullPanoWidthPixels', 'CroppedAreaImageWidthPixels'], ['FullPanoHeightPixels', 'CroppedAreaImageHeightPixels']]) {
    if (field(full) && field(cropped) && field(full) !== field(cropped)) throw new Error('Cropped panorama');
  }
  if (size.width !== size.height * 2 || size.width < 2048) throw new Error('Expected full 2:1 JPEG, width >= 2048');
  return size;
}

async function request(url, json = true) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('HTTPS required');
  const response = await fetch(parsed, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'VirTourPanorama/1.0 (coordinate-based asset research)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} (${parsed.hostname})`);
  const limit = json ? 8 * 1024 ** 2 : 64 * 1024 ** 2;
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error('Response exceeds size limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  return json ? JSON.parse(bytes.toString()) : bytes;
}

async function commons(poi, radius) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', format: 'json', generator: 'geosearch', ggscoord: `${poi.lat}|${poi.lon}`, ggsradius: String(radius), ggsnamespace: '6', ggslimit: '50', prop: 'imageinfo|coordinates', colimit: 'max', iiprop: 'url|size|extmetadata' });
  const result = await request(url);
  if (result.error) throw new Error(result.error.info);
  return Object.values(result.query?.pages ?? {}).flatMap(page => {
    const info = page.imageinfo?.[0], coordinate = page.coordinates?.[0];
    if (!info || !coordinate || info.width !== info.height * 2) return [];
    return [{ platform: 'commons', id: String(page.pageid), url: info.url, source: info.descriptionurl, lat: coordinate.lat, lon: coordinate.lon, license: info.extmetadata?.LicenseShortName?.value, licenseUrl: info.extmetadata?.LicenseUrl?.value, author: info.extmetadata?.Artist?.value, spherical: false }];
  });
}

async function mapillary(poi, radius) {
  const token = process.env.MAPILLARY_ACCESS_TOKEN;
  if (!token) throw new Error('MAPILLARY_ACCESS_TOKEN is not configured');
  const dy = radius / 111320, dx = dy / Math.cos(poi.lat * Math.PI / 180);
  const url = new URL('https://graph.mapillary.com/images');
  url.search = new URLSearchParams({ access_token: token, bbox: [poi.lon - dx, poi.lat - dy, poi.lon + dx, poi.lat + dy].join(','), is_pano: 'true', fields: 'id,geometry,is_pano,thumb_original_url,captured_at', limit: '100' });
  const result = await request(url);
  if (result.error) throw new Error('Mapillary API rejected request');
  return (result.data ?? []).filter(p => p.is_pano && p.thumb_original_url && p.geometry?.coordinates).map(p => ({ platform: 'mapillary', id: p.id, url: p.thumb_original_url, source: `https://www.mapillary.com/app/?pKey=${p.id}&focus=photo`, lon: p.geometry.coordinates[0], lat: p.geometry.coordinates[1], spherical: true, license: 'CC-BY-SA-4.0', licenseUrl: 'https://www.mapillary.com/terms', capturedAt: p.captured_at }));
}

export async function crawl({ ids, platforms = ['commons', 'mapillary'], radius = 60, out = 'downloads/panoramas', sources, dryRun = false } = {}) {
  if (!Number.isFinite(radius) || radius < 1 || radius > 500) throw new Error('Radius must be 1..500 metres');
  if (platforms.some(p => !['commons', 'mapillary', 'manual'].includes(p))) throw new Error('Unknown platform');
  const catalog = JSON.parse(await readFile(new URL('../public/assets/park-catalog.json', import.meta.url)));
  const [w, s, e, n] = MAP_BBOX;
  const pois = catalog.entries.filter(p => p.position && (!ids || ids.includes(p.id))).map(p => ({ id: p.id, name: p.name, lat: n - p.position.y / 100 * (n - s), lon: w + p.position.x / 100 * (e - w) }));
  if (ids?.some(id => !pois.some(p => p.id === id))) throw new Error('Unknown POI or POI without verified coordinates');
  let manual = [];
  if (platforms.includes('manual')) {
    if (!sources) throw new Error('manual 模式需要 --sources <JSON文件>；自动按坐标搜索请使用 --platforms commons');
    try { manual = JSON.parse(await readFile(sources, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error(`找不到原图清单：${resolve(sources)}。请参照 sources.example.json 填入真实原图链接；自动搜索请使用 --platforms commons。`);
      throw error;
    }
    if (!Array.isArray(manual) || manual.length === 0) throw new Error('原图清单必须是非空 JSON 数组，请参照 sources.example.json');
    if (manual.some(item => !item || typeof item !== 'object' || typeof item.url !== 'string' || new URL(item.url).hostname === 'example.com')) throw new Error('原图清单含无效条目或示例链接，请填写真实 HTTPS 原图链接');
  }
  const report = { createdAt: new Date().toISOString(), radiusMeters: radius, dryRun, results: [] };
  await mkdir(resolve(out), { recursive: true });
  for (const poi of pois) {
    const row = { ...poi, platforms: [], candidates: [] };
    for (const platform of platforms) {
      if (dryRun) { row.platforms.push({ platform, status: 'planned' }); continue; }
      try {
        const candidates = platform === 'manual' ? manual.filter(p => p.poiId === poi.id) : await ({ commons, mapillary })[platform](poi, radius);
        row.platforms.push({ platform, status: 'ok', count: candidates.length, note: 'Bounded first page; not exhaustive' });
        for (const item of candidates) {
          const candidate = { ...item, platform, distanceMeters: distance(poi, item) };
          row.candidates.push(candidate);
          try {
            if (!Number.isFinite(candidate.distanceMeters) || candidate.distanceMeters > radius) throw new Error('Outside coordinate radius');
            if (!candidate.license || !candidate.source) throw new Error('Missing license or source');
            const bytes = await request(item.url, false);
            Object.assign(candidate, validateImage(bytes, item.spherical === true));
            candidate.sha256 = createHash('sha256').update(bytes).digest('hex');
            candidate.file = `${poi.id}-${candidate.sha256.slice(0, 16)}.jpg`;
            const path = resolve(out, candidate.file);
            await writeFile(`${path}.pending`, bytes);
            await rename(`${path}.pending`, path);
            candidate.status = 'downloaded-needs-visual-review';
          } catch (error) { candidate.status = 'rejected'; candidate.error = error.message; }
          delete candidate.url;
        }
      } catch (error) { row.platforms.push({ platform, status: 'error', error: error.message }); }
    }
    report.results.push(row);
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`${poi.id}: ${row.candidates.filter(p => p.file).length} downloaded`);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  try {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--dry-run') options.dryRun = true;
      else if (['--ids', '--platforms', '--radius', '--out', '--sources'].includes(arg)) {
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
        options[arg.slice(2)] = ['--ids', '--platforms'].includes(arg) ? value.split(',') : arg === '--radius' ? Number(value) : value;
      } else throw new Error(`Unknown option: ${arg}`);
    }
    await crawl(options);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
