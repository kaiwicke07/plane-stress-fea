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

The whole pipeline in one line:

    D (material) → B, kₑ = tA·BᵀDB (element) → K = Σ kₑ (assembly)
      → K_ff·u_f = F_f − K_fc·u_c (BCs) → PCG → σₑ = D·B·uₑ → σvm
