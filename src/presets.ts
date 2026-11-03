// Built-in example parts. Each preset turns a few dimensions and a mesh
// density into a mesh with supports and loads on its geometry edges.

import { RECT_EDGE, rectangleMesh } from './mesh/structured';
import type { StudySetup } from './model/spec';

export interface PresetParam {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  params: readonly PresetParam[];
  /** `density` is the number of elements across the part's smallest dimension. */
  build(values: Readonly<Record<string, number>>, density: number): StudySetup;
}

/** Cells along a side of `length`, for cells of size `h`, at least 1 (and even if asked). */
function cells(length: number, h: number, even = false): number {
  const n = Math.max(1, Math.round(length / h));
  return even ? Math.max(2, 2 * Math.round(n / 2)) : n;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'cantilever',
    name: 'Cantilever beam',
    description: 'Wall on the left, downward shear load on the free end.',
    params: [
      { key: 'length', label: 'Length', unit: 'mm', min: 20, max: 400, step: 5, value: 100 },
      { key: 'depth', label: 'Depth', unit: 'mm', min: 5, max: 80, step: 1, value: 20 },
      { key: 'load', label: 'Tip load', unit: 'N', min: 0, max: 20_000, step: 50, value: 500 },
    ],
    build({ length, depth, load }, density) {
      const ny = cells(depth, depth / density, true);
      const h = depth / ny;
      const mesh = rectangleMesh({
        y0: -depth / 2,
        width: length,
        height: depth,
        nx: cells(length, h),
        ny,
        pattern: 'alternating',
      });
      return {
        mesh,
        supports: [{ edge: RECT_EDGE.left, kind: 'fixed' }],
        // Parabolic, as in beam theory and the validation case; zero at the corners.
        loads: [{ edge: RECT_EDGE.right, kind: 'parabolic-shear', fx: 0, fy: -load }],
      };
    },
  },
  {
    id: 'tension-strip',
    name: 'Tension strip',
    description: 'Uniform tension, with symmetry rollers on the left and bottom edges.',
    params: [
      { key: 'width', label: 'Width', unit: 'mm', min: 10, max: 400, step: 5, value: 100 },
      { key: 'height', label: 'Height', unit: 'mm', min: 5, max: 200, step: 1, value: 40 },
      { key: 'stress', label: 'Applied stress', unit: 'MPa', min: 0, max: 500, step: 5, value: 100 },
    ],
    build({ width, height, stress }, density) {
      const h = Math.min(width, height) / density;
      const mesh = rectangleMesh({ width, height, nx: cells(width, h), ny: cells(height, h), pattern: 'alternating' });
      return {
        mesh,
        supports: [
          { edge: RECT_EDGE.left, kind: 'roller-x' },
          { edge: RECT_EDGE.bottom, kind: 'roller-y' },
        ],
        loads: [{ edge: RECT_EDGE.right, kind: 'traction', tx: stress, ty: 0 }],
      };
    },
  },
];

export function presetById(id: string): Preset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown preset "${id}"`);
  return preset;
}

export function defaultValues(preset: Preset): Record<string, number> {
  return Object.fromEntries(preset.params.map((p) => [p.key, p.value]));
}
