/** Resolve native OSM API node references into the same geometry used by Overpass. */
export function withOsmGeometry(data) {
  if (!Array.isArray(data?.elements)) throw new TypeError('OSM_MAP_INVALID_DATA: expected elements.');
  const nodes = new Map(data.elements.filter(item => item.type === 'node').map(item => [item.id, item]));
  const ways = new Map(data.elements.filter(item => item.type === 'way').map(item => [item.id, item]));
  const geometry = way => {
    if (Array.isArray(way?.geometry)) return way.geometry;
    if (!Array.isArray(way?.nodes) || way.nodes.some(id => !nodes.has(id))) return [];
    return way.nodes.map(id => ({ lon: nodes.get(id).lon, lat: nodes.get(id).lat }));
  };
  return { ...data, elements: data.elements.map(item => {
    if (item.type === 'way') return { ...item, geometry: geometry(item) };
    if (item.type === 'relation') return { ...item, members: (item.members ?? []).map(member => member.type === 'way' ? { ...member, geometry: member.geometry ?? geometry(ways.get(member.ref)) } : member) };
    return item;
  }) };
}

/** Pure offline renderer for an Overpass `out geom` response. No requests or file writes. */
const SOURCE_URL = 'https://www.openstreetmap.org/copyright';
const LANDMARK_IDS = ['eiffel', 'arc', 'pyramid'];
const NAMES = {
  eiffel: /^(?:eiffeltower(?:replica)?|replicaoftheeiffeltower|[埃艾]菲[尔爾](?:铁塔|鐵塔)?(?:复制品|複製品|模型)?)$/,
  arc: /^(?:arcdetriomphe(?:replica)?|replicaofthearcdetriomphe|triumphalarch(?:replica)?|[凯凱]旋[门門](?:复制品|複製品|模型)?)$/,
  pyramid: /^(?:pyramidsofgiza(?:replica)?|pyramidofgiza(?:replica)?|gizapyramids?(?:replica)?|(?:吉萨|吉薩|埃及)(?:大)?金字塔(?:群|复制品|複製品|模型)?)$/,
};

const round = (value, digits = 4) => Number(value.toFixed(digits));
const xml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
const cleanName = value => String(value).toLowerCase().replace(/[\s_\-–—()（）\[\]【】,，.:：'’]/g, '');
const namesOf = element => ['name', 'name:en', 'name:zh'].map(key => element.tags?.[key]).filter(value => typeof value === 'string');
const validPoint = point => point && Number.isFinite(point.lon) && Number.isFinite(point.lat) && Math.abs(point.lon) <= 180 && Math.abs(point.lat) <= 90;
const samePoint = (a, b) => Math.abs(a.lon - b.lon) < 1e-10 && Math.abs(a.lat - b.lat) < 1e-10;
const closed = points => points.length > 3 && samePoint(points[0], points.at(-1));

function identity(element) { return `${element.type ?? 'element'}/${element.id ?? '?'}`; }
function landmarkId(element) {
  const matches = LANDMARK_IDS.filter(id => namesOf(element).some(name => NAMES[id].test(cleanName(name))));
  if (matches.length > 1) throw new Error(`OSM_MAP_CONFLICTING_NAMES: ${identity(element)} has names for multiple landmarks.`);
  return matches[0] ?? null;
}

function stitch(segments) {
  const remaining = segments.map(points => [...points]); const rings = [];
  while (remaining.length) {
    let chain = remaining.shift(); let extended = true;
    while (extended && !closed(chain)) {
      extended = false;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index]; let next;
        if (samePoint(chain.at(-1), candidate[0])) next = [...chain, ...candidate.slice(1)];
        else if (samePoint(chain.at(-1), candidate.at(-1))) next = [...chain, ...candidate.slice(0, -1).reverse()];
        else if (samePoint(chain[0], candidate.at(-1))) next = [...candidate.slice(0, -1), ...chain];
        else if (samePoint(chain[0], candidate[0])) next = [...candidate.slice(1).reverse(), ...chain];
        if (!next) continue;
        chain = next; remaining.splice(index, 1); extended = true; break;
      }
    }
    rings.push(chain);
  }
  return rings;
}

function geometryOf(element) {
  if (element.type === 'node') return validPoint(element) ? [{ points: [{ lon: element.lon, lat: element.lat }], role: 'outer' }] : [];
  if (Array.isArray(element.geometry)) {
    if (!element.geometry.length || !element.geometry.every(validPoint)) return [];
    return [{ points: element.geometry.map(point => ({ lon: point.lon, lat: point.lat })), role: 'outer' }];
  }
  if (element.type !== 'relation' || !Array.isArray(element.members)) return [];
  const paths = [];
  for (const role of ['outer', 'inner']) {
    const members = element.members.filter(member => member.type === 'way' && (member.role === role || (role === 'outer' && !member.role)));
    if (members.some(member => !Array.isArray(member.geometry) || !member.geometry.length || !member.geometry.every(validPoint))) return [];
    const segments = members.map(member => member.geometry.map(point => ({ lon: point.lon, lat: point.lat })));
    paths.push(...stitch(segments).map(points => ({ points, role })));
  }
  return paths;
}

