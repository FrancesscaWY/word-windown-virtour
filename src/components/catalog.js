import { pois } from '../data/pois.js';
import { escapeHTML as esc } from './html.js';
export function searchPois(query = '', region = '') {
  const text = query.trim().toLowerCase();
  return pois.filter(poi => (!region || poi.region === region) && [poi.name, poi.region, ...poi.aliases].some(value => value.toLowerCase().includes(text)));
}
export function catalogResults(query, region) {
  const results = searchPois(query, region);
  return { count: results.length, html: results.map(poi => `<button type="button" class="catalog-row" data-catalog-poi="${poi.id}"><span><strong>${esc(poi.name)}</strong><small>${esc(poi.region)} · ${poi.position ? '位置已核对' : '位置待核对'}</small></span><span class="catalog-media">${poi.panorama ? (poi.panoramaKind === 'illustration' ? '示例全景' : '360° 全景') : poi.photo ? '园区实拍' : '景点资料'} ›</span></button>`).join('') || '<p>还没找到。换个名字试试？</p>' };
}
