# Math notes

One note per part of the solver, in the order the data flows. Each note
covers the derivation, the code that implements it, the tests that check it,
and likely interview questions.

1. [Plane stress and the D matrix](01-plane-stress.md)
2. [The constant strain triangle](02-cst-element.md)
3. [Assembly, loads and boundary conditions](03-assembly-and-boundary-conditions.md)
4. [Solving K·u = F](04-linear-solvers.md)
5. [Stress recovery and von Mises](05-stress-recovery.md)
6. [Cantilever validation](06-cantilever-validation.md): exact solution, error norms, convergence rates
7. [Reading the results](07-visualisation.md): deformation scale, nodal vs element plots, colour, singular peaks
8. [Meshing, stress recovery and the plate with a hole](08-meshing.md): Delaunay, DistMesh, SPR, K_t by basis
9. [The geometry editor](09-geometry-editor.md): orientation tests, polygon validity, stable edge IDs, undo
10. [The 6-node LST element](10-lst-element.md): isoparametric mapping, Gauss quadrature, curved edges, CST vs LST

The whole pipeline in one line:

    D (material) → B, kₑ = tA·BᵀDB (element) → K = Σ kₑ (assembly)
      → K_ff·u_f = F_f − K_fc·u_c (BCs) → PCG → σₑ = D·B·uₑ → σvm
