export type Page = 'solver' | 'validation';

export function SiteHeader({ page }: { page: Page }) {
  return (
    <header className="app-header">
      <h1>Plane Stress FEA</h1>
      <span className="app-tag">linear · plane stress · triangular elements</span>
      <nav className="site-nav" aria-label="Pages">
        <a href="#/" aria-current={page === 'solver' ? 'page' : undefined}>
          Solver
        </a>
        <a href="#/validation" aria-current={page === 'validation' ? 'page' : undefined}>
          Validation
        </a>
      </nav>
    </header>
  );
}
