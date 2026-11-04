import { useSyncExternalStore } from 'react';
import { App } from './App';
import { type Page, SiteHeader } from './SiteHeader';
import { ValidationPage } from './validation/ValidationPage';

// Hash routing (#/validation) works on any static host, GitHub Pages included,
// without server-side rewrites.
function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function currentPage(): Page {
  return window.location.hash.startsWith('#/validation') ? 'validation' : 'solver';
}

export function Root() {
  const page = useSyncExternalStore(subscribe, currentPage);
  return (
    <div className="shell">
      <SiteHeader page={page} />
      {page === 'validation' ? <ValidationPage /> : <App />}
    </div>
  );
}
