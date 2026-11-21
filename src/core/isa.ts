/**
 * RV32I: decodificação das palavras de 32 bits e metadados de cada instrução.
 * Tudo aqui é puro: nenhuma função depende de estado da máquina.
 */

export type Format = 'R' | 'I' | 'S' | 'B' | 'U' | 'J' | 'SYS' | 'INVALID';

export interface Decoded {
  op: string;
  fmt: Format;
  rd: number;
  rs1: number;
  rs2: number;
  imm: number;
  raw: number;
}

export const OPCODE = {
  LUI: 0x37, AUIPC: 0x17, JAL: 0x6f, JALR: 0x67, BRANCH: 0x63,
  LOAD: 0x03, STORE: 0x23, OPIMM: 0x13, OP: 0x33, SYSTEM: 0x73,
} as const;

const BRANCH_F3: Record<number, string> = { 0: 'beq', 1: 'bne', 4: 'blt', 5: 'bge', 6: 'bltu', 7: 'bgeu' };
const LOAD_F3: Record<number, string> = { 0: 'lb', 1: 'lh', 2: 'lw', 4: 'lbu', 5: 'lhu' };
const STORE_F3: Record<number, string> = { 0: 'sb', 1: 'sh', 2: 'sw' };
const OPIMM_F3: Record<number, string> = { 0: 'addi', 2: 'slti', 3: 'sltiu', 4: 'xori', 6: 'ori', 7: 'andi' };
const OP_F3: Record<number, [string, string | null]> = {
  0: ['add', 'sub'], 1: ['sll', null], 2: ['slt', null], 3: ['sltu', null],
  4: ['xor', null], 5: ['srl', 'sra'], 6: ['or', null], 7: ['and', null],
};

const invalid = (raw: number): Decoded => ({ op: 'invalid', fmt: 'INVALID', rd: 0, rs1: 0, rs2: 0, imm: 0, raw });

export function decode(word: number): Decoded {
  const raw = word | 0;
  const opcode = raw & 0x7f;
  const rd = (raw >> 7) & 31;
  const f3 = (raw >> 12) & 7;
  const rs1 = (raw >> 15) & 31;
  const rs2 = (raw >> 20) & 31;
  const f7 = (raw >>> 25) & 0x7f;
  const immI = raw >> 20;
  const immS = ((raw >> 25) << 5) | ((raw >> 7) & 31);
  const immB = ((raw >> 31) << 12) | (((raw >> 7) & 1) << 11) | (((raw >> 25) & 0x3f) << 5) | (((raw >> 8) & 0xf) << 1);
  const immU = raw & 0xfffff000;
  const immJ = ((raw >> 31) << 20) | (((raw >> 12) & 0xff) << 12) | (((raw >> 20) & 1) << 11) | (((raw >> 21) & 0x3ff) << 1);

  switch (opcode) {
    case OPCODE.LUI: return { op: 'lui', fmt: 'U', rd, rs1: 0, rs2: 0, imm: immU, raw };
    case OPCODE.AUIPC: return { op: 'auipc', fmt: 'U', rd, rs1: 0, rs2: 0, imm: immU, raw };
    case OPCODE.JAL: return { op: 'jal', fmt: 'J', rd, rs1: 0, rs2: 0, imm: immJ, raw };
    case OPCODE.JALR: return f3 === 0 ? { op: 'jalr', fmt: 'I', rd, rs1, rs2: 0, imm: immI, raw } : invalid(raw);
    case OPCODE.BRANCH: {
      const op = BRANCH_F3[f3];
      return op ? { op, fmt: 'B', rd: 0, rs1, rs2, imm: immB, raw } : invalid(raw);
    }
    case OPCODE.LOAD: {
      const op = LOAD_F3[f3];
      return op ? { op, fmt: 'I', rd, rs1, rs2: 0, imm: immI, raw } : invalid(raw);
    }
    case OPCODE.STORE: {
      const op = STORE_F3[f3];
      return op ? { op, fmt: 'S', rd: 0, rs1, rs2, imm: immS, raw } : invalid(raw);
    }
    case OPCODE.OPIMM: {
      if (f3 === 1) return f7 === 0 ? { op: 'slli', fmt: 'I', rd, rs1, rs2: 0, imm: rs2, raw } : invalid(raw);
      if (f3 === 5) {
        if (f7 === 0) return { op: 'srli', fmt: 'I', rd, rs1, rs2: 0, imm: rs2, raw };
        if (f7 === 0x20) return { op: 'srai', fmt: 'I', rd, rs1, rs2: 0, imm: rs2, raw };
        return invalid(raw);
      }
      return { op: OPIMM_F3[f3], fmt: 'I', rd, rs1, rs2: 0, imm: immI, raw };
    }
    case OPCODE.OP: {
      const [normal, alt] = OP_F3[f3];
      if (f7 === 0) return { op: normal, fmt: 'R', rd, rs1, rs2, imm: 0, raw };
      if (f7 === 0x20 && alt) return { op: alt, fmt: 'R', rd, rs1, rs2, imm: 0, raw };
      return invalid(raw);
    }
    case OPCODE.SYSTEM:
      if (raw === 0x00000073) return { op: 'ecall', fmt: 'SYS', rd: 0, rs1: 0, rs2: 0, imm: 0, raw };
      if (raw === 0x00100073) return { op: 'ebreak', fmt: 'SYS', rd: 0, rs1: 0, rs2: 0, imm: 0, raw };
      return invalid(raw);
    default:
      return invalid(raw);
  }
}

