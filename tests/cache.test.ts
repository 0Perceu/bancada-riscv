import { describe, expect, it } from 'vitest';
import { Cache } from '../src/core/cache';
import { Session } from '../src/core/session';

describe('cache', () => {
  it('divide o endereço em tag, índice e deslocamento', () => {
    const c = new Cache('t', { sets: 4, ways: 1, blockBytes: 16, missPenalty: 4 });
    expect(c.split(0x1234)).toEqual({ offset: 0x4, set: 0x3, tag: 0x1234 >>> 6 });
    expect(c.blockAddr(3, 0x1234 >>> 6)).toBe(0x1230);
    expect(c.sizeBytes).toBe(64);
  });

  it('localidade espacial: 1 falta e 3 acertos num bloco de 16 bytes', () => {
    const c = new Cache('t', { sets: 4, ways: 1, blockBytes: 16, missPenalty: 4 });
    const r = [0, 4, 8, 12].map((a) => c.access(0x1000 + a, false).hit);
    expect(r).toEqual([false, true, true, true]);
    expect(c.stats).toEqual({ accesses: 4, hits: 3, misses: 1, writebacks: 0 });
  });

  it('mapeamento direto: dois blocos no mesmo conjunto se expulsam', () => {
    const c = new Cache('t', { sets: 4, ways: 1, blockBytes: 16, missPenalty: 4 });
    const a = 0x1000, b = 0x1000 + 64; // mesmo índice, tags diferentes
    expect([a, b, a, b].map((x) => c.access(x, false).hit)).toEqual([false, false, false, false]);
  });

  it('2 vias com LRU guardam os dois blocos e expulsam o menos usado', () => {
    const c = new Cache('t', { sets: 4, ways: 2, blockBytes: 16, missPenalty: 4 });
    const a = 0x1000, b = 0x1040, d = 0x1080;
    expect([a, b, a, b].map((x) => c.access(x, false).hit)).toEqual([false, false, true, true]);
    c.access(a, false); // b passa a ser o menos usado
    expect(c.access(d, false).hit).toBe(false);
    expect(c.access(a, false).hit).toBe(true);
    expect(c.access(b, false).hit).toBe(false);
  });

  it('write-back: expulsar um bloco sujo custa o dobro', () => {
    const c = new Cache('t', { sets: 1, ways: 1, blockBytes: 16, missPenalty: 4 });
    expect(c.access(0x1000, true).penalty).toBe(4);
    const r = c.access(0x2000, false);
    expect(r.writeback).toBe(true);
    expect(r.penalty).toBe(8);
    expect(c.stats.writebacks).toBe(1);
  });
});

describe('cache no pipeline', () => {
  const cfg = { sets: 4, ways: 1, blockBytes: 16, missPenalty: 4 };
  const caches = { i: cfg, d: cfg };

  it('a primeira busca de cada bloco de instruções custa a penalidade', () => {
    // 4 instruções cabem num bloco de 16 bytes: 1 falta = +4 ciclos, depois só acertos
    const src = 'li t0, 1\nli t1, 2\nli t2, 3\necall';
    const plain = new Session(src, { model: 'pipeline', forwarding: true });
    plain.run();
    const s = new Session(src, { model: 'pipeline', forwarding: true, caches });
    s.run();
    expect(s.machine.icache!.stats).toMatchObject({ misses: 1, hits: 3 });
    expect(s.machine.stats.cycles).toBe(plain.machine.stats.cycles + 4);
    expect(s.machine.stats.cacheStalls).toBe(4);
  });

  it('uma falta na D-cache congela o pipeline pela penalidade', () => {
    const src = '.data\nv: .word 7\n.text\nla t0, v\nlw t1, 0(t0)\naddi t2, t1, 1\necall';
    const noD = new Session(src, { model: 'pipeline', forwarding: true, caches: { i: { ...cfg, missPenalty: 0 }, d: { ...cfg, missPenalty: 0 } } });
    noD.run();
    const s = new Session(src, { model: 'pipeline', forwarding: true, caches: { i: { ...cfg, missPenalty: 0 }, d: cfg } });
    s.run();
    expect(s.machine.regs[7]).toBe(8);
    expect(s.machine.dcache!.stats.misses).toBe(1);
    expect(s.machine.stats.cycles).toBe(noD.machine.stats.cycles + 4);
  });

  it('voltar no tempo restaura o conteúdo das caches', () => {
    const src = '.data\nv: .word 1, 2, 3, 4\n.text\nla t0, v\nlw t1, 0(t0)\nlw t2, 4(t0)\nsw t2, 8(t0)\necall';
    const s = new Session(src, { model: 'pipeline', forwarding: true, caches });
    const before = JSON.stringify(s.machine.dcache!.lines);
    s.run();
    expect(JSON.stringify(s.machine.dcache!.lines)).not.toBe(before);
    while (s.canStepBack()) s.stepBack();
    expect(JSON.stringify(s.machine.dcache!.lines)).toBe(before);
    expect(s.machine.dcache!.stats.accesses).toBe(0);
  });
});
