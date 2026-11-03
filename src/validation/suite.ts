// The validation studies shown on the site, in the order they run. Each is
// the same function the test suite runs.

import { cantileverConvergence, DEFAULT_CANTILEVER, midspanProfile, runClampedWall } from './cases';
import { holeMesh, KIRSCH_PLATE, runPlate } from './plate-cases';

/** Cells through the depth for the LST cantilever, and elements per radius for the LST plate. */
export const LST_LEVELS = [2, 4, 8, 16];
export const LST_PLATE_LEVELS = [4, 8, 16];

export const HEYWOOD_RATIOS = [0.1, 0.2, 0.3, 0.4, 0.5] as const;
/** Finite plates for the Heywood series: W = 50, L = 2W. */
export const HEYWOOD_PLATE = { ...KIRSCH_PLATE, width: 50, length: 100 };

export const SUITE = {
  cantileverExact: () => cantileverConvergence(DEFAULT_CANTILEVER, [2, 4, 8, 16, 32]),
  cantileverClamped: () => [4, 8, 16, 32].map((ny) => runClampedWall(DEFAULT_CANTILEVER, ny)),
  midspanProfile: () => midspanProfile(DEFAULT_CANTILEVER, 16),
  cantileverLst: () => cantileverConvergence(DEFAULT_CANTILEVER, LST_LEVELS, 'alternating', 2),
  plateKirsch: () => [8, 16, 32].map((k) => runPlate(KIRSCH_PLATE, holeMesh(KIRSCH_PLATE, k))),
  plateHeywood: () =>
    HEYWOOD_RATIOS.map((dOverW) => {
      const params = { ...HEYWOOD_PLATE, holeDiameter: HEYWOOD_PLATE.width * dOverW };
      return runPlate(params, holeMesh(params, 32));
    }),
  plateLst: () => LST_PLATE_LEVELS.map((k) => runPlate(KIRSCH_PLATE, holeMesh(KIRSCH_PLATE, k), 2)),
};

export type SuiteKey = keyof typeof SUITE;
export type SuiteResults = { [K in SuiteKey]?: ReturnType<(typeof SUITE)[K]> };

export const SUITE_ORDER: readonly SuiteKey[] = [
  'cantileverExact',
  'cantileverClamped',
  'midspanProfile',
  'cantileverLst',
  'plateKirsch',
  'plateHeywood',
  'plateLst',
];

export const SUITE_LABEL: Record<SuiteKey, string> = {
  cantileverExact: 'Cantilever, exact solution',
  cantileverClamped: 'Cantilever, beam theory',
  midspanProfile: 'Cantilever, bending stress',
  plateKirsch: 'Plate, Kirsch',
  plateHeywood: 'Plate, Heywood',
  cantileverLst: 'Cantilever, 6-node elements',
  plateLst: 'Plate, 6-node elements',
};