export const isLoad = (d: Decoded) => d.fmt === 'I' && d.op in LOAD_OPS;
export const isStore = (d: Decoded) => d.fmt === 'S';
export const isBranch = (d: Decoded) => d.fmt === 'B';
export const isJump = (d: Decoded) => d.op === 'jal' || d.op === 'jalr';
export const isControl = (d: Decoded) => isBranch(d) || isJump(d);
/** ecall, ebreak e palavras inválidas encerram a simulação quando chegam ao fim. */
export const halts = (d: Decoded) => d.fmt === 'SYS' || d.fmt === 'INVALID';
export const writesRd = (d: Decoded) =>
  d.rd !== 0 && (d.fmt === 'R' || d.fmt === 'I' || d.fmt === 'U' || d.fmt === 'J');
export const readsRs1 = (d: Decoded) => d.fmt === 'R' || d.fmt === 'I' || d.fmt === 'S' || d.fmt === 'B';
export const readsRs2 = (d: Decoded) => d.fmt === 'R' || d.fmt === 'S' || d.fmt === 'B';

const LOAD_OPS: Record<string, true> = { lb: true, lh: true, lw: true, lbu: true, lhu: true };

export const ABI_NAMES = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
];

export const regName = (r: number) => `x${r}`;

export function disassemble(d: Decoded): string {
  const r = regName;
  switch (d.fmt) {
    case 'R': return `${d.op} ${r(d.rd)}, ${r(d.rs1)}, ${r(d.rs2)}`;
    case 'I':
      if (isLoad(d) || d.op === 'jalr') return `${d.op} ${r(d.rd)}, ${d.imm}(${r(d.rs1)})`;
      return `${d.op} ${r(d.rd)}, ${r(d.rs1)}, ${d.imm}`;
    case 'S': return `${d.op} ${r(d.rs2)}, ${d.imm}(${r(d.rs1)})`;
    case 'B': return `${d.op} ${r(d.rs1)}, ${r(d.rs2)}, ${d.imm}`;
    case 'U': return `${d.op} ${r(d.rd)}, 0x${(d.imm >>> 12).toString(16)}`;
    case 'J': return `jal ${r(d.rd)}, ${d.imm}`;
    case 'SYS': return d.op;
    default: return `.word 0x${(d.raw >>> 0).toString(16).padStart(8, '0')}`;
  }
}
