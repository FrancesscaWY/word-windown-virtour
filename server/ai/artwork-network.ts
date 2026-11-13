import { artworkRoads } from '../../src/data/artwork-roads.js';

interface Point { id: number; x: number; y: number }
interface Edge { to: number; roadId: string; pixels: number }
interface ArtworkData {
  artwork: { width: number; height: number };
  sourceSha256: string;
  nodes: Point[];
  roads: { id: string; nodeIds: number[] }[];
  anchors: Record<string, number>;
}
export interface ArtworkGraph {
  nodes: Map<number, Point>;
  edges: Map<number, Edge[]>;
  anchors: Record<string, number>;
}

export function buildArtworkGraph(data: ArtworkData): ArtworkGraph {
  const nodes = new Map(data.nodes.map(node => [node.id, node])), edges = new Map<number, Edge[]>();
  const add = (from: number, edge: Edge) => { if (!edges.has(from)) edges.set(from, []); edges.get(from)!.push(edge); };
  for (const road of data.roads) for (let i = 1; i < road.nodeIds.length; i++) {
    const a = nodes.get(road.nodeIds[i - 1]), b = nodes.get(road.nodeIds[i]);
    if (!a || !b) throw new Error('Incomplete illustration road');
    const pixels = Math.hypot((b.x - a.x) * data.artwork.width / 100, (b.y - a.y) * data.artwork.height / 100);
    add(a.id, { to: b.id, roadId: road.id, pixels }); add(b.id, { to: a.id, roadId: road.id, pixels });
  }
  return { nodes, edges, anchors: data.anchors };
}

/** Pixel weights select a path on the illustration; they are never real-world meters. */
export function shortestArtworkPath(graph: ArtworkGraph, start: number, end: number) {
  if (!graph.nodes.has(start) || !graph.nodes.has(end)) return null;
  const distances = new Map([[start, 0]]), previous = new Map<number, { from: number; edge: Edge }>();
  const pending = new Set([start]), done = new Set<number>();
  while (pending.size) {
    let current = -1, best = Infinity;
    for (const id of pending) if (distances.get(id)! < best) { current = id; best = distances.get(id)!; }
    pending.delete(current);
    if (current === end) {
      const nodes = [end], edges: Edge[] = [];
      while (nodes.at(-1) !== start) { const p = previous.get(nodes.at(-1)!)!; nodes.push(p.from); edges.push(p.edge); }
      return { nodes: nodes.reverse(), edges: edges.reverse() };
    }
    done.add(current);
    for (const edge of graph.edges.get(current) ?? []) {
      if (done.has(edge.to)) continue;
      const next = best + edge.pixels;
      if (next < (distances.get(edge.to) ?? Infinity)) { distances.set(edge.to, next); previous.set(edge.to, { from: current, edge }); pending.add(edge.to); }
    }
  }
  return null;
}

export function artworkPosition(graph: ArtworkGraph, id: number) {
  const { x, y } = graph.nodes.get(id)!;
  return { x, y };
}
let cached: { graph: ArtworkGraph; sha256: string } | null = null;
export function artworkNetwork() {
  return cached ??= { graph: buildArtworkGraph(artworkRoads), sha256: artworkRoads.sourceSha256 };
}
