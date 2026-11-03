# 2. The constant strain triangle (CST)

Code: [`src/core/elements/cst.ts`](../../src/core/elements/cst.ts)

## Displacement field

A triangle has 3 nodes × 2 DOFs = 6 unknowns, which is exactly enough to define
one linear field per displacement component:

    u(x, y) = a₀ + a₁x + a₂y
    v(x, y) = b₀ + b₁x + b₂y

Rather than solve for the a's and b's, write the field in terms of the nodal
values using **shape functions**:

    u = N₁u₁ + N₂u₂ + N₃u₃,   v = N₁v₁ + N₂v₂ + N₃v₃

Each Nᵢ is linear, equals 1 at node i and 0 at the other two nodes:

    Nᵢ = (aᵢ + bᵢx + cᵢy) / 2A

    b₁ = y₂ − y₃    b₂ = y₃ − y₁    b₃ = y₁ − y₂
    c₁ = x₃ − x₂    c₂ = x₁ − x₃    c₃ = x₂ − x₁

    2A = (x₂ − x₁)(y₃ − y₁) − (x₃ − x₁)(y₂ − y₁)

Geometrically, Nᵢ is the area of the sub-triangle opposite node i divided by the
whole area. These are barycentric (area) coordinates. They sum to 1 everywhere,
which is called partition of unity. Because of that, a rigid translation of all
three nodes moves every point by the same amount.

**Node order matters.** 2A is a cross product, so it is positive when the nodes
go counter-clockwise. A clockwise element has a negative area, and its B
flips sign. The code rejects such elements rather than silently fixing them,
since one usually means the mesher has a bug.

## Strain-displacement matrix B

Strains are derivatives of displacement. The derivatives of a linear function
are constants: ∂Nᵢ/∂x = bᵢ/2A and ∂Nᵢ/∂y = cᵢ/2A. So

    ε = B·uₑ,   uₑ = [u₁ v₁ u₂ v₂ u₃ v₃]ᵀ

            1   ⎡ b₁  0   b₂  0   b₃  0  ⎤
    B  =  ────  ⎢ 0   c₁  0   c₂  0   c₃ ⎥
           2A   ⎣ c₁  b₁  c₂  b₂  c₃  b₃ ⎦

B depends only on the node coordinates, not on (x, y). The strain, and therefore
the stress, is the same everywhere in the element. That is where the name
*constant strain triangle* comes from.

## Element stiffness

The strain energy stored in the element is

    U = ½ ∫ εᵀ D ε dV = ½ uₑᵀ ( ∫ Bᵀ D B dV ) uₑ = ½ uₑᵀ kₑ uₑ

The applied loads have potential −uₑᵀfₑ. Minimising total potential energy
Π = ½uₑᵀkₑuₑ − uₑᵀfₑ gives kₑuₑ = fₑ, which is equivalent to the principle of
virtual work. For CST the integrand is constant, so the integral is just the
volume times the integrand:

    kₑ = t · A · Bᵀ D B        (6×6)

## Properties of kₑ

- **Symmetric**, because D is symmetric.
- **Positive semi-definite**: uₑᵀkₑuₑ = 2U ≥ 0.
- **Rank 3, with 3 zero eigenvalues.** Rigid motions (translation in x,
  translation in y, small rotation u = −θy, v = θx) produce zero strain, so
  kₑ·r = 0. 6 DOFs minus 3 rigid modes leaves 3 independent strain states,
  matching the 3 strain components.
- **Rows sum to zero** in x and y. That is the translation mode, and it is one of
  the unit tests.

## Why CST is too stiff in bending

In pure bending, εx varies linearly through the depth. A CST can only hold
*constant* strain, so a bending field has to be approximated in steps of
constant-strain elements. The linear displacement field also cannot curve, so
the elements develop shear strain that is not there in the real beam (called
parasitic shear). That fake shear absorbs energy, making the model too stiff.

Measured on a clamped 100 × 20 mm steel cantilever with a tip shear load,
compared with Timoshenko beam theory:

| Mesh (cells) | DOFs | FE / beam deflection |
|---|---|---|
| 10 × 2 | 66 | 0.54 |
| 20 × 4 | 210 | 0.82 |
| 40 × 8 | 738 | 0.94 |
| 80 × 16 | 2 754 | 0.98 |

It does converge, but slowly. The 6-node triangle (LST, Phase 7) has quadratic
displacement and linear strain, so it represents bending far better. Note 6
redoes this study against an exact elasticity solution, with measured
convergence rates.

## Tests

[`tests/core/cst.test.ts`](../../tests/core/cst.test.ts):

- B and kₑ match a hand calculation for the unit right triangle.
- kₑ is symmetric and its rows sum to zero.
- Any linear displacement field gives exactly the right constant strain.
- Clockwise and collinear elements are rejected.

## Interview questions

- *Why "constant strain"?* Linear displacement means constant derivatives, so B
  is constant.
- *What is the rank of kₑ and why?* It is 3: 6 DOFs minus 3 rigid-body modes.
- *Why does a coarse CST mesh under-predict cantilever deflection?* It cannot
  represent linearly varying strain, so it picks up parasitic shear and is too
  stiff. Fix it by refining the mesh or using higher-order elements.
- *What is partition of unity and why does it matter?* ΣNᵢ = 1, so the element can
  represent rigid translation exactly. That is part of the completeness
  requirement for convergence.
