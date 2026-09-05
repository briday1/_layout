import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@briday1/layout/styles.css': new URL('../../packages/layout/src/styles.css', import.meta.url).pathname,
      '@briday1/layout': new URL('../../packages/layout/src/index.ts', import.meta.url).pathname,
      '@briday1/layout-pug-sankey': new URL('../../packages/pug-sankey/src/index.ts', import.meta.url).pathname,
    },
  },
});
