// DistMesh (Persson & Strang, 2004): unstructured triangle meshing of a region
// given by a signed distance function. Background: docs/math/08-meshing.md.
//
// Mesh edges act as springs that only push (never pull), with rest lengths set
// by the size function. Points move until the forces balance; points that leave
// the region are projected back onto the boundary along the distance gradient.

import { delaunay } from './delaunay';
import { distanceToCurve, fixedPoints, type Region, regionBounds, regionCurves, signedDistance } from './geometry';
import type { TaggedMesh } from './tagged-mesh';

export interface DistMeshOptions {
  /** Target element edge length at (x, y), mm. */
  size: (x: number, y: number) => number;
  /** Smallest value of `size` over the region, mm. Sets the initial point spacing. */
  hMin: number;
  maxIterations?: number;
  /** Seed for the initial point thinning, so meshes are reproducible. */
  seed?: number;
}

export interface DistMeshResult {
  mesh: TaggedMesh;
  iterations: number;
  retriangulations: number;
  converged: boolean;
}

// Persson & Strang's default parameters.
const F_SCALE = 1.2; // springs 20% longer than the target, so they push outward
const DELTA_T = 0.2; // pseudo-time step
const D_P_TOL = 1e-3; // stop when interior points move less than this × local size
const T_TOL = 0.1; // re-triangulate after a point moves this × local size

export function distmesh(region: Region, options: DistMeshOptions): DistMeshResult {
  // Stopping early leaves occasional slivers; converged meshes have min angles > 30°.
  const { size, hMin: h0, maxIterations = 1000 } = options;
  const geps = 1e-3 * h0;
  const deps = Math.sqrt(Number.EPSILON) * h0;
  const sdf = (x: number, y: number) => signedDistance(region, x, y);
  const rand = lcg(options.seed ?? 1);

  // 1. Fixed corner points, then an equilateral grid thinned to the size function.
  const fixed = fixedPoints(region, 10 * geps);
  const nFixed = fixed.length;
  const xs: number[] = fixed.map((p) => p[0]);
  const ys: number[] = fixed.map((p) => p[1]);

  const box = regionBounds(region);
  const candidates: [number, number, number][] = [];
  let maxAcceptance = 0;
  const dy = (h0 * Math.sqrt(3)) / 2;
  for (let j = 0, y = box.minY; y <= box.maxY + geps; j++, y = box.minY + j * dy) {
    for (let x = box.minX + (j % 2 ? h0 / 2 : 0); x <= box.maxX + geps; x += h0) {
      if (sdf(x, y) >= -geps) continue;
      const acceptance = 1 / size(x, y) ** 2; // point density ∝ 1/h²
      maxAcceptance = Math.max(maxAcceptance, acceptance);
      candidates.push([x, y, acceptance]);
    }
  }
  for (const [x, y, acceptance] of candidates) {
    if (rand() >= acceptance / maxAcceptance) continue;
    // Keep clear of fixed points, which would otherwise create very short edges.
    if (fixed.some((f) => Math.hypot(f[0] - x, f[1] - y) < 0.5 * size(x, y))) continue;
    xs.push(x);
    ys.push(y);
  }

  const n = xs.length;
  const p = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    p[2 * i] = xs[i];
    p[2 * i + 1] = ys[i];
  }

  // 2. Relax.
  const pOld = new Float64Array(2 * n).fill(Infinity);
  const localSize = new Float64Array(n).fill(h0);
  const force = new Float64Array(2 * n);
  let bars: Uint32Array = new Uint32Array();
  let iterations = 0;
  let retriangulations = 0;
  let converged = false;

  while (iterations < maxIterations) {
    iterations++;

    // Movement is measured relative to the local element size: in a graded mesh,
    // large far-field elements move much further than hMin without any change
    // in connectivity, and an absolute threshold would re-triangulate constantly.
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const step = Math.hypot(p[2 * i] - pOld[2 * i], p[2 * i + 1] - pOld[2 * i + 1]);
      moved = Math.max(moved, step / localSize[i]);
    }
    if (moved > T_TOL) {
      pOld.set(p);
      for (let i = 0; i < n; i++) localSize[i] = size(p[2 * i], p[2 * i + 1]);
      bars = uniqueBars(insideTriangles(p, sdf, geps));
      retriangulations++;
    }

    // Spring forces: L0 is the target length scaled so the springs fill the region.
    const nBars = bars.length / 2;
    const lengths = new Float64Array(nBars);
    const hBar = new Float64Array(nBars);
    let sumL2 = 0;
    let sumH2 = 0;
    for (let b = 0; b < nBars; b++) {
      const [i, j] = [bars[2 * b], bars[2 * b + 1]];
      lengths[b] = Math.hypot(p[2 * i] - p[2 * j], p[2 * i + 1] - p[2 * j + 1]);
      hBar[b] = size((p[2 * i] + p[2 * j]) / 2, (p[2 * i + 1] + p[2 * j + 1]) / 2);
      sumL2 += lengths[b] ** 2;
      sumH2 += hBar[b] ** 2;
    }
    const scale = F_SCALE * Math.sqrt(sumL2 / sumH2);
    force.fill(0);
    for (let b = 0; b < nBars; b++) {
      const L = lengths[b];
      const F = Math.max(hBar[b] * scale - L, 0); // repulsive only
      if (F === 0 || L === 0) continue;
      const [i, j] = [bars[2 * b], bars[2 * b + 1]];
      const fx = (F * (p[2 * i] - p[2 * j])) / L;
      const fy = (F * (p[2 * i + 1] - p[2 * j + 1])) / L;
      force[2 * i] += fx;
      force[2 * i + 1] += fy;
      force[2 * j] -= fx;
      force[2 * j + 1] -= fy;
    }
    force.fill(0, 0, 2 * nFixed);

    // Move, then project escaped points back onto the boundary: p ← p − d·∇d.
    let maxInteriorStep = 0;
    for (let i = nFixed; i < n; i++) {
      p[2 * i] += DELTA_T * force[2 * i];
      p[2 * i + 1] += DELTA_T * force[2 * i + 1];
      const [x, y] = [p[2 * i], p[2 * i + 1]];
      const d = sdf(x, y);
      if (d > 0) {
        const gx = (sdf(x + deps, y) - d) / deps;
        const gy = (sdf(x, y + deps) - d) / deps;
        const g2 = gx * gx + gy * gy;
        if (g2 > 0) {
          p[2 * i] -= (d * gx) / g2;
          p[2 * i + 1] -= (d * gy) / g2;
        }
      } else if (d < -geps) {
        const step = DELTA_T * Math.hypot(force[2 * i], force[2 * i + 1]);
        maxInteriorStep = Math.max(maxInteriorStep, step / localSize[i]);
      }
    }
    if (maxInteriorStep < D_P_TOL) {
      converged = true;
      break;
    }
  }

  // 3. Final triangulation, unused points dropped, boundary edges tagged.
  const triangles = insideTriangles(p, sdf, geps);
  return { mesh: tagMesh(region, compact(p, triangles)), iterations, retriangulations, converged };
}

