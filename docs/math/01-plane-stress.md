# 1. Plane stress and the D matrix

Code: [`src/core/material.ts`](../../src/core/material.ts)

## The assumption

A thin plate loaded only in its own plane has free faces at z = ±t/2, so the
stresses acting on those faces are zero there. If the plate is thin, they stay
approximately zero through the thickness:

    σz = τxz = τyz = 0

That leaves three unknown stresses, σx, σy and τxy, each a function of (x, y) only.

Plane strain is the opposite idealisation, for long or thick bodies like a dam or
a pipe cross-section. There the strain is zero (εz = 0), not the stress. It leads
to a different D matrix.

## From 3D Hooke's law to D

For an isotropic linear-elastic material:

    εx = (σx − ν·σy − ν·σz) / E
    εy = (σy − ν·σx − ν·σz) / E
    γxy = τxy / G,      G = E / (2(1 + ν))

With σz = 0:

    εx = (σx − ν·σy) / E
    εy = (σy − ν·σx) / E

Invert the 2×2 system by solving for σx and σy:

    σx = E/(1 − ν²) · (εx + ν·εy)
    σy = E/(1 − ν²) · (ν·εx + εy)

For shear, τxy = G·γxy. To write it with the same prefactor, use
1 − ν² = (1 − ν)(1 + ν):

    G = E / (2(1 + ν)) = E/(1 − ν²) · (1 − ν)/2

So

            E     ⎡ 1   ν      0      ⎤
    D  =  ──────  ⎢ ν   1      0      ⎥
          1 − ν²  ⎣ 0   0   (1 − ν)/2 ⎦

    {σx, σy, τxy} = D · {εx, εy, γxy}

## Details worth being precise about

- **Engineering shear strain.** γxy = ∂u/∂y + ∂v/∂x = 2εxy. With engineering
  strain, the strain energy density is simply ½(σx·εx + σy·εy + τxy·γxy) = ½σᵀε,
  so σ and ε pair up term by term. With tensor shear strain εxy, the last term of
  D would be (1 − ν) instead of (1 − ν)/2.
- **The thickness does change.** εz = −ν(σx + σy)/E is not zero, so the plate
  gets thinner under tension. The in-plane solve doesn't need εz, but it is why
  this is called plane *stress* and not plane *strain*.
- **D is symmetric positive definite** for −1 < ν < 0.5. Symmetry comes from the
  existence of a strain energy function. Positive definiteness means any nonzero
  strain stores positive energy. That property carries over to the global
  stiffness matrix (see note 3).
- **ν = 0.5 is fine in plane stress.** E/(1 − ν²) stays finite. In plane strain,
  D contains 1/(1 − 2ν) and blows up as ν → 0.5. That is the root of volumetric
  locking for rubber-like materials.

## Tests

[`tests/core/material.test.ts`](../../tests/core/material.test.ts):

- Uniaxial strain state: εx = σ/E, εy = −νσ/E gives back σx = σ and σy = 0.
- Shear: τ = G·γ with G = E/(2(1 + ν)).
- Non-physical E or ν is rejected.

## Interview questions

- *Plane stress or plane strain for a 3 mm bracket? For a dam cross-section?*
  Plane stress for the bracket, plane strain for the dam.
- *Why is the shear term (1 − ν)/2?* It is G written with the E/(1 − ν²)
  prefactor, and the factor of ½ comes from using engineering shear strain.
- *What happens to εz?* It is nonzero, −ν(σx + σy)/E, but it is not needed to
  solve the in-plane problem.
