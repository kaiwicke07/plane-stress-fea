// Starting geometries for the editor.

import {
  addCircleHole,
  type EditorGeometry,
  emptyGeometry,
  type HoleSpec,
  setCondition,
  setOutline,
} from './model';

export interface Template {
  id: string;
  name: string;
  description: string;
  build(): EditorGeometry;
}

const holeEdge = (geo: EditorGeometry, k: number) => {
  const hole: HoleSpec = geo.holes[k];
  return hole.kind === 'circle' ? hole.edge : hole.edges[0];
};

export const TEMPLATES: readonly Template[] = [
  {
    id: 'bracket',
    name: 'L-bracket',
    description: 'Wall bracket bolted through two holes, with a downward load at the tip of the arm.',
    build() {
      let geo = setOutline(emptyGeometry(), [
        [0, 0],
        [20, 0],
        [20, 80],
        [120, 80],
        [120, 100],
        [0, 100],
      ]);
      geo = addCircleHole(geo, 10, 15, 4);
      geo = addCircleHole(geo, 10, 55, 4);
      geo = setCondition(geo, holeEdge(geo, 0), { support: 'fixed' });
      geo = setCondition(geo, holeEdge(geo, 1), { support: 'fixed' });
      // Edge 3 is the arm tip, (120, 80) → (120, 100).
      return setCondition(geo, geo.outline.edges[3], { load: { kind: 'force', fx: 0, fy: -300 } });
    },
  },
  {
    id: 'cantilever',
    name: 'Cantilever',
    description: 'Rectangle with the left edge fixed and a downward force on the right edge.',
    build() {
      const geo = setOutline(emptyGeometry(), [
        [0, 0],
        [100, 0],
        [100, 20],
        [0, 20],
      ]);
      const [, right, , left] = geo.outline.edges;
      return setCondition(setCondition(geo, left, { support: 'fixed' }), right, {
        load: { kind: 'force', fx: 0, fy: -500 },
      });
    },
  },
  {
    id: 'plate-hole',
    name: 'Plate with a hole (quarter)',
    description: 'Quarter of a plate in tension, with symmetry rollers on the cut edges.',
    build() {
      let geo = setOutline(emptyGeometry(), [
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ]);
      geo = addCircleHole(geo, 0, 0, 10);
      const [bottom, right, , left] = geo.outline.edges;
      geo = setCondition(geo, left, { support: 'roller-x' });
      geo = setCondition(geo, bottom, { support: 'roller-y' });
      return setCondition(geo, right, { load: { kind: 'traction', tx: 100, ty: 0 } });
    },
  },
];

export function templateById(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
