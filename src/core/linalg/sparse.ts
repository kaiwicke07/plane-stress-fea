// Sparse matrices. Assembly writes (row, col, value) triplets, which are then
// compressed to CSR for fast matrix-vector products.
// Background: docs/math/03-assembly-and-boundary-conditions.md.

/** Square n×n matrix in compressed sparse row format, columns sorted per row. */
export interface CsrMatrix {
  n: number;
  /** Row i's entries are at indices rowPtr[i] .. rowPtr[i+1]-1. Length n+1. */
  rowPtr: Int32Array;
  colIdx: Int32Array;
  values: Float64Array;
}

/** Growable list of (row, col, value) triplets. Duplicates are summed by toCsr(). */
export class TripletList {
  readonly n: number;
  private rows: Int32Array;
  private cols: Int32Array;
  private vals: Float64Array;
  private length = 0;

  constructor(n: number, capacity = 16) {
    this.n = n;
    this.rows = new Int32Array(capacity);
    this.cols = new Int32Array(capacity);
    this.vals = new Float64Array(capacity);
  }

  add(row: number, col: number, value: number): void {
    if (this.length === this.rows.length) this.grow();
    this.rows[this.length] = row;
    this.cols[this.length] = col;
    this.vals[this.length] = value;
    this.length++;
  }

  toCsr(): CsrMatrix {
    const { n, rows, cols, vals, length } = this;

    // Counting sort of triplet indices by row: rowStart[i] is where row i begins.
    const rowStart = new Int32Array(n + 1);
    for (let k = 0; k < length; k++) rowStart[rows[k] + 1]++;
    for (let i = 0; i < n; i++) rowStart[i + 1] += rowStart[i];
    const order = new Int32Array(length);
    const next = rowStart.slice(0, n);
    for (let k = 0; k < length; k++) order[next[rows[k]]++] = k;

    const rowPtr = new Int32Array(n + 1);
    const colIdx = new Int32Array(length);
    const values = new Float64Array(length);
    let nnz = 0;

    for (let i = 0; i < n; i++) {
      const start = rowStart[i];
      const end = rowStart[i + 1];

      // Insertion sort by column. Rows of a stiffness matrix are short (~14-40 triplets).
      for (let a = start + 1; a < end; a++) {
        const key = order[a];
        const col = cols[key];
        let b = a - 1;
        while (b >= start && cols[order[b]] > col) {
          order[b + 1] = order[b];
          b--;
        }
        order[b + 1] = key;
      }

      // Merge duplicates: this is where element contributions are summed.
      for (let a = start; a < end; a++) {
        const k = order[a];
        if (nnz > rowPtr[i] && colIdx[nnz - 1] === cols[k]) {
          values[nnz - 1] += vals[k];
        } else {
          colIdx[nnz] = cols[k];
          values[nnz] = vals[k];
          nnz++;
        }
      }
      rowPtr[i + 1] = nnz;
    }

    return { n, rowPtr, colIdx: colIdx.slice(0, nnz), values: values.slice(0, nnz) };
  }

  private grow(): void {
    const capacity = this.rows.length * 2;
    const rows = new Int32Array(capacity);
    const cols = new Int32Array(capacity);
    const vals = new Float64Array(capacity);
    rows.set(this.rows);
    cols.set(this.cols);
    vals.set(this.vals);
    this.rows = rows;
    this.cols = cols;
    this.vals = vals;
  }
}

/** y = A·x. */
export function csrMatVec(A: CsrMatrix, x: Float64Array, y: Float64Array): void {
  const { n, rowPtr, colIdx, values } = A;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) sum += values[k] * x[colIdx[k]];
    y[i] = sum;
  }
}

export function csrDiagonal(A: CsrMatrix): Float64Array {
  const { n, rowPtr, colIdx, values } = A;
  const diag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
      if (colIdx[k] === i) {
        diag[i] = values[k];
        break;
      }
    }
  }
  return diag;
}

/** Expands to a dense n×n row-major array. For tests and tiny problems only. */
export function csrToDense(A: CsrMatrix): Float64Array {
  const { n, rowPtr, colIdx, values } = A;
  const dense = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) dense[i * n + colIdx[k]] = values[k];
  }
  return dense;
}
