# Project plan

A browser-based 2D linear-elastic, plane-stress FEA solver. The FEA core, meshing
and linear algebra are written from scratch. Units throughout are **N, mm, MPa**,
with a thickness `t` in mm.

## Phases

| # | Phase | Done when |
|---|-------|-----------|
| 0 | Setup: Vite + React + TS, Vitest, ESLint, Pages deploy | CI runs lint, tests and build; site deploys |
| 1 | Solver core with hand-built meshes: D matrix, CST, sparse assembly, DOF partitioning, PCG, reactions, stress recovery | Single-element, rigid-body, patch and equilibrium tests pass |
| 2 | Structured mesher + cantilever validation | Tip deflection converges to beam theory under refinement |
| 3 | Viewport (WebGL2 field + Canvas2D overlay), presets, material picker, solver in a Web Worker | Presets solve and render with deformed shape |
| 4 | Bowyer–Watson Delaunay + DistMesh, quality metrics, plate-with-hole validation | Kt matches references (see below) |
| 5 | Geometry editor: polygons, holes, edge picking, supports and tractions | User-drawn part solves end to end |
| 6 | Validation page: FEA vs analytical plots, error tables, convergence plots | Same cases run in Vitest and on the site |
| 7 | 6-node quadratic triangle (LST), CST vs LST comparison, README and polish | LST cantilever matches beam theory on a coarse mesh |

## Modelling rules

- Loads are edge tractions converted to consistent nodal forces, never point loads,
  because a point load in 2D elasticity gives unbounded stress.
- Constraints are per degree of freedom (fix x, fix y, or both), so symmetry
  planes can be modelled as rollers.
- Supports and loads attach to geometry edges, not mesh nodes, so they survive
  re-meshing.

## Validation cases

### Cantilever

Compare tip deflection with Euler–Bernoulli beam theory plus the Timoshenko shear
term: δ = PL³/(3EI) + PL/(κGA), with I = t·h³/12 and κ = 5/6.

Compare bending stress σ = Mc/I at x = L/2, **not at the wall**. The fully fixed
corners are stress singularities and never converge.

### Plate with a hole: stress definitions

Kirsch and Heywood normalise the peak stress by different reference stresses.
Every number and plot on the site states which one it uses.

Notation: plate width `W`, hole diameter `d = 2a`, thickness `t`, axial load `P`
along x, applied as a uniform traction on the far edges.

| Symbol | Definition | Meaning |
|--------|------------|---------|
| σ_gross | P / (W·t) | Far-field stress. Equals the applied traction. |
| σ_net | P / ((W − d)·t) = σ_gross · W / (W − d) | Average stress over the net section through the hole |
| σ_max | σ_xx at the hole edge on the net section, (0, ±a) | Peak stress in the load direction |
| K_t,g | σ_max / σ_gross | Gross-section stress concentration factor |
| K_t,n | σ_max / σ_net | Net-section stress concentration factor |

The two are related by K_t,g = K_t,n · W / (W − d).

**Comparison 1: Kirsch (gross basis, infinite plate).**
Along the net section (x = 0, y ≥ a):

    σ_xx(0, y) / σ_gross = 1 + ½(a/y)² + (3/2)(a/y)⁴

so K_t,g = 3 at y = a. The solution assumes an infinite plate, so this comparison
uses a wide plate (W/d ≥ 8) that is long enough for the far-field stress to
become uniform. Plotted as σ_xx / σ_gross.

**Comparison 2: Heywood (net basis, finite width).**

    K_t,n ≈ 2 + (1 − d/W)³

This is an empirical fit for finite-width plates. FEA reports K_t,n = σ_max / σ_net
for several d/W ratios.

Worked example at d/W = 0.2: Heywood gives K_t,n ≈ 2.512, which corresponds to
K_t,g ≈ 3.14. Gross-section K_t rises above 3 as the plate narrows, while
net-section K_t falls below 3.

**Rules:**
- An FEA K_t is only compared against a reference on the same basis. When a value
  is converted to the other basis, it is labelled as converted.
- In code, every stress concentration result carries an explicit
  `basis: 'gross' | 'net'` field, and UI labels are generated from that field,
  never typed by hand.
- σ_max is the normal stress in the load direction, not von Mises. At a free hole
  edge the exact stress state is uniaxial, so the two coincide there. FEA values at
  boundary nodes come from stress recovery, and the recovery method is stated
  alongside the result.
