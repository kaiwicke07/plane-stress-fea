# 8. Meshing, stress recovery and the plate with a hole

Code: [`src/mesh/delaunay.ts`](../../src/mesh/delaunay.ts),
[`src/mesh/distmesh.ts`](../../src/mesh/distmesh.ts),
[`src/mesh/geometry.ts`](../../src/mesh/geometry.ts),
[`src/mesh/quality.ts`](../../src/mesh/quality.ts),
[`src/core/postprocess.ts`](../../src/core/postprocess.ts) (`sprNodalStress`),
[`src/validation/plate-cases.ts`](../../src/validation/plate-cases.ts)

## Delaunay triangulation

A triangulation is **Delaunay** if no point lies inside any triangle's
circumcircle. Of all triangulations of a point set, it maximises the smallest
angle. That matters for FE because slivers (very thin triangles) make B large
and poorly conditioned, and they hurt accuracy.

**Bowyer–Watson** builds it one point at a time:

1. Start with a "super-triangle" that contains every point.
2. For each new point p:
   1. **Locate** the triangle containing p by walking: from any triangle, cross
      an edge that p is on the far side of, and repeat.
   2. **Cavity**: collect every triangle whose circumcircle contains p, by
      searching neighbours outward from the located triangle. These triangles
      are no longer Delaunay once p exists, and they always form a connected,
      star-shaped region around p.
   3. Delete the cavity and **re-fill** it with a fan of triangles from p to each
      edge of the cavity boundary.
3. Remove every triangle that touches a super-triangle vertex.

Each triangle stores its three neighbours, so the cavity search is local.
Inserting points in a "snake" order (horizontal bands, alternating direction)
keeps each walk short. 20 000 random points take well under a second, which
matters because DistMesh re-triangulates dozens of times.

**Three robustness lessons, each found by a failing test:**

- **The super-triangle must be far away.** A triangle with one super vertex has
  a circumcircle that bulges past the hull edge by about ℓ²/8R. Points inside
  that bulge get attached to the super vertex and vanish when super triangles
  are removed, leaving gaps along the hull. With R = 20× the domain, 19 of
  40 000 triangles went missing. With R = 10⁴× none do.
- **Collinear boundary points.** DistMesh puts many points exactly on straight
  edges. If p lies exactly on a cavity boundary edge, the fan creates a
  zero-area triangle. The fix: absorb the triangle across any edge that p does
  not see strictly from inside, so the cavity stays star-shaped from p.
- **Floating-point orientation is not antisymmetric.** orient(a, b, p) is not
  exactly −orient(b, a, p). For a point almost on an edge, both triangles
  sharing that edge said "outside", and point location failed even though the
  triangulation covered the plane (checked: total area exact, nothing inverted).
  The fix: always evaluate an edge in a fixed vertex order (lower index first)
  and negate as needed.

## DistMesh (Persson & Strang, 2004)

**Geometry as a signed distance function** d(x, y): negative inside, zero on the
boundary, positive outside. Constructive operations become one-liners:

- difference A − B: max(d_A, −d_B)
- union: min(d_A, d_B)
- intersection: max(d_A, d_B)

The quarter plate is rectangle − circle. The max is exact in sign everywhere and
a distance bound near corners, which is all DistMesh needs.

**Algorithm:**

1. Seed points on an equilateral grid with spacing h_min. Keep each with
   probability (h_min / h(x))², so the point density follows the size function.
2. Fixed points go first: corners of the region, and points where a circular
   hole cuts an outer edge, such as (a, 0) and (0, a) for the quarter plate.
3. Repeat:
   - Delaunay-triangulate. Drop triangles whose centroid has d > 0.
   - Treat every edge as a spring with rest length L₀ = F·h(midpoint)·s, where
     s scales the springs to fill the region and F = 1.2 > 1. Springs only push
     (force max(L₀ − L, 0)), so the network is under internal pressure and
     spreads to the boundary.
   - Move the points by Δt·F.
   - **Project** any point that left the region back onto the boundary:
     p ← p − d(p)·∇d / |∇d|², with ∇d by finite differences.
   - Stop when the largest interior step is below 10⁻³ of the local element size.

