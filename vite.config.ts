import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works under any GitHub Pages subpath.
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    // The solver is pure TypeScript; tests don't need a DOM.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
