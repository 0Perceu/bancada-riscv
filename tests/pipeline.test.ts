import { describe, expect, it } from 'vitest';
import { Session } from '../src/core/session';
import { FIGURES } from '../src/programs';

const run = (src: string, model: 'single' | 'pipeline', forwarding = true) => {
  const s = new Session(src, { model, forwarding });
  s.run();
  expect(s.done).toBe(true);
  return s;
};

const fig = (id: string) => FIGURES.find((f) => f.id === id)!.source;

describe('resultados dos programas da trilha', () => {
  it('soma de 1 a 10', () => {
    for (const s of [run(fig('fig01'), 'single'), run(fig('fig01'), 'pipeline'), run(fig('fig01'), 'pipeline', false)]) {
      expect(s.machine.regs[10]).toBe(55);
      expect(s.mem.read32(0x1000)).toBe(55);
    }
  });

  it('fibonacci', () => {
    const s = run(fig('fig07'), 'pipeline');
    const fib = Array.from({ length: 12 }, (_, i) => s.mem.read32(0x1000 + 4 * i));
    expect(fib).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
  });

  it('bubble sort', () => {
    for (const fw of [true, false]) {
      const s = run(fig('fig08'), 'pipeline', fw);
      const v = Array.from({ length: 8 }, (_, i) => s.mem.read32(0x1000 + 4 * i));
      expect(v).toEqual([1, 3, 7, 19, 25, 42, 60, 88]);
    }
  });
});

describe('temporização do pipeline', () => {
  it('sem dependências: N instruções levam N + 4 ciclos', () => {
    const s = run('li t0, 1\nli t1, 2\nli t2, 3\nli t3, 4\necall', 'pipeline');
    expect(s.machine.stats.retired).toBe(5);
    expect(s.machine.stats.cycles).toBe(5 + 4);
    expect(s.machine.stats.stalls).toBe(0);
  });

  it('cadeia de dependências: 2 bolhas cada sem forwarding, 0 com', () => {
    const sem = run(fig('fig02'), 'pipeline', false);
    const com = run(fig('fig02'), 'pipeline', true);
    expect(sem.machine.stats.stalls).toBe(4 * 2);
    expect(com.machine.stats.stalls).toBe(0);
    expect(sem.machine.stats.cycles - com.machine.stats.cycles).toBe(8);
    expect(com.machine.regs[29]).toBe(sem.machine.regs[29]);
  });

  it('load-use: exatamente 1 bolha com forwarding', () => {
    const s = run(fig('fig04'), 'pipeline', true);
    expect(s.machine.stats.stalls).toBe(1);
    expect(s.machine.regs[6]).toBe(14);
    expect(s.machine.regs[28]).toBe(22);
    expect(s.machine.regs[31]).toBe(14);
  });

  it('desvios tomados descartam 2 instruções cada', () => {
    const s = run(fig('fig05'), 'pipeline', true);
    expect(s.machine.regs[10]).toBe(4);
    expect(s.machine.regs[7]).toBe(0); // li t2, 99 nunca executa
    expect(s.machine.stats.flushes).toBe((3 + 1) * 2);
  });

  it('nada depois do ecall altera a memória', () => {
    const s = run('li t0, 7\nla t1, x\necall\nsw t0, 0(t1)\n.data\nx: .word 0', 'pipeline');
    expect(s.mem.read32(0x1000)).toBe(0);
  });
});

describe('voltar no tempo', () => {
  it('voltar até o início restaura registradores, memória e PC', () => {
    const s = new Session(fig('fig07'), { model: 'pipeline', forwarding: true });
    const before = { regs: Array.from(s.machine.regs), mem: s.mem.bytes.slice(), pc: s.machine.pc };
    s.run();
    while (s.stepBack());
    expect(Array.from(s.machine.regs)).toEqual(before.regs);
    expect(s.mem.bytes).toEqual(before.mem);
    expect(s.machine.pc).toBe(before.pc);
    expect(s.cycle).toBe(0);
  });

  it('voltar e avançar de novo dá o mesmo resultado', () => {
    const s = new Session(fig('fig08'), { model: 'pipeline', forwarding: true });
    for (let i = 0; i < 60; i++) s.step();
    const regs = Array.from(s.machine.regs);
    for (let i = 0; i < 25; i++) s.stepBack();
    for (let i = 0; i < 25; i++) s.step();
    expect(Array.from(s.machine.regs)).toEqual(regs);
  });
});