**Graded meshes need relative tolerances.** The original tolerances are absolute
multiples of h_min. In a mesh graded from h_min at the hole to 30·h_min far away,
the large elements move much further than h_min without any change in
connectivity. An absolute threshold re-triangulated almost every iteration
(305 times in 400) and never converged. Measuring each point's movement
relative to its own target size cut that to about 55.

**Run to convergence.** The converged quarter-plate meshes have minimum angles
of 35–38°, mean radius ratio 0.977, and no element with q < 0.5. Stopping early
(50–250 iterations) left occasional 2–20° slivers. The cap is therefore 1000
iterations.

**Quality measure:** radius ratio q = 2·r_in / r_circ = (b+c−a)(c+a−b)(a+b−c)/(abc).
It is 1 for an equilateral triangle and tends to 0 for a sliver.

**Boundary tags.** An edge used by only one triangle is a boundary edge. Taken in
the triangle's counter-clockwise order, the material is on its left, so the
outward normal is (Δy, −Δx)/ℓ. Each boundary edge is tagged with the geometry
curve nearest its midpoint, which is how supports and loads on geometry edges
find their mesh edges.

## Stress recovery: SPR

Nodal averaging (note 5) is one-sided at a boundary node: all its elements lie on
one side, so it reports the stress a fraction of an element *inside* the
surface. Where stress peaks at the surface, it reads low.

**Superconvergent patch recovery (Zienkiewicz–Zhu):**

- For each interior node, take the patch of elements around it and fit
  σ*(x, y) = a + bx + cy by least squares to the element centroid stresses. The
  centroid is where a constant-strain element's stress is most accurate.
- An interior node gets σ* evaluated at itself.
- A boundary node gets the mean of the fits from neighbouring interior patches,
  evaluated at the boundary node. That **extrapolates the gradient to the surface**
  instead of averaging from one side.
- A corner node whose only element has all its nodes on the boundary is reached
  by no interior patch. The quarter plate's peak point (0, a) is exactly such a
  node. It uses the fits from the next ring of interior nodes out. Without that
  step, SPR silently fell back to averaging at the one point that matters.

SPR reproduces any linear stress field exactly at every node, boundary included.
That is a unit test; nodal averaging fails it at the boundary.

**What SPR does and does not fix (cantilever midspan, FE / Mc/I):**

| Cells through depth | Nodal average | SPR |
|---|---|---|
| 4 | 0.650 | 0.787 |
| 8 | 0.842 | 0.919 |
| 16 | 0.929 | 0.968 |
| 32 | 0.966 | 0.986 |

SPR roughly halves the surface error. It is **not** superconvergent here: both
columns converge at about O(h) (observed order 1.1 averaged, 1.2 SPR). SPR
removes the averaging bias, but the CST's own O(h) stress error, made worse in
bending by parasitic shear, remains. Expecting O(h²) was wrong, and the test
asserts what is actually true.

## Plate with a hole: definitions

Full plate width W across the load, hole diameter d = 2a, uniaxial tension along x.

| Quantity | Definition |
|---|---|
| σ_gross | P/(W·t), the applied far-field traction |
| σ_net | P/((W − d)·t) = σ_gross · W/(W − d) |
| σ_max | σxx at the hole edge on the net section, (0, a). It equals the hoop stress σθθ there, and von Mises too, since the stress state is uniaxial. |
| K_t,g | σ_max / σ_gross |
| K_t,n | σ_max / σ_net = K_t,g · (1 − d/W) |

**References, each on its own basis:**

- **Kirsch (gross, infinite plate):** K_t,g = 3. Along the net section,
  σxx/σ_gross = 1 + ½(a/y)² + (3/2)(a/y)⁴.
- **Heywood (net, finite width, empirical):** K_t,n ≈ 2 + (1 − d/W)³.

In code every FE result is a `StressConcentration { basis, value }` together
with the recovery method used. Labels are generated from the basis. A converted
value (for example Heywood expressed on the gross basis, to compare with a
gross FE value) is created only by `convertKt` and shown as converted.

