// Bowyer–Watson triangulation. The source mesh is generated offline, shared by
// every display layer, and checked for foldovers before any asset is written.
export function triangulate(input) {
  const points = [...input, [-1000, -1000], [2000, -1000], [500, 2000]];
  const size = input.length;
  let triangles = [[size, size + 1, size + 2]];
  const circle = ([ia, ib, ic]) => {
    const [ax, ay] = points[ia], [bx, by] = points[ib], [cx, cy] = points[ic];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-10) return null;
    const a = ax * ax + ay * ay, b = bx * bx + by * by, c = cx * cx + cy * cy;
    const x = (a * (by - cy) + b * (cy - ay) + c * (ay - by)) / d;
    const y = (a * (cx - bx) + b * (ax - cx) + c * (bx - ax)) / d;
    return { x, y, radius: (x - ax) ** 2 + (y - ay) ** 2 };
  };
  for (let index = 0; index < size; index++) {
    const [x, y] = points[index];
    const bad = triangles.filter(t => { const c = circle(t); return c && (x - c.x) ** 2 + (y - c.y) ** 2 < c.radius + 1e-9; });
    const edges = new Map();
    for (const [a, b, c] of bad) for (const edge of [[a, b], [b, c], [c, a]]) {
      const key = [...edge].sort((a, b) => a - b).join(',');
      if (edges.has(key)) edges.delete(key); else edges.set(key, edge);
    }
    triangles = triangles.filter(t => !bad.includes(t));
    for (const [a, b] of edges.values()) triangles.push([a, b, index]);
  }
  return triangles.filter(t => t.every(i => i < size));
}
