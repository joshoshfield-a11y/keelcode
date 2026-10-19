import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@keel': path.resolve(__dirname, 'src'),
    },
  },
  // The Havok WASM bundle must not be pre-bundled by the dev optimizer:
  // it is fetched separately via the `?url` import in engine/physics.ts.
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
