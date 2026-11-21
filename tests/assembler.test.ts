import { describe, expect, it } from 'vitest';
import { AssemblyError, assemble } from '../src/core/assembler';
import { decode, disassemble } from '../src/core/isa';

const word = (src: string) => assemble(src).text[0] >>> 0;

describe('montador: codificações conhecidas (conferidas com o GNU as)', () => {
  it.each([
    ['addi x1, x0, 5', 0x00500093],
    ['add x3, x1, x2', 0x002081b3],
    ['sub x3, x1, x2', 0x402081b3],
    ['lw x5, 8(x2)', 0x00812283],
    ['sw x5, -4(sp)', 0xfe512e23],
    ['lui a0, 0x12345', 0x12345537],
    ['srai t0, t1, 3', 0x40335293],
    ['slli t0, t1, 3', 0x00331293],
    ['ecall', 0x00000073],
    ['ret', 0x00008067],
    ['nop', 0x00000013],
  ])('%s', (src, expected) => {
    expect(word(src)).toBe(expected);
  });

  it('desvios e saltos para trás e para frente', () => {
    const p = assemble('a: nop\n beq x1, x2, a\n jal x0, b\n nop\nb: nop');
    expect(p.text[1] >>> 0).toBe(0xfe208ee3); // beq x1,x2,-4
    expect(p.text[2] >>> 0).toBe(0x0080006f); // jal x0,+8
  });

  it('li grande vira lui + addi com arredondamento correto', () => {
    for (const v of [0x12345fff, -1, 2048, -2049, 0x7fffffff, -0x80000000]) {
      const p = assemble(`li t0, ${v}`);
      const [hi, lo] = p.text.length === 2 ? p.text.map(decode) : [null, decode(p.text[0])];
      const val = ((hi ? hi.imm : 0) + lo.imm) | 0;
      expect(val).toBe(v | 0);
    }
  });

  it('dados, rótulos e la', () => {
    const p = assemble('.data\nx: .word 1, -2\ny: .byte 3\n.text\nla a0, y\necall');
    expect(p.labels.get('x')).toBe(0x1000);
    expect(p.labels.get('y')).toBe(0x1008);
    expect(p.data.slice(0, 9)).toEqual([1, 0, 0, 0, 0xfe, 0xff, 0xff, 0xff, 3]);
    expect(p.text.length).toBe(3);
  });

  it('disassembler é o inverso do montador', () => {
    expect(disassemble(decode(word('lw t0, 12(sp)')))).toBe('lw x5, 12(x2)');
    expect(disassemble(decode(word('xori a0, a1, -1')))).toBe('xori x10, x11, -1');
  });

  it('erros trazem a linha', () => {
    try {
      assemble('nop\naddi x1, x2\nfoo x1\nbeq x1, x2, nada');
      expect.fail('deveria falhar');
    } catch (e) {
      expect(e).toBeInstanceOf(AssemblyError);
      expect((e as AssemblyError).errors.map((x) => x.line)).toEqual([2, 3, 4]);
    }
  });
});
