# 10. The 6-node linear strain triangle (LST)

Code: [`src/core/elements/lst.ts`](../../src/core/elements/lst.ts),
[`src/mesh/quadratic.ts`](../../src/mesh/quadratic.ts),
[`src/core/postprocess.ts`](../../src/core/postprocess.ts),
[`src/core/boundary.ts`](../../src/core/boundary.ts) (edge loads)

## Why a second element

A CST holds one constant strain, so bending has to be built from steps of
constant-strain elements. The elements pick up shear strain that the real beam
does not have, and that makes them too stiff (note 2). Refining the mesh helps
only at O(h) in stress.

The LST adds a node at the middle of each edge: 6 nodes and 12 DOFs, enough for
a **complete quadratic** displacement field. Its derivatives, the strains, are
linear, so the element can represent bending exactly.

## Shape functions

In area coordinates L₁, L₂, L₃ (note 2), with corners 1–3 and mid-side nodes
4 (on 1–2), 5 (on 2–3) and 6 (on 3–1):

    corners:   Nᵢ = Lᵢ(2Lᵢ − 1)          i = 1, 2, 3
    mid-side:  N₄ = 4L₁L₂   N₅ = 4L₂L₃   N₆ = 4L₃L₁

Each Nᵢ is 1 at its own node and 0 at the other five, and together they sum to 1
everywhere. Both properties are unit tests.

## Isoparametric mapping

The element is defined on a reference triangle with natural coordinates (ξ, η):
L₂ = ξ, L₃ = η, L₁ = 1 − ξ − η. **The same shape functions map the geometry and
interpolate the displacement:**

    x(ξ, η) = Σ Nᵢ xᵢ,   y(ξ, η) = Σ Nᵢ yᵢ,   u(ξ, η) = Σ Nᵢ uᵢ

Derivatives come through the Jacobian:

        ⎡ ∂x/∂ξ  ∂y/∂ξ ⎤      ⎡ ∂N/∂x ⎤         ⎡ ∂N/∂ξ ⎤
    J = ⎣ ∂x/∂η  ∂y/∂η ⎦,     ⎣ ∂N/∂y ⎦ = J⁻¹ · ⎣ ∂N/∂η ⎦

B (3×12) is built from ∂N/∂x and ∂N/∂y, exactly as for CST, except that it now
varies over the element. det J is the local area scale: dA = det J · dξ dη. It
equals 2A on a straight-sided element.

**Curved edges come for free.** If a mid-side node is moved off its chord, the
mapped edge becomes a parabola. Mid-side nodes on a circular hole are placed on
the true circle, so the hole is curved rather than a polygon. det J ≤ 0 at a
Gauss point means the element is inverted or too distorted, and the code
rejects it.

## Stiffness by Gauss quadrature

    kₑ = t ∫ BᵀDB dA ≈ t Σ_q w_q B(ξ_q)ᵀ D B(ξ_q) det J(ξ_q)

The rule uses 3 points: (1/6, 1/6), (2/3, 1/6) and (1/6, 2/3), each with weight
1/6. It is exact for quadratics. On a straight-sided LST, B is linear, so BᵀDB is
quadratic and the integral is exact. Unit tests check that kₑ is symmetric, that
rigid-body motion produces zero force, and that the quadrature reproduces the
element's area.

## Meshes: from 3 nodes to 6

`elevateToQuadratic` adds one node at the midpoint of every element edge, shared
by the elements on either side. Corner indices are unchanged and the new nodes
are appended, so anything indexed by corner nodes (the tip node, boundary tags)
still works. Boundary edges keep their corner pairs; `edgeMidNode(a, b)` finds the
node in between, and supports on a geometry edge include its mid-side nodes.

## Edge loads

A 3-node edge uses its own quadratic shape functions on ξ ∈ [−1, 1]:

    N_a = ξ(ξ − 1)/2,   N_m = 1 − ξ²,   N_b = ξ(ξ + 1)/2

For a uniform traction on a straight edge, ∫N ds gives **1/6, 4/6, 1/6** of the
total force. That is not the naive ⅓, ⅓, ⅓, and getting it wrong is a classic
bug. A varying or curved edge is integrated with 3-point Gauss quadrature using
ds = |dx/dξ| dξ.

## Stress recovery

LST stress is linear inside each element:

- **Nodal average:** each element's own stress field is evaluated at each of its
  six nodes and then averaged. That has no one-sided bias at a surface, because
  the value comes from the element's own linear field at the node, not from a
  constant value at its centroid.
