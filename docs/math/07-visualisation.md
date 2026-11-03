# 7. Reading the results: plots, deformation and peaks

Code: [`src/render/`](../../src/render/), [`src/results/summary.ts`](../../src/results/summary.ts),
[`src/worker/`](../../src/worker/), [`src/model/spec.ts`](../../src/model/spec.ts)

## The deformed shape is exaggerated, and that is legitimate

The solver is linear: K·u = F. Doubling the load exactly doubles u, so the
*shape* of the deformation is fixed and only its size changes. Displaying
x + s·u for any scale s therefore shows the true mode of deformation. By
default s is chosen so the largest displacement appears as 10% of the part
size, and the toolbar always shows the actual factor (for example ×40).

The catch: linear theory assumes small displacements and rotations. A ×40
picture does not mean the part can really bend that far. Large deflection
needs geometrically nonlinear analysis, which this solver does not do.

## Nodal vs element stress

| Mode | What is drawn | What it is |
|---|---|---|
| **Element** | one flat colour per triangle | The actual FE output: σₑ = D·B·uₑ, constant per CST |
| **Nodal** | colours interpolated between nodes | Area-weighted nodal averages (note 5), then smooth shading |

Toggling between the two is informative. Where neighbouring elements have very
different colours, the mesh is too coarse to resolve the gradient there. Those
jumps are a free, visual error indicator.

The hover probe interpolates with the element's own shape functions: at a
point with barycentric coordinates (L₁, L₂, L₃), value = Σ Lᵢ·vᵢ. That is
the same interpolation the element uses for displacement.

## Colour

- **Magnitudes** (von Mises, |u|) use a heat ramp whose lightness increases
  monotonically. Zero recedes into the dark background, and hot spots are the
  brightest thing on screen.
- **Signed stresses** (σx, σy, τxy) use a diverging blue ↔ red map with a
  neutral grey at zero. The range is symmetric, [−m, m], so zero is always
  the midpoint and tension and compression read as opposites. The red arm is
  computed to match the blue arm's OKLab lightness step for step, so neither
  sign looks more severe.
- **No rainbow (jet).** Its lightness goes up and down, which creates visible
  "edges" where the data has none, and it is hard to read with colour-vision
  deficiency. FEA tools often default to it anyway.
- **Bands** quantise the map into 10 flat steps, like a contour plot. That makes
  it easier to read off a value at a glance.

## Peak stress and the factor of safety

The results panel computes FoS = σy / max σvm. This needs care, because a
**peak stress is not always mesh-convergent**.

Measured on the cantilever preset (500 N, clamped wall), refining the mesh:

| Density | DOFs | Max \|u\| (mm) | Max σvm nodal (MPa) | Max σvm element (MPa) |
|---|---|---|---|---|
| 4 | 210 | 0.2246 | 124 | 128 |
| 8 | 738 | 0.2497 | 143 | 150 |
| 16 | 2 754 | 0.2569 | 156 | 167 |
| 32 | 10 626 | 0.2589 | 172 | 187 |
| 40 | 16 482 | 0.2591 | 178 | 195 |

Displacement converges, changing by 0.1% between the last two rows. The peak
stress keeps rising past beam theory's Mc/I = 150 MPa and will not settle. It
sits at the wall corners, where a fully clamped edge meets a free surface.
Poisson's effect wants the corner to contract, the clamp forbids it, and
elasticity theory predicts unbounded stress there: a **singularity**. Re-entrant
corners and point loads produce the same thing.

How to deal with a singularity:

- Don't read the peak at a singular point as a design value. Read stress a
  short distance away, which does converge. That is why the validation compares
  bending stress at midspan (note 6).
- Model the real detail instead: a fillet radius rather than a sharp corner, or
  a realistic support stiffness rather than a perfect clamp.
- Do a mesh refinement study. If the peak keeps growing as you refine, it is a
  singularity, not a stress concentration. A genuine K_t (like the plate with a
  hole) converges to a finite value.

## Running the solver off the main thread

Meshing and solving run in a Web Worker, so the page keeps responding while
PCG iterates.

- **Transferable buffers.** The result's typed arrays are *transferred* back,
  not copied: ownership of the memory moves to the main thread at zero cost.
- **Latest request wins.** Dragging the density slider fires many requests. The
  client keeps at most one queued, and drops results for requests that have
  since been superseded. The screen never shows a stale result over a newer one.
- **Serialisable models.** A job is plain data: preset, dimensions, density,
  material, thickness. That is why loads like the parabolic shear are turned into
  nodal forces before solving (note 3), instead of carrying a function.

## Equilibrium check on every solve

The results panel shows ΣR, ΣF and the imbalance |ΣR + ΣF| / |ΣF|. As note 3
explains, the FE solution satisfies global equilibrium exactly, up to solver
tolerance. A value around 10⁻¹¹ is expected. Anything large would mean a bug in
assembly or in the boundary conditions, so it is shown on every solve.

## Interview questions

- *The deformed shape looks huge. Is the part failing?* No. The display scale is
  ×N, and the true displacement is in the results panel.
- *Why do your stresses look blocky in element mode?* CST stress is constant per
  element. Nodal averaging smooths it for display.
- *Your peak stress keeps rising as you refine. Is your solver broken?* No. It is
  a singularity at a sharp, fully constrained corner. Look at the convergence of
  stress away from that point, or model the real geometry.
- *Why not use the jet colormap?* Its lightness is not monotone, which creates
  false features, and it fails for colour-blind readers.
- *How do you keep the UI responsive?* Solve in a Web Worker, transfer typed
  arrays without copying, and let the latest request win.