function centerOf(paths) {
  let weightedLon = 0; let weightedLat = 0; let totalArea = 0;
  for (const { points, role } of paths) {
    if (!closed(points)) continue;
    // Subtract a local origin to retain precision for small park buildings.
    const origin = points[0]; let twiceArea = 0; let longitude = 0; let latitude = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = { lon: points[index].lon - origin.lon, lat: points[index].lat - origin.lat };
      const b = { lon: points[index + 1].lon - origin.lon, lat: points[index + 1].lat - origin.lat };
      const cross = a.lon * b.lat - b.lon * a.lat;
      twiceArea += cross; longitude += (a.lon + b.lon) * cross; latitude += (a.lat + b.lat) * cross;
    }
    if (Math.abs(twiceArea) < 1e-16) continue;
    const weight = Math.abs(twiceArea) * (role === 'inner' ? -1 : 1);
    weightedLon += (origin.lon + longitude / (3 * twiceArea)) * weight;
    weightedLat += (origin.lat + latitude / (3 * twiceArea)) * weight; totalArea += weight;
  }
  if (totalArea > 0) return { lon: weightedLon / totalArea, lat: weightedLat / totalArea };
  const points = paths.flatMap(path => closed(path.points) ? path.points.slice(0, -1) : path.points);
  return points.length ? { lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length, lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length } : null;
}

function inRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]; const b = ring[previous];
    const cross = (point.lon - a.lon) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lon - a.lon);
    if (Math.abs(cross) < 1e-12 && point.lon >= Math.min(a.lon, b.lon) - 1e-10 && point.lon <= Math.max(a.lon, b.lon) + 1e-10 && point.lat >= Math.min(a.lat, b.lat) - 1e-10 && point.lat <= Math.max(a.lat, b.lat) + 1e-10) return true;
    if ((a.lat > point.lat) !== (b.lat > point.lat) && point.lon < (b.lon - a.lon) * (point.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

function inPark(point, paths) {
  return paths.some(path => path.role !== 'inner' && closed(path.points) && inRing(point, path.points)) && !paths.some(path => path.role === 'inner' && closed(path.points) && inRing(point, path.points));
}

function layerOf(element) {
  const tags = element.tags ?? {};
  if (tags.building || tags['building:part']) return 'building';
  if (tags.natural === 'water' || tags.landuse === 'reservoir' || tags.waterway === 'riverbank') return 'water';
  if (tags.waterway) return 'stream';
  if (tags.highway) return 'road';
  if (tags.natural === 'tree') return 'tree';
  if (['wood', 'scrub', 'grassland', 'heath'].includes(tags.natural) || ['forest', 'grass', 'meadow', 'recreation_ground', 'village_green'].includes(tags.landuse) || ['park', 'garden', 'nature_reserve'].includes(tags.leisure)) return 'green';
  return null;
}

/**
 * @param {{elements: Array<object>}} overpassJson Overpass JSON produced with `out geom`.
 * @param {{bbox: [number, number, number, number]}} options west,south,east,north (WGS84).
 * @returns {{svg: string, positions: {eiffel:{x:number,y:number},arc:{x:number,y:number},pyramid:{x:number,y:number}}, sourceNote: string}}
 */
export function buildOsmMap(overpassJson, { bbox } = {}) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) throw new TypeError('OSM_MAP_INVALID_BBOX: provide [west,south,east,north].');
  const [west, south, east, north] = bbox;
  if (!(west < east && south < north && west >= -180 && east <= 180 && south > -85 && north < 85)) throw new RangeError('OSM_MAP_INVALID_BBOX: bounds must be ordered WGS84 coordinates, excluding polar regions.');
  if (!Array.isArray(overpassJson?.elements)) throw new TypeError('OSM_MAP_INVALID_DATA: expected an Overpass response with elements.');
  const inBounds = point => point.lon >= west - 1e-10 && point.lon <= east + 1e-10 && point.lat >= south - 1e-10 && point.lat <= north + 1e-10;
  const features = withOsmGeometry(overpassJson).elements.map(element => ({ element, paths: geometryOf(element) }));
  const parkBoundaries = features.filter(({ element, paths }) => element.tags?.tourism === 'theme_park' && namesOf(element).some(name => /^(?:深圳)?世界之窗$|^windowsoftheworld$|^windowoftheworld$/.test(cleanName(name))) && paths.some(path => path.role !== 'inner' && closed(path.points)));
  if (parkBoundaries.length > 1) throw new Error('OSM_MAP_AMBIGUOUS_PARK: multiple Window of the World boundaries; use a park-scoped response.');
  const parkPaths = parkBoundaries[0]?.paths;
  const candidates = Object.fromEntries(LANDMARK_IDS.map(id => [id, []]));
  const rejected = [];
  for (const { element, paths } of features) {
    const id = landmarkId(element);
    if (!id) continue;
    const center = centerOf(paths);
    const points = paths.flatMap(path => path.points);
    if (!center || !points.length || !points.every(inBounds) || !inBounds(center) || (parkPaths && !inPark(center, parkPaths))) { rejected.push(`${id} (${identity(element)}: missing geometry or outside the supplied park bounds)`); continue; }
    candidates[id].push({ center, element });
  }
  const missing = LANDMARK_IDS.filter(id => !candidates[id].length);
  if (missing.length) throw new Error(`OSM_MAP_MISSING_POI: cannot verify ${missing.join(', ')} from name/name:en/name:zh and in-park geometry. No coordinates were guessed.${rejected.length ? ` Rejected: ${rejected.join('; ')}.` : ''}`);
  for (const id of ['eiffel', 'arc']) {
    const points = candidates[id];
    if (points.some(point => !samePoint(point.center, points[0].center))) throw new Error(`OSM_MAP_AMBIGUOUS_POI: multiple distinct ${id} landmarks inside bounds (${points.map(point => identity(point.element)).join(', ')}).`);
  }

  const percentage = point => ({ x: round((point.lon - west) / (east - west) * 100), y: round((north - point.lat) / (north - south) * 100) });
  const positions = Object.fromEntries(LANDMARK_IDS.map(id => {
    const group = candidates[id];
    const center = { lon: group.reduce((sum, point) => sum + point.center.lon, 0) / group.length, lat: group.reduce((sum, point) => sum + point.center.lat, 0) / group.length };
    return [id, percentage(center)];
  }));
  const width = 1200;
  const height = Math.max(1, round(width * (north - south) / ((east - west) * Math.cos((south + north) / 2 * Math.PI / 180)), 3));
  const project = point => { const percent = percentage(point); return `${round(percent.x * width / 100, 3)} ${round(percent.y * height / 100, 3)}`; };
  const pathData = paths => paths.map(({ points }) => points.length > 1 ? `M${points.map(project).join(' L')}${closed(points) ? ' Z' : ''}` : '').filter(Boolean).join(' ');
  const layers = { green: [], water: [], stream: [], road: [], building: [], tree: [] };
  for (const { element, paths } of features) {
    const layer = layerOf(element);
    if (!layer || !paths.length) continue;
    const allPoints = paths.flatMap(path => path.points);
    const minLon = Math.min(...allPoints.map(point => point.lon)); const maxLon = Math.max(...allPoints.map(point => point.lon));
    const minLat = Math.min(...allPoints.map(point => point.lat)); const maxLat = Math.max(...allPoints.map(point => point.lat));
    if (maxLon < west || minLon > east || maxLat < south || minLat > north) continue;
    const title = xml(namesOf(element)[0] ?? `${layer} ${identity(element)}`);
    const data = pathData(paths);
    const label = `<title>${title}</title>`;
    if (layer === 'tree') {
      const [cx, cy] = project(allPoints[0]).split(' ');
      layers.tree.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="#cbd9c3">${label}</circle>`);
    } else if (data) {
      if (layer === 'green' || layer === 'water' || layer === 'building') {
        if (!paths.some(path => closed(path.points))) continue;
        const colors = { green: ['#e1e8dc', 'none'], water: ['#d7e7ed', '#cbdfe7'], building: ['#e3dfd7', '#cecac1'] };
        layers[layer].push(`<path d="${data}" fill="${colors[layer][0]}" stroke="${colors[layer][1]}" stroke-width="1" fill-rule="evenodd">${label}</path>`);
      } else if (layer === 'stream') layers.stream.push(`<path d="${data}" fill="none" stroke="#d2e4eb" stroke-width="7" stroke-linecap="round">${label}</path>`);
      else {
        const footway = ['footway', 'path', 'pedestrian', 'steps', 'cycleway'].includes(element.tags.highway);
        const thickness = footway ? 4 : 10;
        layers.road.push(`<g>${label}<path d="${data}" fill="none" stroke="#d7ddd2" stroke-width="${thickness + 2}" stroke-linecap="round" stroke-linejoin="round"/><path d="${data}" fill="none" stroke="#fdfdfb" stroke-width="${thickness}" stroke-linecap="round" stroke-linejoin="round"/></g>`);
      }
    }
  }
  const parkShape = parkPaths ? pathData(parkPaths) : null;
  const parkClip = parkShape ? `<clipPath id="osm-park-shape"><path d="${parkShape}" clip-rule="evenodd"/></clipPath>` : '';
  const boundaryOverlay = parkShape ? `<path id="park-boundary" d="${parkShape}" fill="none" stroke="#83a68b" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : '';
  const sourceNote = `© OpenStreetMap contributors · ODbL 1.0 · ${SOURCE_URL} · Static SVG derived from supplied OSM/Overpass geometry; no tile images used.`;
  // Attribution is shown once by mapMarkup, outside the transformed artwork.
  // Keep provenance in the exported SVG description, without a baked-in footer.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="osm-map-title osm-map-desc"><title id="osm-map-title">世界之窗 · OpenStreetMap 地理示意地图</title><desc id="osm-map-desc">${xml(sourceNote)}</desc><defs><clipPath id="osm-map-bounds"><rect width="${width}" height="${height}"/></clipPath>${parkClip}</defs><g clip-path="url(#osm-map-bounds)"><g${parkShape ? ' clip-path="url(#osm-park-shape)"' : ''}>${Object.values(layers).flat().join('')}</g>${boundaryOverlay}</g></svg>`;

  return { svg, positions, sourceNote, poiSources: Object.fromEntries(LANDMARK_IDS.map(id => [id, candidates[id].map(({ element }) => ({ type: element.type, id: element.id, name: namesOf(element)[0] }))])) };
}

/** Verified attraction anchors, excluding features outside the park boundary. */
export function osmAttractions(data, bbox) {
  const elements = withOsmGeometry(data).elements;
  const boundary = elements.find(item => item.type === 'way' && item.id === 236402460);
  if (!boundary) throw new Error('Park boundary missing');
  const paths = geometryOf(boundary);
  const [west, south, east, north] = bbox;
  return elements.filter(item => ['attraction', 'artwork', 'museum'].includes(item.tags?.tourism)).flatMap(item => {
    const center = centerOf(geometryOf(item));
    if (!center || !inPark(center, paths)) return [];
    return [{ osmId: item.id, osmType: item.type, name: item.tags?.name, position: {
      x: round((center.lon - west) / (east - west) * 100), y: round((north - center.lat) / (north - south) * 100),
    }, source: `https://www.openstreetmap.org/${item.type}/${item.id}` }];
  });
}

/** Facilities use actual geometry; internal gates and nearby city amenities are excluded. */
export function osmParkServices(data, bbox) {
  const elements = withOsmGeometry(data).elements;
  const park = elements.find(item => item.type === 'way' && item.id === 236402460);
  const paths = park && geometryOf(park);
  if (!paths?.some(path => closed(path.points))) throw new Error('Park boundary missing or incomplete');
  const [west, south, east, north] = bbox;
  const percentage = point => ({ x:round((point.lon-west)/(east-west)*100), y:round((north-point.lat)/(north-south)*100) });
  const boundary = { source:'https://www.openstreetmap.org/way/236402460', rings:paths.map(path => path.points.map(percentage)) };
  if (boundary.rings.flat().some(p => p.x<0 || p.x>100 || p.y<0 || p.y>100)) throw new Error('Map bbox clips the park boundary');
  const facilities = elements.flatMap(item => {
    const tags = item.tags ?? {};
    if (['private','no'].includes(tags.access) || tags.foot === 'no') return [];
    const center = centerOf(geometryOf(item));
    if (!center || !inPark(center, paths)) return [];
    let kind;
    if (tags.amenity === 'toilets') kind = 'toilets';
    else if (['restaurant','cafe','fast_food','food_court'].includes(tags.amenity)) kind = 'food';
    else if (tags.tourism === 'information' && ['office','visitor_centre'].includes(tags.information)) kind = 'service';
    else if (tags.amenity === 'parking') kind = 'parking';
    else if (item.type === 'node' && park.nodes?.includes(item.id) && (tags.barrier === 'gate' || tags.entrance)) kind = 'gate';
    if (!kind) return [];
    const names = {toilets:'卫生间',food:'餐饮点',service:'游客服务点',parking:'停车场',gate:'园界门'};
    return [{id:`${item.type}-${item.id}`,kind,name:tags['name:zh'] ?? tags.name ?? names[kind],position:percentage(center),coordinates:center,
      source:`https://www.openstreetmap.org/${item.type}/${item.id}`,sourceKind:'OpenStreetMap 地点记录',
      note:kind === 'gate' ? '园界上的门；是否供游客进出、当前是否开放尚未核实。离园请按现场出口路牌或询问工作人员。' : '公开地图记录的位置，开放情况以现场为准。设施记录尚不完整。',
      accessVerified:false,updatedAt:item.timestamp ?? null}];
  });
  return {boundary,facilities};
}
