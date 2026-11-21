import { defineConfig } from 'vitest/config';

// base relativo: o build funciona aberto de qualquer pasta ou no GitHub Pages.
export default defineConfig({
  base: './',
  test: { include: ['tests/**/*.test.ts'] },
});