**The model** is a quarter plate: rollers on x = 0 (u = 0) and y = 0 (v = 0)
enforce symmetry, and the far edge carries σ_gross. Length L = 2W, so the
far-field stress is uniform where it is applied.

## Plate results

**A refinement study must refine everywhere.** The first study shrank only the
hole-edge size and kept the growth rate fixed, so a short distance from the hole
the mesh stayed coarse. K_t wandered (3.00, then 3.02, then 2.996) instead of
converging. The fix is a self-similar size function, h(x) = (a/k)·(1 + 2·dist/a),
capped at 30a/k. Doubling k halves the element size everywhere.

**A single node is a noisy sample.** On an unstructured mesh, the value at (0, a)
depends on how that particular mesh happens to fall around the corner. Even with
SPR it scatters by about ±2%. A more robust estimator fits the SPR hoop stress
along the hole edge within 30° of the peak to σθθ ≈ A + B·cos 2φ, the form of
Kirsch's solution, and takes the peak A + B. That uses many nodes and needs no
extrapolation.

**Wide plate, W/d = 10, gross basis** (reference: Kirsch 3.000; Heywood
converted to gross 3.032):

| k (elements per radius) | DOFs | K_t,g, node average | K_t,g, SPR node | K_t,g, SPR hole-edge fit |
|---|---|---|---|---|
| 8 | 278 | 2.935 | 2.881 | 2.849 |
| 16 | 1 072 | 3.012 | 3.005 | 2.975 |
| 32 | 3 938 | 3.035 | 3.029 | **3.031** |

At k = 32 the fitted K_t,g is within 0.06% of Heywood's finite-width value, and
1.0% above Kirsch. Heywood predicts a 1.07% rise for W/d = 10, so that 1% is the
finite width, not error. Along the net section, SPR follows Kirsch's decay to
within 2.5% for a ≤ y − a ≤ 3a. That remaining difference is also finite width.

**Finite plates, net basis**, k = 32 (W = 50, L = 100):

| d/W | Heywood K_t,n | FE K_t,n, SPR hole-edge fit | Difference | FE, single node average |
|---|---|---|---|---|
| 0.1 | 2.729 | 2.728 | −0.06% | +0.10% |
| 0.2 | 2.512 | 2.507 | −0.21% | +1.11% |
| 0.3 | 2.343 | 2.361 | +0.77% | −2.56% |
| 0.4 | 2.216 | 2.239 | +1.06% | +1.47% |
| 0.5 | 2.125 | 2.161 | +1.69% | +3.11% |

The fitted values differ from Heywood smoothly and increasingly with d/W. The
single-node values scatter in sign and size. Heywood's formula is an empirical
fit, so a difference of a percent or two at large d/W is not evidence of FE
error. The convergence study above is what establishes the FE accuracy.

## Interview questions

- *Why Delaunay?* It maximises the minimum angle among all triangulations of the
  points. Slivers hurt FE accuracy and conditioning.
- *How does DistMesh work?* Signed distance geometry, spring forces with target
  lengths from a size function, projection of escaped points back onto the
  boundary, and Delaunay re-triangulation as points move.
- *What is the difference between K_t,g and K_t,n?* The reference stress: far-field
  gross or net section. They differ by W/(W − d). For d/W = 0.2: K_t,n ≈ 2.51,
  K_t,g ≈ 3.14.
- *Your plate K_t is 1% above Kirsch. Is that error?* No. Kirsch is an infinite
  plate; finite width raises K_t,g, and Heywood predicts +1.07% at W/d = 10.
- *How do you get an accurate peak stress at a surface from CST?* Grade the mesh
  toward the peak, use SPR rather than plain averaging, and fit along the surface
  rather than reading one node. Then show convergence.
- *Why is your stress recovery called "superconvergent" if it converged at O(h)
  in bending?* Superconvergence of SPR depends on the element and the mesh. For
  CST in bending it removed the boundary bias but not the element's own O(h)
  error. Measured results beat the name.
