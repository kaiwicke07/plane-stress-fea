// Delaunay triangulation by Bowyer–Watson incremental insertion.
// Background: docs/math/08-meshing.md.
//
// Triangles are stored as vertex triples with neighbour triples, where
// neighbour i is the triangle across the edge opposite vertex i. Each point
// is located by walking across triangles toward it, then the "cavity" of
// triangles whose circumcircle contains it is found by searching neighbours,
// removed, and re-filled with triangles fanning from the new point.

/** Twice the signed area of (a, b, c): positive when counter-clockwise. */
function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Side of edge a→b that point (px, py) is on, evaluated in a fixed vertex order.
 * In floating point orient(a, b, p) is not exactly −orient(b, a, p), so for a
 * point almost on an edge, both triangles sharing it could each say "outside".
 * Computing with the lower index first makes the two sides exact negatives.
 */
function side(xs: Float64Array, ys: Float64Array, a: number, b: number, px: number, py: number): number {
  return a < b
    ? orient(xs[a], ys[a], xs[b], ys[b], px, py)
    : -orient(xs[b], ys[b], xs[a], ys[a], px, py);
}

/** Positive when d lies strictly inside the circumcircle of counter-clockwise (a, b, c). */
function inCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const [adx, ady, bdx, bdy, cdx, cdy] = [ax - dx, ay - dy, bx - dx, by - dy, cx - dx, cy - dy];
  const ad = adx * adx + ady * ady;
  const bd = bdx * bdx + bdy * bdy;
  const cd = cdx * cdx + cdy * cdy;
  return adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
}

/**
 * Delaunay triangulation of the points [x0, y0, x1, y1, ...]. Returns
 * counter-clockwise vertex triples covering the convex hull. Exact duplicate
 * points are skipped (they appear in no triangle).
 */
export function delaunay(points: Float64Array): Uint32Array {
  const n = points.length / 2;
  if (n < 3) return new Uint32Array();

  // Work in normalised coordinates (centred, unit size) for better conditioning.
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, points[2 * i]);
    maxX = Math.max(maxX, points[2 * i]);
    minY = Math.min(minY, points[2 * i + 1]);
    maxY = Math.max(maxY, points[2 * i + 1]);
  }
  const scale = Math.max(maxX - minX, maxY - minY) || 1;
  const [ox, oy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const xs = new Float64Array(n + 3);
  const ys = new Float64Array(n + 3);
  for (let i = 0; i < n; i++) {
    xs[i] = (points[2 * i] - ox) / scale;
    ys[i] = (points[2 * i + 1] - oy) / scale;
  }
  // Super-triangle containing [−½, ½]². Its vertices must be far away: the
  // circumcircle of a triangle with a super vertex bulges past the hull edge by
  // about ℓ²/8R, and points inside that bulge would be wrongly joined to the
  // super vertex, leaving gaps along the hull once super triangles are removed.
  const far = 1e4;
  xs.set([-far, far, 0], n);
  ys.set([-far, -far, far], n);

  const mesh = new TriangleStore(4 * n + 8);
  let last = mesh.add(n, n + 1, n + 2, -1, -1, -1);

  const cavity: number[] = [];
  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const edgeOut: number[] = [];

  for (const p of insertionOrder(xs, ys, n)) {
    const px = xs[p];
    const py = ys[p];
    const t0 = locate(mesh, xs, ys, last, px, py);

    const [v0, v1, v2] = mesh.vertices(t0);
    if ([v0, v1, v2].some((v) => xs[v] === px && ys[v] === py)) continue; // duplicate point

    // Cavity: all triangles whose circumcircle contains p. They form a connected set.
    const stamp = p + 1;
    cavity.length = 0;
    cavity.push(t0);
    mesh.mark[t0] = stamp;
    for (let k = 0; k < cavity.length; k++) {
      const t = cavity[k];
      for (let i = 0; i < 3; i++) {
        const nb = mesh.nb[3 * t + i];
        if (nb < 0 || mesh.mark[nb] === stamp) continue;
        const a = mesh.v[3 * nb];
        const b = mesh.v[3 * nb + 1];
        const c = mesh.v[3 * nb + 2];
        if (inCircle(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c], px, py) > 0) {
          mesh.mark[nb] = stamp;
          cavity.push(nb);
        }
      }
    }

    // Cavity boundary, as counter-clockwise edges a→b with the triangle outside
    // them. Each new triangle (a, b, p) must have positive area, i.e. p strictly
    // left of a→b. Round-off (or p exactly on an edge, as with collinear boundary
    // points) can break that; absorb the triangle across such an edge and retry.
    for (;;) {
      edgeA.length = edgeB.length = edgeOut.length = 0;
      let grown = false;
      for (let k = 0; k < cavity.length && !grown; k++) {
        const t = cavity[k];
        for (let i = 0; i < 3; i++) {
          const nb = mesh.nb[3 * t + i];
          if (nb >= 0 && mesh.mark[nb] === stamp) continue;
          const a = mesh.v[3 * t + ((i + 1) % 3)];
          const b = mesh.v[3 * t + ((i + 2) % 3)];
          if (nb >= 0 && side(xs, ys, a, b, px, py) <= 0) {
            mesh.mark[nb] = stamp;
            cavity.push(nb);
            grown = true;
            break;
          }
          edgeA.push(a);
          edgeB.push(b);
          edgeOut.push(nb);
        }
      }
      if (!grown) break;
    }

    // Replace the cavity with a fan of triangles (a, b, p), reusing freed slots.
    for (const t of cavity) mesh.remove(t);
    const created = edgeA.map((a, k) => mesh.add(a, edgeB[k], p, -1, -1, edgeOut[k]));
    for (let k = 0; k < created.length; k++) {
      const t = created[k];
      const [a, b] = [edgeA[k], edgeB[k]];
      // Across edge (b, p): the new triangle starting at b. Across (p, a): the one ending at a.
      mesh.nb[3 * t] = created[edgeA.indexOf(b)];
      mesh.nb[3 * t + 1] = created[edgeB.indexOf(a)];
      const out = edgeOut[k];
      if (out >= 0) {
        for (let j = 0; j < 3; j++) {
          const w = mesh.v[3 * out + j];
          if (w !== a && w !== b) mesh.nb[3 * out + j] = t;
        }
      }
    }
    last = created[0];
  }

  // Keep triangles that do not touch the super-triangle.
  const out: number[] = [];
  for (let t = 0; t < mesh.count; t++) {
    if (!mesh.alive[t]) continue;
    const [a, b, c] = mesh.vertices(t);
    if (a < n && b < n && c < n) out.push(a, b, c);
  }
  return Uint32Array.from(out);
}

