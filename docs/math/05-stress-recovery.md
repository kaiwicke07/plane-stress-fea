# 5. Stress recovery and von Mises

Code: [`src/core/postprocess.ts`](../../src/core/postprocess.ts),
[`src/core/solve.ts`](../../src/core/solve.ts)

## Element stresses

Once u is known, each element's stress is

    σₑ = D · B · uₑ

For CST this is one constant value per element. Displacements are continuous
across element edges, but their derivatives are not, so the stress **jumps**
between neighbouring elements. The size of those jumps is itself a useful
measure of discretisation error: it shrinks as the mesh converges.

## Nodal averaging, for smooth plots

To draw a continuous heatmap, each node gets the area-weighted average of the
elements around it:

    σₙ = Σ Aₑ σₑ / Σ Aₑ

**The stress components are averaged first, and von Mises is computed from the
averaged components.** Von Mises is a nonlinear function of the components, so
averaging von Mises values directly is not the same thing. The components are
what the FE solution approximates as a field.

Limitations to be upfront about:

- At a free boundary, a node has elements on one side only. Its average is
  biased toward the interior and is less accurate than at interior nodes. This
  matters for the hole-edge K_t in Phase 4, so each result states which recovery
  method it used.
- Better methods exist, such as superconvergent patch recovery (Zienkiewicz–Zhu),
  which fits a polynomial to stresses at the most accurate sampling points. That
  is a possible upgrade if the validation shows boundary error.

## Von Mises stress

Ductile metals yield when the **distortion (shape-change) energy** reaches its
value at yield in a uniaxial test. In terms of principal stresses:

    σvm = √( ½[(σ₁ − σ₂)² + (σ₂ − σ₃)² + (σ₃ − σ₁)²] )

In plane stress σ₃ = 0:

    σvm = √(σ₁² − σ₁σ₂ + σ₂²)

Expressed directly in x-y components, without finding principal stresses first:

    σvm = √(σx² − σx·σy + σy² + 3τxy²)

Sanity checks, all covered by unit tests:

| State | σvm |
|---|---|
| Uniaxial σ | σ |
| Equibiaxial σ, σ | σ |
| Pure shear τ | √3·τ |

The pure-shear case is why shear yield strength is about σy/√3 ≈ 0.577σy under
von Mises.

Factor of safety (for display): FoS = σy / max σvm. It is linear elastic, so the
number only means something while FoS > 1.

## Reactions

R = K·u − F at the prescribed DOFs. Their sum equals minus the applied load (see
note 3). That makes them a free check on any solve, and they are worth showing in
the results panel.

## Tests

- Von Mises for uniaxial, equibiaxial and pure-shear states.
- Area weighting: two elements with areas ½ and 3/2 and stresses 1 and 5 give 4
  at their shared nodes.
- Constant stress fields survive averaging unchanged (in the force patch test).

## Interview questions

- *Why is CST stress discontinuous between elements?* Displacement is C⁰
  continuous, so its derivatives are not.
- *Do you average von Mises or the components?* The components, because von
  Mises is nonlinear.
- *Why is the peak stress at a fillet or hole often under-predicted on coarse
  meshes?* Constant-strain elements smear the gradient, and boundary-node
  averaging is one-sided.
- *Derive von Mises in plane stress.* Set σ₃ = 0 in the distortion-energy
  expression.