/** Delaunay triangles whose centroid is inside the region. */
function insideTriangles(p: Float64Array, sdf: (x: number, y: number) => number, geps: number): Uint32Array {
  const all = delaunay(p);
  const keep: number[] = [];
  for (let t = 0; t < all.length; t += 3) {
    const [a, b, c] = [all[t], all[t + 1], all[t + 2]];
    const cx = (p[2 * a] + p[2 * b] + p[2 * c]) / 3;
    const cy = (p[2 * a + 1] + p[2 * b + 1] + p[2 * c + 1]) / 3;
    if (sdf(cx, cy) < -geps) keep.push(a, b, c);
  }
  return Uint32Array.from(keep);
}

function uniqueBars(triangles: Uint32Array): Uint32Array {
  const seen = new Set<number>();
  const bars: number[] = [];
  const stride = 2 ** 26; // node indices stay well below this
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[t + k];
      const b = triangles[t + ((k + 1) % 3)];
      const key = Math.min(a, b) * stride + Math.max(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      bars.push(a, b);
    }
  }
  return Uint32Array.from(bars);
}

/** Drops points not used by any triangle and renumbers. */
function compact(p: Float64Array, triangles: Uint32Array): { nodes: Float64Array; elements: Uint32Array } {
  const newIndex = new Int32Array(p.length / 2).fill(-1);
  const nodes: number[] = [];
  const elements = new Uint32Array(triangles.length);
  for (let k = 0; k < triangles.length; k++) {
    const old = triangles[k];
    if (newIndex[old] < 0) {
      newIndex[old] = nodes.length / 2;
      nodes.push(p[2 * old], p[2 * old + 1]);
    }
    elements[k] = newIndex[old];
  }
  return { nodes: Float64Array.from(nodes), elements };
}

/**
 * Boundary edges are those used by exactly one triangle. Taken in the
 * triangle's counter-clockwise order, the material is on their left. Each is
 * tagged with the nearest geometry curve to its midpoint.
 */
export function tagMesh(region: Region, { nodes, elements }: { nodes: Float64Array; elements: Uint32Array }): TaggedMesh {
  const count = new Map<number, number>();
  const nNodes = nodes.length / 2;
  const key = (a: number, b: number) => Math.min(a, b) * nNodes + Math.max(a, b);
  for (let t = 0; t < elements.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const id = key(elements[t + k], elements[t + ((k + 1) % 3)]);
      count.set(id, (count.get(id) ?? 0) + 1);
    }
  }

  const curves = regionCurves(region);
  const boundaryEdges: number[] = [];
  const boundaryTags: number[] = [];
  for (let t = 0; t < elements.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = elements[t + k];
      const b = elements[t + ((k + 1) % 3)];
      if (count.get(key(a, b)) !== 1) continue;
      const mx = (nodes[2 * a] + nodes[2 * b]) / 2;
      const my = (nodes[2 * a + 1] + nodes[2 * b + 1]) / 2;
      let best = 0;
      let bestDistance = Infinity;
      curves.forEach((curve, id) => {
        const d = distanceToCurve(curve, mx, my);
        if (d < bestDistance) {
          bestDistance = d;
          best = id;
        }
      });
      boundaryEdges.push(a, b);
      boundaryTags.push(best);
    }
  }
  return { nodes, elements, boundaryEdges: Uint32Array.from(boundaryEdges), boundaryTags: Uint32Array.from(boundaryTags) };
}

/** Park–Miller minimal standard generator, in [0, 1). */
function lcg(seed: number): () => number {
  let s = Math.max(1, Math.floor(seed)) % 2147483647;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
