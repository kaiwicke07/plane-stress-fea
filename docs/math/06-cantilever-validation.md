# 6. Cantilever validation

Code: [`src/validation/analytical.ts`](../../src/validation/analytical.ts),
[`src/validation/cases.ts`](../../src/validation/cases.ts),
[`src/validation/convergence.ts`](../../src/validation/convergence.ts),
[`src/mesh/structured.ts`](../../src/mesh/structured.ts)

Steel (E = 200 GPa, ν = 0.26), L = 100 mm, depth h = 2c = 20 mm,
t = 5 mm, end load P = 1000 N.

## Two different questions

1. **Is the FE code correct, and does it converge as theory says?** This needs a
   problem whose exact solution is known *for exactly the boundary conditions
   the FE model uses*. Then every bit of error is discretisation error.
2. **Does it agree with how an engineer would model a cantilever?** Wall fully
   clamped, compared with beam theory. Here part of the difference is modelling:
   beam theory and a clamped 2D wall are not the same problem.

Mixing the two up is the classic mistake. "My FE is 1% off beam theory" could
come from discretisation, from the wall model, or from beam theory's own
assumptions.

## The exact solution

Coordinates: wall at x = 0, free end at x = L, y measured from the neutral axis.
The free end carries a parabolic shear traction with resultant P downward. The
top and bottom faces are traction-free.

**Stresses.** Take σy = 0 and the parabolic shear from beam theory,
τxy = −P(c² − y²)/2I. It vanishes at y = ±c as the free faces require.
Equilibrium ∂σx/∂x + ∂τxy/∂y = 0 gives ∂σx/∂x = −Py/I. Integrating, with
σx = 0 at the free end, gives

    σx = P(L − x)·y / I,   σy = 0,   τxy = −P(c² − y²) / 2I

That is exactly M·y/I with M = −P(L − x). Beam theory's bending stress turns out
to be exact in 2D elasticity for this load case.

**Displacements.** Integrate the strains from Hooke's law:
εx = σx/E, εy = −νσx/E, γxy = τxy/G. Integrating εx in x and εy in y leaves
unknown functions g(y) and h(x). Substituting into γxy = ∂u/∂y + ∂v/∂x
separates into a function of x plus a function of y equal to a constant. That
fixes g and h up to three rigid-body constants:

    u = P·y·(Lx − x²/2)/EI − νP·y³/6EI + P·y³/6GI − P·c²·y/2GI
    v = −νP·(L − x)·y²/2EI − P·(Lx²/2 − x³/6)/EI

The constants are set by u = v = 0 and ∂v/∂x = 0 at the wall centre (0, 0). At
the tip this gives v(L, 0) = −PL³/3EI = −0.5000 mm, exactly the Euler–Bernoulli
value.

The test file [`analytical.test.ts`](../../tests/validation/analytical.test.ts)
checks this derivation independently of the FE code:
- equilibrium, by finite differences;
- strains computed from the displacements match Hooke's law;
- free faces are traction-free;
- the end traction integrates to P.

**Making the FE problem match.** u(0, y) is not zero: the wall section warps,
because u contains a y³ term. So the FE model *prescribes the exact u and v on
every wall node*. With that, the analytical field is the exact solution of the
discrete problem's boundary conditions too.

The end traction is applied as consistent nodal forces f = ∫Nᵀt̄·t ds using
2-point Gauss quadrature. That is exact here, because a linear shape function
times a quadratic traction is cubic. Approximating the parabola with linear
interpolation instead would put 25% of the load in the wrong place on the
coarsest mesh, and that load error would mix into the results.

## Error measures and expected rates

    displacement:  ‖u − uₕ‖_L2 / ‖u‖_L2,   ‖e‖²_L2 = ∫ |u − uₕ|² dA
    energy:        ‖u − uₕ‖_E  / ‖u‖_E,    ‖e‖²_E  = ∫ (σ − σₕ)ᵀ D⁻¹ (σ − σₕ) dA

Both are integrated per element with a 6-point, degree-4 triangle rule. Its
exactness up to degree 4 is a unit test.

Standard a-priori estimates for elements with polynomial degree p:

- Energy norm, which measures stress or strain error: O(hᵖ). For CST (p = 1)
  that is **O(h)**.
- L2 norm of displacement: one order higher, O(hᵖ⁺¹) (the Aubin–Nitsche
  argument). For CST that is **O(h²)**.
- Point displacements in smooth problems, such as the tip deflection: typically
  also **O(h²)**.

The observed order between two meshes is p = log(e₁/e₂) / log(h₁/h₂).

## Results: exact wall, alternating diagonals

Square cells, nx = 5·ny.

| ny | DOFs | tip error | L2 error | energy error | PCG iterations |
|---|---|---|---|---|---|
| 2 | 66 | 39.0% | 39.1% | 63.0% | 31 |
| 4 | 210 | 13.6% | 13.6% | 36.8% | 87 |
| 8 | 738 | 3.76% | 3.76% | 19.3% | 172 |
| 16 | 2 754 | 0.965% | 0.965% | 9.73% | 345 |
| 32 | 10 626 | 0.243% | 0.243% | 4.88% | 689 |

