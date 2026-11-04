export type Page = 'solver' | 'validation';

/** A triangle split into four: the mesh element, as the site's mark. */
function Logo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 3.5 21 19.5H3Z M7.5 11.5h9 M12 19.5 7.5 11.5 M12 19.5l4.5-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The bar across the top of every page: the name, and the two pages. */
export function SiteHeader({ page }: { page: Page }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a href="#/" className="brand" aria-label="Plane Stress FEA, solver">
          <span className="brand-mark">
            <Logo />
          </span>
          <span className="brand-name">Plane Stress FEA</span>
        </a>
        <nav className="site-nav" aria-label="Pages">
          <a href="#/" aria-current={page === 'solver' ? 'page' : undefined}>
            Solver
          </a>
          <a href="#/validation" aria-current={page === 'validation' ? 'page' : undefined}>
            Validation
          </a>
        </nav>
      </div>
    </header>
  );
}
