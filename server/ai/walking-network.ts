import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { externalAssets } from '../../src/data/external-assets.js';

type Tags = Record<string, string>;
export interface OsmNode { type: 'node'; id: number; lon: number; lat: number; tags?: Tags }
export interface OsmWay { type: 'way'; id: number; nodes: number[]; tags?: Tags }
export interface Position { x: number; y: number }
interface Edge { to: number; wayId: number; meters: number; steps: boolean; gate: boolean }
export interface WalkingGraph {
  nodes: Map<number, OsmNode>;
  edges: Map<number, Edge[]>;
  bbox: number[];
}
export interface RoadPath { nodes: number[]; edges: Edge[]; meters: number }
const forbidden = new Set(['no', 'private']);
const footAllowed = (tags: Tags = {}) => !forbidden.has(tags.foot ?? tags.access ?? '');
const passableNode = (node: OsmNode) => footAllowed(node.tags) && node.tags?.locked !== 'yes' && (!['wall', 'fence', 'hedge', 'retaining_wall'].includes(node.tags?.barrier ?? '') || ['yes', 'designated', 'permissive'].includes(node.tags?.foot ?? ''));

export function distanceMeters(a: Pick<OsmNode, 'lon' | 'lat'>, b: Pick<OsmNode, 'lon' | 'lat'>) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat-a.lat)*r/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1,h)));
}
const cross = (a: OsmNode, b: OsmNode, p: OsmNode) => (b.lon-a.lon)*(p.lat-a.lat)-(b.lat-a.lat)*(p.lon-a.lon);
function inside(point: OsmNode, ring: OsmNode[]) {
  let yes = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if (Math.abs(cross(a,b,point)) < 1e-12 && point.lon >= Math.min(a.lon,b.lon)-1e-10 && point.lon <= Math.max(a.lon,b.lon)+1e-10 && point.lat >= Math.min(a.lat,b.lat)-1e-10 && point.lat <= Math.max(a.lat,b.lat)+1e-10) return true;
    if ((a.lat>point.lat)!==(b.lat>point.lat) && point.lon<(b.lon-a.lon)*(point.lat-a.lat)/(b.lat-a.lat)+a.lon) yes=!yes;
  }
  return yes;
}

function staysInside(a: OsmNode, b: OsmNode, ring: OsmNode[]) {
  // Split at every boundary intersection, including vertices. A midpoint alone
  // misses short excursions across a concave boundary or a narrow notch.
  const cuts = [0, 1], dx = b.lon - a.lon, dy = b.lat - a.lat;
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i - 1], q = ring[i], sx = q.lon - p.lon, sy = q.lat - p.lat;
    const denominator = dx * sy - dy * sx;
    if (Math.abs(denominator) < 1e-18) continue;
    const px = p.lon - a.lon, py = p.lat - a.lat;
    const t = (px * sy - py * sx) / denominator, u = (px * dy - py * dx) / denominator;
    if (t > 0 && t < 1 && u >= -1e-10 && u <= 1 + 1e-10) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  return cuts.slice(1).every((end, i) => {
    const t = (end + cuts[i]) / 2;
    return inside({ ...a, lon: a.lon + dx * t, lat: a.lat + dy * t }, ring);
  });
}

