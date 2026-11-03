// Turns editor geometry into a meshed study: region, size function, DistMesh,
// and supports/loads mapped from stable edge IDs to mesh boundary tags.

import { distmesh } from '../mesh/distmesh';
import { distanceToHoles, type Region } from '../mesh/geometry';
import { edgesWithTag } from '../mesh/tagged-mesh';
import type { EdgeLoad, EdgeSupport, StudySetup } from '../model/spec';
import { allEdges, type EdgeId, type EditorGeometry, signedArea2 } from './model';

/** Region for the mesher, and the edge ID behind each geometry curve (= mesh tag). */
export function geometryToRegion(geo: EditorGeometry): { region: Region; edgeOfTag: EdgeId[] } {
  return {
    region: {
      outer: { kind: 'polygon', points: geo.outline.points },
      holes: geo.holes.map((h) =>
        h.kind === 'circle' ? { kind: 'circle', cx: h.cx, cy: h.cy, r: h.r } : { kind: 'polygon', points: h.points },
      ),
    },
    // Same order as regionCurves(): outline edges, then each hole's edges.
    edgeOfTag: allEdges(geo),
  };
}

/** Upper bound on mesh size, so a tiny feature cannot ask for millions of elements. */
const MAX_NODES = 15_000;

export interface MeshSizing {
  /** Element size away from holes, mm. */
  h: number;
  /** Element size at hole edges, mm. */
  hHole: number;
}

/**
 * Element size from the density (elements across the part's narrowest
 * feature, taken as its shortest outline edge but not less than a tenth of
 * the bounding box). Holes get finer elements: at least 16 around a circle.
 */
export function meshSizing(geo: EditorGeometry, density: number): MeshSizing {
  const pts = geo.outline.points;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const boxMin = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const shortestEdge = Math.min(
    ...pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1])),
  );
  const feature = Math.max(Math.min(shortestEdge, boxMin), boxMin / 10);

  // Cap the node count: DistMesh places about one node per 0.43·h² of area.
  const area = Math.abs(signedArea2(pts)) / 2;
  const h = Math.max(feature / density, Math.sqrt(area / (0.43 * MAX_NODES)));

  let hHole = h;
  for (const hole of geo.holes) {
    hHole = Math.min(hHole, hole.kind === 'circle' ? (Math.PI * hole.r) / 8 : h / 2);
  }
  return { h, hHole: Math.max(hHole, h / 8) };
}

export function buildStudy(geo: EditorGeometry, density: number): StudySetup {
  const { region, edgeOfTag } = geometryToRegion(geo);
  const { h, hHole } = meshSizing(geo, density);
  const size =
    geo.holes.length > 0 ? (x: number, y: number) => Math.min(h, hHole + 0.3 * distanceToHoles(region, x, y)) : () => h;
  const { mesh } = distmesh(region, { hMin: Math.min(h, hHole), size });

  const supports: EdgeSupport[] = [];
  const loads: EdgeLoad[] = [];
  edgeOfTag.forEach((id, tag) => {
    const condition = geo.conditions[id];
    if (!condition) return;
    if (edgesWithTag(mesh, tag).length === 0) {
      throw new Error('An edge with a support or load is completely cut away by a hole.');
    }
    if (condition.support) supports.push({ edge: tag, kind: condition.support });
    if (condition.load) loads.push({ edge: tag, ...condition.load });
  });
  return { mesh, supports, loads };
}
