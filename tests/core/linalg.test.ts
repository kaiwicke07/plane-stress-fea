import { describe, expect, it } from 'vitest';
import { choleskySolve } from '../../src/core/linalg/dense';
import { NotPositiveDefiniteError } from '../../src/core/linalg/errors';
import { pcg } from '../../src/core/linalg/pcg';
import { csrDiagonal, csrMatVec, csrToDense, TripletList } from '../../src/core/linalg/sparse';

/** A random SPD matrix as triplets: A = MᵀM + n·I. */
function randomSpd(n: number, seed: number): TripletList {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const M = Array.from({ length: n * n }, rand);
  const list = new TripletList(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let v = i === j ? n : 0;
      for (let k = 0; k < n; k++) v += M[k * n + i] * M[k * n + j];
      list.add(i, j, v);
    }
  }
  return list;
}

describe('TripletList.toCsr', () => {
  it('sorts columns and sums duplicates', () => {
    const list = new TripletList(3, 2); // small capacity forces growth
    list.add(2, 1, 1);
    list.add(0, 2, 5);
    list.add(0, 0, 1);
    list.add(2, 1, 2);
    list.add(0, 2, -1);
    const A = list.toCsr();
    expect(Array.from(A.rowPtr)).toEqual([0, 2, 2, 3]);
    expect(Array.from(A.colIdx)).toEqual([0, 2, 1]);
    expect(Array.from(A.values)).toEqual([1, 4, 3]);
  });

  it('agrees with the dense matrix for matvec and diagonal', () => {
    const A = randomSpd(12, 7).toCsr();
    const dense = csrToDense(A);
    const x = Float64Array.from({ length: 12 }, (_, i) => Math.sin(i));
    const y = new Float64Array(12);
    csrMatVec(A, x, y);
    for (let i = 0; i < 12; i++) {
      let expected = 0;
      for (let j = 0; j < 12; j++) expected += dense[12 * i + j] * x[j];
      expect(y[i]).toBeCloseTo(expected, 12);
      expect(csrDiagonal(A)[i]).toBe(dense[13 * i]);
    }
  });
});

describe('choleskySolve', () => {
  it('solves a known 3×3 system', () => {
    const A = new Float64Array([4, 12, -16, 12, 37, -43, -16, -43, 98]);
    const x = choleskySolve(A, new Float64Array([1, 2, 3]));
    const Ax = [0, 1, 2].map((i) => A[3 * i] * x[0] + A[3 * i + 1] * x[1] + A[3 * i + 2] * x[2]);
    expect(Ax[0]).toBeCloseTo(1, 12);
    expect(Ax[1]).toBeCloseTo(2, 12);
    expect(Ax[2]).toBeCloseTo(3, 12);
  });

  it('rejects singular and indefinite matrices', () => {
    expect(() => choleskySolve(new Float64Array([1, 1, 1, 1]), new Float64Array(2))).toThrow(NotPositiveDefiniteError);
    expect(() => choleskySolve(new Float64Array([1, 2, 2, 1]), new Float64Array(2))).toThrow(NotPositiveDefiniteError);
  });
});

describe('pcg', () => {
  it('matches Cholesky on an SPD system', () => {
    const n = 30;
    const A = randomSpd(n, 42).toCsr();
    const b = Float64Array.from({ length: n }, (_, i) => Math.cos(i));
    const result = pcg(A, b, { tolerance: 1e-12 });
    const reference = choleskySolve(csrToDense(A), b);
    expect(result.relativeResidual).toBeLessThan(1e-12);
    expect(result.iterations).toBeLessThanOrEqual(n + 5);
    for (let i = 0; i < n; i++) expect(result.x[i]).toBeCloseTo(reference[i], 9);
  });

  it('returns zero for a zero right-hand side', () => {
    const result = pcg(randomSpd(5, 1).toCsr(), new Float64Array(5));
    expect(Array.from(result.x)).toEqual([0, 0, 0, 0, 0]);
    expect(result.iterations).toBe(0);
  });

  it('detects a zero diagonal (a DOF with no stiffness)', () => {
    const list = new TripletList(2);
    list.add(0, 0, 1);
    expect(() => pcg(list.toCsr(), new Float64Array([1, 1]))).toThrow(NotPositiveDefiniteError);
  });
});