/** Only actual shared OSM nodes join roads. Crossings and nearby endpoints never create edges. */
export function buildWalkingGraph(data: { elements: unknown[] }, bbox: number[], boundaryId = 236402460): WalkingGraph {
  const elements = data.elements as (OsmNode | OsmWay)[];
  const nodes = new Map(elements.filter((e): e is OsmNode => e.type === 'node' && Number.isFinite(e.lon) && Number.isFinite(e.lat)).map(n => [n.id,n]));
  const boundary = elements.find((e): e is OsmWay => e.type === 'way' && e.id === boundaryId);
  if (!boundary || boundary.nodes.some(id => !nodes.has(id))) throw new Error('OSM park boundary is incomplete');
  const ring = boundary.nodes.map(id => nodes.get(id)!);
  if (ring.length < 4 || ring[0].id !== ring.at(-1)!.id) throw new Error('OSM park boundary is not closed');
  const inPark = new Map([...nodes].map(([id,n]) => [id,inside(n,ring)]));
  const edges = new Map<number, Edge[]>();
  const add = (from: number, edge: Edge) => { if (!edges.has(from)) edges.set(from,[]); edges.get(from)!.push(edge); if (!edges.has(edge.to)) edges.set(edge.to,[]); };
  for (const way of elements) {
    const tags=way.tags ?? {};
    if (way.type !== 'way' || !['footway','path','pedestrian','steps','service','living_street'].includes(tags.highway) || tags.area === 'yes' || !footAllowed(tags) || tags.construction || tags.proposed) continue;
    for (let i=1;i<way.nodes.length;i++) {
      const a=nodes.get(way.nodes[i-1]),b=nodes.get(way.nodes[i]);
      if (!a || !b || a.id===b.id || !inPark.get(a.id) || !inPark.get(b.id) || !passableNode(a) || !passableNode(b)) continue;
      if (!staysInside(a,b,ring)) continue;
      const edge={wayId:way.id,meters:distanceMeters(a,b),steps:tags.highway==='steps',gate:[a,b].some(n=>['gate','lift_gate','kissing_gate'].includes(n.tags?.barrier ?? ''))};
      const oneWay=tags['oneway:foot'];
      if (oneWay !== '-1' && !forbidden.has(tags['foot:forward'])) add(a.id,{...edge,to:b.id});
      if (!['yes','1','true'].includes(oneWay) && !forbidden.has(tags['foot:backward'])) add(b.id,{...edge,to:a.id});
    }
  }
  return {nodes:new Map([...nodes].filter(([id])=>edges.has(id))),edges,bbox};
}

export function roadPosition(graph: WalkingGraph, id: number): Position {
  const n=graph.nodes.get(id)!; const [west,south,east,north]=graph.bbox;
  return {x:(n.lon-west)/(east-west)*100,y:(north-n.lat)/(north-south)*100};
}

/** A nearby road anchor is not an entrance. Never add a straight connector to the POI. */
export function nearestRoadNode(graph: WalkingGraph, position: Position, maxMeters=100) {
  const [west,south,east,north]=graph.bbox;
  const geo={lon:west+position.x/100*(east-west),lat:north-position.y/100*(north-south)};
  let best: {nodeId:number; offsetMeters:number} | null=null;
  for (const node of graph.nodes.values()) {
    const meters=distanceMeters(geo,node);
    if (meters <= maxMeters && (!best || meters<best.offsetMeters)) best={nodeId:node.id,offsetMeters:meters};
  }
  return best;
}

export function shortestRoadPath(graph: WalkingGraph, start: number, end: number): RoadPath | null {
  if (!graph.nodes.has(start) || !graph.nodes.has(end)) return null;
  const distances=new Map([[start,0]]), previous=new Map<number,{from:number;edge:Edge}>();
  const pending=new Set([start]), done=new Set<number>();
  while(pending.size) {
    let current=-1, best=Infinity;
    for(const id of pending) if(distances.get(id)!<best) {current=id;best=distances.get(id)!;}
    pending.delete(current);
    if(current===end) {
      const nodes=[end],edges:Edge[]=[];
      while(nodes[0]!==start) {const p=previous.get(nodes[0])!; nodes.unshift(p.from);edges.unshift(p.edge);}
      return {nodes,edges,meters:best};
    }
    done.add(current);
    for(const edge of graph.edges.get(current) ?? []) {
      if(done.has(edge.to)) continue;
      const next=best+edge.meters;
      if(next<(distances.get(edge.to) ?? Infinity)) {distances.set(edge.to,next);previous.set(edge.to,{from:current,edge});pending.add(edge.to);}
    }
  }
  return null;
}

let cached: {graph:WalkingGraph;sha256:string} | null=null;
export function walkingNetwork() {
  if (!cached) {
    const bytes=readFileSync(new URL('../../public/assets/world-window-osm-source.json',import.meta.url));
    cached={graph:buildWalkingGraph(JSON.parse(bytes.toString()),externalAssets.map.bbox),sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  return cached;
}
