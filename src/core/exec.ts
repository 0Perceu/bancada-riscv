/** Semântica de cada instrução, compartilhada pelo monociclo e pelo pipeline. */
import { Decoded } from './isa';
import { Memory } from './memory';

export interface ExecResult {
  /** Valor que a instrução escreve em rd (exceto loads, que vêm da memória). */
  result: number;
  taken: boolean;
  target: number;
  memAddr: number;
}

const u = (x: number) => x >>> 0;

export function execute(d: Decoded, a: number, b: number, pc: number): ExecResult {
  let result = 0;
  let taken = false;
  let target = (pc + 4) | 0;
  let memAddr = 0;
  const imm = d.imm;
  switch (d.op) {
    case 'lui': result = imm; break;
    case 'auipc': result = (pc + imm) | 0; break;
    case 'jal': result = (pc + 4) | 0; taken = true; target = (pc + imm) | 0; break;
    case 'jalr': result = (pc + 4) | 0; taken = true; target = ((a + imm) & ~1) | 0; break;
    case 'beq': taken = a === b; break;
    case 'bne': taken = a !== b; break;
    case 'blt': taken = a < b; break;
    case 'bge': taken = a >= b; break;
    case 'bltu': taken = u(a) < u(b); break;
    case 'bgeu': taken = u(a) >= u(b); break;
    case 'lb': case 'lh': case 'lw': case 'lbu': case 'lhu':
    case 'sb': case 'sh': case 'sw':
      memAddr = (a + imm) | 0; result = memAddr; break;
    case 'addi': result = (a + imm) | 0; break;
    case 'slti': result = a < imm ? 1 : 0; break;
    case 'sltiu': result = u(a) < u(imm) ? 1 : 0; break;
    case 'xori': result = a ^ imm; break;
    case 'ori': result = a | imm; break;
    case 'andi': result = a & imm; break;
    case 'slli': result = a << (imm & 31); break;
    case 'srli': result = (a >>> (imm & 31)) | 0; break;
    case 'srai': result = a >> (imm & 31); break;
    case 'add': result = (a + b) | 0; break;
    case 'sub': result = (a - b) | 0; break;
    case 'sll': result = a << (b & 31); break;
    case 'slt': result = a < b ? 1 : 0; break;
    case 'sltu': result = u(a) < u(b) ? 1 : 0; break;
    case 'xor': result = a ^ b; break;
    case 'srl': result = (a >>> (b & 31)) | 0; break;
    case 'sra': result = a >> (b & 31); break;
    case 'or': result = a | b; break;
    case 'and': result = a & b; break;
  }
  if (d.fmt === 'B' && taken) target = (pc + imm) | 0;
  return { result, taken, target, memAddr };
}

export function load(mem: Memory, op: string, addr: number): number {
  switch (op) {
    case 'lb': return (mem.read8(addr) << 24) >> 24;
    case 'lbu': return mem.read8(addr);
    case 'lh': return (mem.read16(addr) << 16) >> 16;
    case 'lhu': return mem.read16(addr);
    default: return mem.read32(addr);
  }
}

export function store(mem: Memory, op: string, addr: number, value: number) {
  if (op === 'sb') mem.write8(addr, value);
  else if (op === 'sh') mem.write16(addr, value);
  else mem.write32(addr, value);
}
