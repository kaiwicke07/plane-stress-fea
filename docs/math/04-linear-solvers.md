# 4. Solving K·u = F

Code: [`src/core/linalg/pcg.ts`](../../src/core/linalg/pcg.ts),
[`src/core/linalg/dense.ts`](../../src/core/linalg/dense.ts)

## What we know about K_ff

- **Symmetric**, from Bᵀ D B with D symmetric.
- **Positive definite** once rigid motion is prevented: uᵀK_ff u = 2 × strain
  energy > 0 for every nonzero admissible u.
- **Sparse**, about 14 nonzeros per row.

Symmetric positive definite (SPD) is the best property a linear system can have.
It allows Cholesky factorisation and conjugate gradient, and it means a failure
in either one says something physical: the model can move without storing
energy.

## Dense Cholesky (reference solver)

Factor A = L·Lᵀ with L lower triangular, then solve L·y = b forwards and
Lᵀ·x = y backwards. For SPD matrices this needs no pivoting and is numerically
stable. It costs n³/3 operations and n² memory, which is fine for tests with a
few hundred DOFs and impossible for real meshes.

It doubles as a test for positive definiteness. If a pivot comes out zero or
negative, the matrix is not SPD. The rigid-body tests use it that way.

## Conjugate gradient

For SPD A, solving A·x = b is the same as minimising

    φ(x) = ½ xᵀA x − bᵀx

because the gradient of φ is A·x − b. For a structure, φ is the **total
potential energy** (strain energy minus work done by the loads). CG literally
finds the displacement that minimises the energy.

Each iteration:

1. Moves along a search direction p, by the step α that minimises φ along it.
2. Chooses the next direction to be A-conjugate to all previous ones
   (pᵢᵀ A pⱼ = 0), so later steps never undo earlier progress.

In exact arithmetic it converges in at most n iterations. In practice it
converges much sooner, at a rate set by the condition number κ = λmax/λmin:

    error reduction per iteration ≈ (√κ − 1) / (√κ + 1)

so the number of iterations grows like √κ.

**Stiffness matrices get worse with refinement.** For a mesh with element size
h, κ(K) grows as h⁻², so the iteration count grows as h⁻¹. Halving h doubles the
iterations. On the cantilever study, iterations went from 62 to 139 to 294 to
603 as the mesh was refined 2× each time.

## Jacobi preconditioning

Instead of A·x = b, solve the equivalent M⁻¹A·x = M⁻¹b, where M ≈ A is cheap to
invert. Jacobi uses M = diag(A). It costs one multiply per DOF and removes
scaling differences, for example between small and large elements or soft and
stiff materials. It does **not** fix the h⁻² growth. Better preconditioners
(incomplete Cholesky, algebraic multigrid) do; they are possible later upgrades.

## Stopping and failure

- Stop when the relative residual ‖b − A·x‖ / ‖b‖ < 10⁻¹⁰.
- If pᵀA p ≤ 0, there is a direction with no stiffness, so the model is singular.
- A zero diagonal entry means a DOF with no stiffness at all, for example a node
  that belongs to no element. This is checked even when b = 0. Without that check,
  an unloaded orphan node would silently return u = 0; a unit test caught exactly
  that bug.

## Why not other solvers?

- *Dense Gaussian elimination*: O(n³) time and O(n²) memory.
- *Banded or skyline Cholesky, with reverse Cuthill–McKee reordering*: a good
  direct option. The fill-in stays inside the band, and the bandwidth is about
  √n for 2D meshes, so the cost is about n². It is predictable and needs no
  tolerance, but uses more memory than CG.
- *CG* needs only matrix-vector products, O(nnz) memory, and is simple to write
  and explain. It is the right choice for a browser.

## Tests

[`tests/core/linalg.test.ts`](../../tests/core/linalg.test.ts):

- CSR assembly sums duplicates; matrix-vector product and diagonal match the dense
  matrix.
- Cholesky solves a known system, and rejects singular and indefinite matrices.
- PCG matches Cholesky to 10⁻⁹ in at most n iterations.
- PCG detects a zero diagonal.

The full cantilever also checks that PCG and Cholesky agree on displacements.

## Interview questions

- *Why can you use CG on a stiffness matrix?* K_ff is SPD once rigid motion is
  removed.
- *What does CG minimise physically?* Total potential energy.
- *Why does refining the mesh slow CG down?* κ ~ h⁻², and iterations ~ √κ.
- *Direct or iterative for 1 M DOFs in 3D?* Iterative with a strong
  preconditioner, because direct solvers suffer heavy fill-in in 3D.
