import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    // Script-level Node tests run separately via `node --test` in package.json.
    exclude: ['scripts/**', 'node_modules/**', 'dist/**'],
  },
});
