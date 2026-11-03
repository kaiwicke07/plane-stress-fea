// Phase 0 shell: fixes the layout and theme. Panels are filled in from Phase 3 on.
export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Plane Stress FEA</h1>
        <span className="app-tag">linear · plane stress · triangular elements</span>
      </header>

      <aside className="panel panel-model" aria-label="Model">
        <h2>Model</h2>
        <p className="muted">Geometry, mesh, material, supports and loads.</p>
      </aside>

      <main className="viewport" aria-label="Viewport">
        <p className="muted">Viewport</p>
      </main>

      <aside className="panel panel-results" aria-label="Results">
        <h2>Results</h2>
        <p className="muted">Displacement, von Mises stress, factor of safety.</p>
      </aside>
    </div>
  );
}
