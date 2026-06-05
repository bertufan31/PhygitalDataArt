import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Multi-page app: the audience-facing display (index.html) and the
// presenter's control panel (control.html) are two separate entry points
// served from the same origin (so BroadcastChannel can sync them).
//
// `base` is left at '/' for local dev + preview. The GitHub Pages build
// passes the correct project base path via the CLI, e.g.
//   vite build --base=/PhygitalDataArt/
// (see .github/workflows/deploy.yml), so links/assets resolve under the
// repo subpath without affecting local development.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        display: resolve(__dirname, 'index.html'),
        control: resolve(__dirname, 'control.html'),
        brands: resolve(__dirname, 'brands.html'),
      },
    },
  },
});
