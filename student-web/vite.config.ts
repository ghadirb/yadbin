import { defineConfig } from 'vite';

// API base URL comes from the environment (VITE_API_BASE), never hard-coded.
// In dev, /api is proxied to the local Worker (`wrangler dev`, port 8787).
export default defineConfig({
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' }, fs: { allow: ['..'] } },
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 60000 },
});
