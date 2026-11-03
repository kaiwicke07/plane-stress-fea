# Plane Stress FEA

A 2D finite element solver that runs in the browser. Draw a part or pick a preset,
apply supports and loads, choose a material, and view displacements, von Mises
stress and the deformed shape. The FEA core, meshing and linear algebra are written
from scratch, and results are validated against analytical solutions.

See [docs/PLAN.md](docs/PLAN.md) for the roadmap and validation definitions, and
[docs/math/](docs/math/README.md) for the derivation behind each part of the solver.

## Development

Requires Node 24+.

```bash
npm install
npm run dev        # dev server
npm test           # unit tests
npm run lint
npm run build      # type-check and build static site into dist/
```

Pushing to `main` runs CI and deploys `dist/` to GitHub Pages.