/** Walks from `start` toward (px, py); falls back to a scan if the walk stalls. */
function locate(mesh: TriangleStore, xs: Float64Array, ys: Float64Array, start: number, px: number, py: number): number {
  let t = start;
  for (let steps = 0; steps < mesh.count + 10; steps++) {
    let moved = false;
    for (let i = 0; i < 3; i++) {
      const a = mesh.v[3 * t + ((i + 1) % 3)];
      const b = mesh.v[3 * t + ((i + 2) % 3)];
      if (side(xs, ys, a, b, px, py) < 0) {
        const nb = mesh.nb[3 * t + i];
        if (nb >= 0) {
          t = nb;
          moved = true;
          break;
        }
      }
    }
    if (!moved) return t;
  }
  for (let s = 0; s < mesh.count; s++) {
    if (!mesh.alive[s]) continue;
    const [a, b, c] = mesh.vertices(s);
    if (side(xs, ys, a, b, px, py) >= 0 && side(xs, ys, b, c, px, py) >= 0 && side(xs, ys, c, a, px, py) >= 0) {
      return s;
    }
  }
  throw new Error('Delaunay: point location failed');
}

/**
 * Points sorted into horizontal bands, alternating direction ("snake"), so
 * consecutive insertions are close together and the walk stays short.
 */
function insertionOrder(xs: Float64Array, ys: Float64Array, n: number): number[] {
  const bands = Math.max(1, Math.round(Math.sqrt(n / 4)));
  const key = (i: number) => Math.min(bands - 1, Math.floor((ys[i] + 0.5) * bands));
  return Array.from({ length: n }, (_, i) => i).sort((i, j) => {
    const bi = key(i);
    const bj = key(j);
    if (bi !== bj) return bi - bj;
    return bi % 2 === 0 ? xs[i] - xs[j] : xs[j] - xs[i];
  });
}

/** Growable triangle arrays with a free list for removed slots. */
class TriangleStore {
  v: Int32Array;
  nb: Int32Array;
  alive: Uint8Array;
  mark: Int32Array;
  count = 0;
  private free: number[] = [];

  constructor(capacity: number) {
    this.v = new Int32Array(3 * capacity);
    this.nb = new Int32Array(3 * capacity);
    this.alive = new Uint8Array(capacity);
    this.mark = new Int32Array(capacity);
  }

  vertices(t: number): [number, number, number] {
    return [this.v[3 * t], this.v[3 * t + 1], this.v[3 * t + 2]];
  }

  add(a: number, b: number, c: number, nbA: number, nbB: number, nbC: number): number {
    const t = this.free.pop() ?? this.count++;
    if (t >= this.alive.length) this.grow();
    this.v.set([a, b, c], 3 * t);
    this.nb.set([nbA, nbB, nbC], 3 * t);
    this.alive[t] = 1;
    this.mark[t] = 0;
    return t;
  }

  remove(t: number): void {
    this.alive[t] = 0;
    this.free.push(t);
  }

  private grow(): void {
    const capacity = 2 * this.alive.length;
    const grow32 = (old: Int32Array, size: number) => {
      const next = new Int32Array(size);
      next.set(old);
      return next;
    };
    this.v = grow32(this.v, 3 * capacity);
    this.nb = grow32(this.nb, 3 * capacity);
    this.mark = grow32(this.mark, capacity);
    const alive = new Uint8Array(capacity);
    alive.set(this.alive);
    this.alive = alive;
  }
}
