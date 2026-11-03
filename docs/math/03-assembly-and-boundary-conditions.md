# 3. Assembly, loads and boundary conditions

Code: [`src/core/assembly.ts`](../../src/core/assembly.ts),
[`src/core/boundary.ts`](../../src/core/boundary.ts),
[`src/core/linalg/sparse.ts`](../../src/core/linalg/sparse.ts)

## Assembly

Node n owns global DOFs 2n (x) and 2n + 1 (y). Each element has a map Lₑ from
its 6 local DOFs to global ones. The global stiffness is the sum of element
contributions:

    K = Σₑ Lₑᵀ kₑ Lₑ

In practice nobody forms Lₑ. Entry kₑ[a][b] is simply *added* to
K[dofs[a]][dofs[b]]. Adding is the important part: a node shared by six
elements gets six contributions on its diagonal. This is the discrete form of
"the total energy is the sum of the element energies".

The code writes every (row, col, value) into a triplet list, then compresses it
to CSR (compressed sparse row) format. Sorting brings duplicates together, and
that is where contributions are summed.

**Why sparse?** A DOF only couples to DOFs of nodes in the same elements. In a 2D
triangle mesh a node has about 6 neighbours, so a row has about
(6 + 1) × 2 = 14 nonzeros, whatever the mesh size. For 20 000 DOFs, a dense K
would need 20 000² × 8 bytes = 3.2 GB. CSR needs about 20 000 × 14 × 12 bytes
≈ 3.4 MB.

## K is singular until the part is supported

The three rigid-body modes of a free body (translation in x, translation in y,
rotation) produce no strain, so K·r = 0 for each of them. K has a 3-dimensional
null space, and K·u = F has no unique solution: the part could move anywhere.
The supports have to remove all three modes.

`checkRigidBodyRestraint` tests this before solving. For each constrained DOF,
it evaluates the three modes at that DOF:

    x-constraint at (x, y):  [1, 0, −y]
    y-constraint at (x, y):  [0, 1,  x]

Stacking those rows gives a matrix C. A rigid motion with coefficients a is
blocked by every support exactly when C·a = 0, so the supports prevent all rigid
motion exactly when C has rank 3, i.e. CᵀC (3×3) is positive definite. This is
why two x-rollers at the *same* height cannot stop rotation, while two at
different heights can.

This catches whole-body motion. It cannot catch a node attached to no element,
or two regions joined at a single point. Those still make K_ff singular, and the
linear solver reports them.

## Applying the constraints: partitioning

Split the DOFs into free (f) and prescribed (c), with known displacements u_c
(zero for a support, nonzero for an imposed displacement):

    ⎡ K_ff  K_fc ⎤ ⎡ u_f ⎤   ⎡ F_f       ⎤
    ⎣ K_cf  K_cc ⎦ ⎣ u_c ⎦ = ⎣ F_c + R_c ⎦

The top row is the system to solve:

    K_ff · u_f = F_f − K_fc · u_c

The bottom row gives the unknown reactions once u is known. The code computes
R = K·u − F at the prescribed DOFs.

**Why not the alternatives?**

- *Penalty method*: add a huge number α to the diagonal of each constrained
  DOF. It is easy to code, but the result is only approximate, and the condition
  number grows with α, which slows iterative solvers.
- *Lagrange multipliers*: exact, but the system becomes a saddle-point problem
  that is not positive definite, so conjugate gradient no longer applies.
- *Elimination* (used here) is exact, makes the system smaller, and keeps K_ff
  symmetric positive definite.

## Loads: consistent nodal forces

An edge traction t̄ (force per unit area, MPa) becomes nodal forces through the
same shape functions:

    fₑ = ∫ Nᵀ t̄ · t ds

Along an edge the shape functions are linear, and each integrates to L/2. So a
uniform traction puts half of the edge's total force t̄·L·t on each end node.
Quadratic elements (Phase 7) split it 1/6, 4/6, 1/6 instead.

**Why tractions instead of point loads?** In 2D elasticity a point force gives
stress that grows as 1/r near the load point (the Flamant solution). Refining
the mesh there makes the peak stress keep rising and never converge.

## Equilibrium comes for free

For any rigid mode r, rᵀK = 0 (because K is symmetric and K·r = 0). Multiplying
K·u = F + R by rᵀ gives rᵀ(F + R) = 0. For the two translations, that means the
forces sum to zero. For the rotation, it means the moments sum to zero. So the FE
solution is in exact global equilibrium, up to solver tolerance. The equilibrium
test checks this to 1 part in 10⁸.

## Tests

[`tests/core/solve.test.ts`](../../tests/core/solve.test.ts):

- K·r = 0 for all three rigid modes.
- A pin plus a roller leaves K_ff positive definite; a pin alone does not.
  Together with K·r = 0, this shows K has exactly 3 zero eigenvalues.
- **Displacement patch test.** On an irregular mesh, prescribe a linear field
  on the boundary; the interior nodes reproduce it exactly.
- **Force patch test.** Under uniaxial edge traction, every element has
  σx = σ exactly.
- Reactions balance the applied load in x, y and moment.
- Tractions split correctly, and a traction on a non-edge is rejected.
- Missing restraints are named; conflicting constraints and orphan nodes are
  reported.

## Interview questions

- *Why is the unsupported K singular, and what is its null space?* The three
  rigid-body modes.
- *What is the minimum support for a 2D part?* Three constraints that are not
  all parallel and not all pass through one point. For example, a pin plus a
  roller whose direction does not point at the pin.
- *Penalty vs elimination?* See above.
- *What is the patch test and why does it matter?* An element that passes it can
  represent constant strain exactly on any mesh, a necessary condition for
  convergence.
- *How do you know the solution is in equilibrium?* Rigid modes are in the null
  space of K, which forces the reactions to balance the loads.