| Observed order | 2→4 | 4→8 | 8→16 | 16→32 | Theory |
|---|---|---|---|---|---|
| tip | 1.52 | 1.85 | 1.96 | **1.99** | 2 |
| L2 | 1.53 | 1.85 | 1.96 | **1.99** | 2 |
| energy | 0.78 | 0.93 | 0.98 | **1.00** | 1 |

The rates approach their theoretical values once the mesh is fine enough to be
in the *asymptotic range*. The coarse meshes are pre-asymptotic, which is why
the first rates are low.

A useful way to read the energy error: stresses are 10× less accurate than
displacements on the same mesh. At ny = 32, tip deflection is within 0.24% but
the energy-norm error is still 4.9%. "The displacement converged" does not mean
"the stress converged".

**Mesh pattern matters.** With every diagonal in the same direction ('right'),
errors are about 35% larger at the same DOF count. The convergence rates are
the same, and PCG took about twice as many iterations. Alternating diagonals
remove the directional bias, so they are the default.

## Results: clamped wall vs beam theory

| ny | FE tip (mm) | FE / Timoshenko |
|---|---|---|
| 8 | 0.4941 | 0.959 |
| 16 | 0.5085 | 0.987 |
| 32 | 0.5123 | 0.9945 |
| 64 | 0.5133 | 0.9964 |
| Richardson (16, 32) | **0.5136** | **0.997** |

**Richardson extrapolation.** If q(h) ≈ q* + C·hᵖ with a known p, then solutions
at h and h/2 give q* ≈ q_fine + (q_fine − q_coarse)/(2ᵖ − 1). With p = 2,
extrapolating from 16 and 32 gives 0.51356, and from 32 and 64 gives 0.51360.
Two independent pairs agree to 4 digits, so the converged clamped deflection is
0.5136 mm.

**Where the converged answer sits:**

| Model | Tip deflection (mm) |
|---|---|
| Exact elasticity, ∂v/∂x = 0 at wall centre | 0.5000 (= PL³/3EI) |
| **FE, fully clamped wall (converged)** | **0.5136** |
| Timoshenko beam, κ = 5/6 | 0.5151 |
| Exact elasticity, ∂u/∂y = 0 at wall centre | 0.5189 |

The shear contribution to deflection depends on how the wall is idealised.
A fully clamped edge falls between the two point-wise idealisations, and lands
0.3% below Timoshenko's κ = 5/6. That 0.3% is modelling difference, not FE
error, and you can only say that with confidence because the exact-wall study
already established how big the FE error is.

## Results: midspan bending stress

σx at the top fibre at x = L/2 is compared with Mc/I = 150 MPa. That value is
also exact in elasticity, and it is the same for both wall conditions to 4
digits, by St. Venant's principle: midspan is 2.5 depths from the wall.

| ny | FE / Mc/I |
|---|---|
| 4 | 0.650 |
| 8 | 0.842 |
| 16 | 0.929 |
| 32 | 0.966 |
| Richardson (16, 32), p = 1 | 1.004 |

Stress converges only at **O(h)**, and from below. The top-fibre value is a
nodal average of constant-stress elements whose centroids sit h/3 to 2h/3 below
the surface, where σx is lower. This is the boundary averaging bias described in
note 5.

**This matters for the plate with a hole.** K_t is also a peak stress on a free
boundary. Plain nodal averaging will under-predict it unless the mesh is graded
finely toward the hole. Phase 4 should either grade the mesh strongly, or use a
better recovery method (extrapolating to the surface, or superconvergent patch
recovery), and report which one was used.

## Tests

[`cantilever.test.ts`](../../tests/validation/cantilever.test.ts) runs the same
case functions as the site will:

- Every error measure decreases with refinement.
- The final observed orders are within [1.9, 2.1] for tip and L2, and within
  [0.95, 1.05] for energy.
- Tip error is below 0.3% at ny = 32.
- Alternating diagonals beat single-direction diagonals.
- The Richardson-extrapolated clamped tip is within 0.5% of Timoshenko.
- Midspan stress converges at O(h) from below, and extrapolates to within 1%.

## Interview questions

- *How do you validate an FE code?* Use a problem with an exact solution and
  matching boundary conditions, then show the error converges at the theoretical
  rate. Matching a single number is not enough; the rate is the real check.
- *Your FE is 0.3% off beam theory. Is that error?* Not necessarily. Separate
  discretisation error (from the convergence study) from modelling differences
  (wall idealisation, beam assumptions).
- *Why does stress converge more slowly than displacement?* Stress is a
  derivative of displacement and loses one order: O(h) vs O(h²) for CST.
- *What is Richardson extrapolation?* Use the known convergence order to cancel
  the leading error term from two meshes.
- *Why prescribe a non-zero displacement on the wall?* So the exact solution
  satisfies the FE model's boundary conditions. The real section warps.
