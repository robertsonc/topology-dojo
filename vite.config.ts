import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as never);
