import { defineConfig } from 'vitest/config';

// base relativo: o build funciona aberto de qualquer pasta ou no GitHub Pages.
export default defineConfig({
  base: './',
  // o teste diferencial com caches roda milhares de simulações; em máquinas lentas (ex.: dentro do Docker) passa de 5 s
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
});
