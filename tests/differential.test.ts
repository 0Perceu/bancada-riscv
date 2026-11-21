/**
 * Teste diferencial: programas aleatórios devem terminar com o mesmo estado
 * no monociclo (referência), no pipeline com forwarding e no pipeline sem forwarding.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/core/session';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomProgram(seed: number): string {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const regs = ['t0', 't1', 't2', 't3', 't4', 'a0', 'a1'];
  const lines = ['        la s0, buf'];
  for (const x of regs) lines.push(`        li ${x}, ${Math.floor(r() * 200) - 100}`);
  const n = 40;
  let label = 0;
  for (let i = 0; i < n; i++) {
    const k = r();
    const rd = pick(regs), a = pick(regs), b = pick(regs);
    if (k < 0.35) lines.push(`        ${pick(['add', 'sub', 'xor', 'or', 'and', 'slt', 'sltu', 'sll', 'srl', 'sra'])} ${rd}, ${a}, ${b}`);
    else if (k < 0.55) lines.push(`        ${pick(['addi', 'xori', 'ori', 'andi', 'slti'])} ${rd}, ${a}, ${Math.floor(r() * 64) - 32}`);
    else if (k < 0.62) lines.push(`        ${pick(['slli', 'srli', 'srai'])} ${rd}, ${a}, ${Math.floor(r() * 31)}`);
    else if (k < 0.75) lines.push(`        ${pick(['lw', 'lh', 'lb', 'lbu', 'lhu'])} ${rd}, ${4 * Math.floor(r() * 16)}(s0)`);
    else if (k < 0.87) lines.push(`        ${pick(['sw', 'sh', 'sb'])} ${a}, ${4 * Math.floor(r() * 16)}(s0)`);
    else {
      const skip = 1 + Math.floor(r() * 3);
      lines.push(`        ${pick(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'])} ${a}, ${b}, L${label}`);
      for (let j = 0; j < skip; j++) lines.push(`        addi ${pick(regs)}, ${pick(regs)}, ${j + 1}`);
      lines.push(`L${label++}:`);
    }
  }
  lines.push('        ecall', '.data', 'buf: .space 68');
  return lines.join('\n');
}

describe('teste diferencial: pipeline x monociclo', () => {
  it('300 programas aleatórios terminam no mesmo estado', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const src = randomProgram(seed);
      const ref = new Session(src, { model: 'single', forwarding: true });
      ref.run();
      for (const forwarding of [true, false]) {
        const s = new Session(src, { model: 'pipeline', forwarding });
        s.run();
        expect(s.done, `seed ${seed}`).toBe(true);
        expect(Array.from(s.machine.regs), `seed ${seed} fw=${forwarding}`).toEqual(Array.from(ref.machine.regs));
        expect(s.mem.bytes.slice(0x1000, 0x1100), `seed ${seed} memória`).toEqual(ref.mem.bytes.slice(0x1000, 0x1100));
        expect(s.machine.stats.retired).toBe(ref.machine.stats.retired);
      }
    }
  });
});
