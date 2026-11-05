import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Same alias as tsconfig "paths", so tests can import '@/lib/...'
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // tsconfig says jsx "preserve" (Next compiles JSX itself); tests need the
  // same automatic runtime Next uses, so components need no React import
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