- **SPR:** a *quadratic* σ*(x, y) is fitted to the stresses at the three Gauss
  points of every element in a patch, LST's most accurate sampling points. The
  code is shared with CST: CST samples at centroids with a linear fit, LST at
  Gauss points with a quadratic fit.

## The higher-order patch test

Pure bending (σx = c·y, σy = τxy = 0) satisfies equilibrium with no body force.
Its displacement is quadratic:

    u = c·x·y / E,   v = −c(x² + ν y²) / 2E

Prescribe that field on the boundary of a mesh and solve. An LST mesh must then
reproduce it **exactly**: the displacements at every node to 10⁻¹⁰, and the
nodal-average and SPR stresses exactly. A CST mesh cannot. Both halves are unit
tests, and this is the cleanest single demonstration of why the element matters.

## Results

**Exact-wall cantilever** (the same benchmark as note 6):

| Cells through depth | DOFs | Tip error | L2 error | Energy error |
|---|---|---|---|---|
| 2 | 210 | 0.029% | 0.032% | 2.46% |
| 4 | 738 | 0.0010% | 0.0027% | 0.63% |
| 8 | 2 754 | 3·10⁻⁵ % | 2.4·10⁻⁴ % | 0.16% |
| 16 | 10 626 | 4·10⁻⁶ % | 2.4·10⁻⁵ % | 0.041% |

Observed orders: energy **1.95, then 1.98, then 1.99** (theory 2); L2
**3.57, then 3.49, then 3.31**, falling toward 3 (theory 3).

At equal DOFs, compare with CST: at 10 626 DOFs, CST has a 0.24% tip error and a
4.9% energy error. LST with only **210 DOFs** already has a 0.029% tip error,
roughly 8× better from 50× fewer unknowns.

The tip error stops at about 10⁻⁸ on fine meshes. That is not the element; it is
the PCG stopping tolerance (relative residual 10⁻¹⁰), which caps how precisely
the linear system is solved. So the LST tip error is not used for a rate check.

Midspan bending stress, which CST got 3.4% low even with 32 cells, comes out
exact to five digits with LST on every mesh.

**Clamped wall vs Timoshenko:** LST gives 0.9945 of Timoshenko with 2 cells
through the depth and settles at 0.9970. That matches the
Richardson-extrapolated CST result (0.997) from note 6, so two independent
element types agree on the converged answer.

**Wide plate with a hole** (gross basis, against Heywood converted to gross,
3.032):

| Elements per radius | LST DOFs | LST, hole-edge fit | LST, nodal average | CST, hole-edge fit |
|---|---|---|---|---|
| 4 | 350 | −0.89% | +0.57% | −22.5% |
| 8 | 1 012 | +0.73% | −0.01% | −6.0% |
| 16 | 4 092 | +0.17% | +0.10% | −1.9% |

At 8 elements per radius, LST with plain nodal averaging is within 0.01%, while
CST is still 6% low. The curved hole edges help: a polygon hole is itself a
small geometric error.

## Display

WebGL draws linear triangles, so each 6-node element is drawn as four:
(1, 4, 6), (4, 2, 5), (6, 5, 3), (4, 5, 6). Nodal results apply directly,
because the node numbering is shared. The mesh lines show only the real element
edges, drawn through their mid-side nodes; drawing the split's internal lines
would make the mesh look four times finer than it is.

## Interview questions

- *Why is LST better than CST in bending?* Linear strain can represent the
  linear bending strain exactly, so there is no parasitic shear.
- *What is an isoparametric element?* The same shape functions interpolate the
  geometry and the displacement. That allows curved edges and needs the Jacobian
  for derivatives.
- *How many Gauss points for an LST, and why?* Three. BᵀDB is quadratic on a
  straight-sided element, and a 3-point rule is exact for quadratics.
- *How do you split a uniform edge load on a 3-node edge?* 1/6, 4/6, 1/6, from
  integrating the quadratic edge shape functions.
- *Your LST converges at order 3.3 in L2. Theory says 3. Is that a problem?* No.
  Coarse meshes are pre-asymptotic, and the observed order is falling toward 3.
  The energy-norm order is already 1.99.
- *Why does the tip error stop improving at 10⁻⁸?* Solver tolerance, not
  discretisation: the iterative solve stops at a 10⁻¹⁰ relative residual.
