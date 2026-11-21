/**
 * Montador RV32I em duas passagens: rótulos, diretivas .text/.data/.word/.half/.byte/.space/.asciz,
 * pseudoinstruções comuns e mensagens de erro com número da linha.
 */
import { ABI_NAMES, OPCODE } from './isa';
import { DATA_BASE, TEXT_BASE } from './memory';

export interface AsmError {
  line: number;
  message: string;
}

export interface Program {
  /** Palavras de instrução a partir de TEXT_BASE. */
  text: number[];
  /** Bytes de dados a partir de DATA_BASE. */
  data: number[];
  labels: Map<string, number>;
  /** endereço da instrução -> linha do fonte (1-based) */
  lineOf: Map<number, number>;
  /** endereço da instrução -> texto original da linha */
  sourceOf: Map<number, string>;
}

export class AssemblyError extends Error {
  constructor(readonly errors: AsmError[]) {
    super(errors.map((e) => `linha ${e.line}: ${e.message}`).join('\n'));
  }
}

class LineError extends Error {}
const fail = (msg: string): never => {
  throw new LineError(msg);
};

const REGS = new Map<string, number>();
for (let i = 0; i < 32; i++) {
  REGS.set(`x${i}`, i);
  REGS.set(ABI_NAMES[i], i);
}
REGS.set('fp', 8);

function reg(tok: string | undefined): number {
  if (tok === undefined) return fail('faltou um registrador.');
  const r = REGS.get(tok.toLowerCase());
  if (r === undefined) fail(`registrador desconhecido: "${tok}".`);
  return r!;
}

function parseNumber(tok: string): number | null {
  const t = tok.trim();
  if (/^-?0x[0-9a-f]+$/i.test(t)) return t.startsWith('-') ? -parseInt(t.slice(3), 16) : parseInt(t.slice(2), 16);
  if (/^-?0b[01]+$/i.test(t)) return t.startsWith('-') ? -parseInt(t.slice(3), 2) : parseInt(t.slice(2), 2);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^'.'$/.test(t)) return t.charCodeAt(1);
  return null;
}

function checkRange(v: number, bits: number, signed: boolean, what: string) {
  const min = signed ? -(2 ** (bits - 1)) : 0;
  const max = signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
  if (v < min || v > max) fail(`${what} fora da faixa (${min} a ${max}): ${v}.`);
}

// ---- codificadores ----
const encR = (f7: number, rs2: number, rs1: number, f3: number, rd: number, op: number) =>
  ((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) | 0;
const encI = (imm: number, rs1: number, f3: number, rd: number, op: number) =>
  (((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) | 0;
const encS = (imm: number, rs2: number, rs1: number, f3: number, op: number) =>
  ((((imm >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((imm & 31) << 7) | op) | 0;
const encB = (imm: number, rs2: number, rs1: number, f3: number) =>
  ((((imm >> 12) & 1) << 31) | (((imm >> 5) & 0x3f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) |
    (((imm >> 1) & 0xf) << 8) | (((imm >> 11) & 1) << 7) | OPCODE.BRANCH) | 0;
const encU = (imm20: number, rd: number, op: number) => (((imm20 & 0xfffff) << 12) | (rd << 7) | op) | 0;
const encJ = (imm: number, rd: number) =>
  ((((imm >> 20) & 1) << 31) | (((imm >> 1) & 0x3ff) << 21) | (((imm >> 11) & 1) << 20) |
    (((imm >> 12) & 0xff) << 12) | (rd << 7) | OPCODE.JAL) | 0;

const R_OPS: Record<string, [number, number]> = {
  add: [0, 0], sub: [0x20, 0], sll: [0, 1], slt: [0, 2], sltu: [0, 3],
  xor: [0, 4], srl: [0, 5], sra: [0x20, 5], or: [0, 6], and: [0, 7],
};
const I_OPS: Record<string, number> = { addi: 0, slti: 2, sltiu: 3, xori: 4, ori: 6, andi: 7 };
const SHIFT_OPS: Record<string, [number, number]> = { slli: [0, 1], srli: [0, 5], srai: [0x20, 5] };
const LOAD_OPS: Record<string, number> = { lb: 0, lh: 1, lw: 2, lbu: 4, lhu: 5 };
const STORE_OPS: Record<string, number> = { sb: 0, sh: 1, sw: 2 };
const BRANCH_OPS: Record<string, number> = { beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7 };

/** Quantas palavras cada mnemônico ocupa (necessário já na 1ª passagem). */
function sizeOf(mn: string, args: string[]): number {
  if (mn === 'la') return 2;
  if (mn === 'li') {
    const v = parseNumber(args[1] ?? '');
    if (v === null) return 2;
    return v >= -2048 && v <= 2047 ? 1 : 2;
  }
  return 1;
}

function splitArgs(rest: string): string[] {
  if (!rest.trim()) return [];
  return rest.split(',').map((s) => s.trim());
}

function parseMemOperand(tok: string | undefined): [number, number] {
  if (tok === undefined) return fail('faltou o operando de memória, ex.: 8(sp).');
  const m = /^(.*)\(\s*([\w]+)\s*\)$/.exec(tok.trim());
  if (!m) return fail(`operando de memória inválido: "${tok}" (use deslocamento(registrador)).`);
  const off = m[1].trim() === '' ? 0 : parseNumber(m[1]);
  if (off === null) return fail(`deslocamento inválido: "${m[1]}".`);
  checkRange(off, 12, true, 'deslocamento');
  return [off, reg(m[2])];
}

function stripComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inStr = !inStr;
    if (!inStr && (c === '#' || (c === '/' && line[i + 1] === '/'))) return line.slice(0, i);
  }
  return line;
}

export function assemble(source: string): Program {
  const lines = source.split(/\r?\n/);
  const errors: AsmError[] = [];
  const labels = new Map<string, number>();

  interface Item { line: number; mn: string; args: string[]; addr: number; src: string }
  const items: Item[] = [];
  const dataItems: Array<{ line: number; dir: string; args: string[]; raw: string; addr: number }> = [];

  // ---- 1ª passagem: endereços e rótulos ----
  let section: 'text' | 'data' = 'text';
  let pc = TEXT_BASE;
  let dp = DATA_BASE;
  lines.forEach((full, idx) => {
    const lineNo = idx + 1;
    try {
      let line = stripComment(full).trim();
      let m: RegExpExecArray | null;
      while ((m = /^([A-Za-z_.$][\w.$]*)\s*:/.exec(line))) {
        const name = m[1];
        if (labels.has(name)) fail(`rótulo repetido: "${name}".`);
        labels.set(name, section === 'text' ? pc : dp);
        line = line.slice(m[0].length).trim();
      }
      if (!line) return;
      const sp = line.search(/\s/);
      const head = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
      const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
      if (head.startsWith('.')) {
        switch (head) {
          case '.text': section = 'text'; return;
          case '.data': section = 'data'; return;
          case '.globl': case '.global': case '.section': return;
          case '.align': {
            const n = parseNumber(rest);
            if (n === null || n < 0 || n > 8) fail('.align espera um número de 0 a 8.');
            const a = 1 << n!;
            if (section === 'data') {
              const pad = (a - (dp % a)) % a;
              if (pad) dataItems.push({ line: lineNo, dir: '.space', args: [String(pad)], raw: '', addr: dp });
              dp += pad;
            }
            return;
          }
        }
        if (section !== 'data') fail(`a diretiva ${head} só é aceita em .data.`);
        const addr = dp;
        if (head === '.word' || head === '.half' || head === '.byte') {
          const args = splitArgs(rest);
          if (!args.length) fail(`${head} precisa de pelo menos um valor.`);
          dp += args.length * (head === '.word' ? 4 : head === '.half' ? 2 : 1);
          dataItems.push({ line: lineNo, dir: head, args, raw: rest, addr });
        } else if (head === '.space' || head === '.zero') {
          const n = parseNumber(rest);
          if (n === null || n < 0) fail(`${head} espera um tamanho em bytes.`);
          dp += n!;
          dataItems.push({ line: lineNo, dir: '.space', args: [rest], raw: rest, addr });
        } else if (head === '.asciz' || head === '.string' || head === '.ascii') {
          const sm = /^"((?:[^"\\]|\\.)*)"$/.exec(rest);
          if (!sm) fail(`${head} espera um texto entre aspas.`);
          const text = JSON.parse(`"${sm![1]}"`) as string;
          dp += text.length + (head === '.ascii' ? 0 : 1);
          dataItems.push({ line: lineNo, dir: head, args: [text], raw: rest, addr });
        } else {
          fail(`diretiva desconhecida: ${head}.`);
        }
        return;
      }
      if (section !== 'text') fail('instruções devem ficar em .text.');
      const args = splitArgs(rest);
      items.push({ line: lineNo, mn: head, args, addr: pc, src: full.trim() });
      pc += 4 * sizeOf(head, args);
      if (pc > DATA_BASE) fail(`o código passou de ${DATA_BASE} bytes e invadiu a área de dados.`);
    } catch (e) {
      if (e instanceof LineError) errors.push({ line: lineNo, message: e.message });
      else throw e;
    }
  });

  // ---- 2ª passagem: codificação ----
  const text: number[] = [];
  const lineOf = new Map<number, number>();
  const sourceOf = new Map<number, string>();

  const value = (tok: string | undefined, what = 'imediato'): number => {
    if (tok === undefined) return fail(`faltou o ${what}.`);
    const n = parseNumber(tok);
    if (n !== null) return n;
    const l = labels.get(tok.trim());
    if (l !== undefined) return l;
    return fail(`${what} inválido ou rótulo inexistente: "${tok}".`);
  };
  const target = (tok: string | undefined, here: number, bits: number) => {
    if (tok === undefined) return fail('faltou o destino do desvio.');
    const n = parseNumber(tok);
    const off = n !== null ? n : value(tok, 'rótulo') - here;
    if (off % 2 !== 0) fail('o deslocamento do desvio precisa ser par.');
    checkRange(off, bits, true, 'destino do desvio');
    return off;
  };
  const expect = (args: string[], n: number, usage: string) => {
    if (args.length !== n) fail(`uso: ${usage}`);
  };

  for (const it of items) {
    const { mn, args, addr } = it;
    try {
      const out: number[] = [];
      const emitLi = (rd: number, v: number, forceTwo: boolean) => {
        if (!forceTwo && v >= -2048 && v <= 2047) {
          out.push(encI(v, 0, 0, rd, OPCODE.OPIMM));
          return;
        }
        if (v < -(2 ** 31) || v > 2 ** 32 - 1) fail(`valor não cabe em 32 bits: ${v}.`);
        const lo = ((v & 0xfff) << 20) >> 20;
        const hi = ((v - lo) >>> 12) & 0xfffff;
        out.push(encU(hi, rd, OPCODE.LUI));
        out.push(encI(lo, rd, 0, rd, OPCODE.OPIMM));
      };

      if (mn in R_OPS) {
        expect(args, 3, `${mn} rd, rs1, rs2`);
        const [f7, f3] = R_OPS[mn];
        out.push(encR(f7, reg(args[2]), reg(args[1]), f3, reg(args[0]), OPCODE.OP));
      } else if (mn in I_OPS) {
        expect(args, 3, `${mn} rd, rs1, imediato`);
        const v = value(args[2]);
        checkRange(v, 12, true, 'imediato');
        out.push(encI(v, reg(args[1]), I_OPS[mn], reg(args[0]), OPCODE.OPIMM));
      } else if (mn in SHIFT_OPS) {
        expect(args, 3, `${mn} rd, rs1, deslocamento`);
        const v = value(args[2]);
        checkRange(v, 5, false, 'deslocamento');
        const [f7, f3] = SHIFT_OPS[mn];
        out.push(encR(f7, v, reg(args[1]), f3, reg(args[0]), OPCODE.OPIMM));
      } else if (mn in LOAD_OPS) {
        expect(args, 2, `${mn} rd, deslocamento(rs1)`);
        const [off, rs1] = parseMemOperand(args[1]);
        out.push(encI(off, rs1, LOAD_OPS[mn], reg(args[0]), OPCODE.LOAD));
      } else if (mn in STORE_OPS) {
        expect(args, 2, `${mn} rs2, deslocamento(rs1)`);
        const [off, rs1] = parseMemOperand(args[1]);
        out.push(encS(off, reg(args[0]), rs1, STORE_OPS[mn], OPCODE.STORE));
      } else if (mn in BRANCH_OPS) {
        expect(args, 3, `${mn} rs1, rs2, rótulo`);
        out.push(encB(target(args[2], addr, 13), reg(args[1]), reg(args[0]), BRANCH_OPS[mn]));
      } else {
        switch (mn) {
          case 'lui': case 'auipc': {
            expect(args, 2, `${mn} rd, imediato20`);
            const v = value(args[1]);
            checkRange(v, 20, false, 'imediato de 20 bits');
            out.push(encU(v, reg(args[0]), mn === 'lui' ? OPCODE.LUI : OPCODE.AUIPC));
            break;
          }
          case 'jal':
            if (args.length === 1) out.push(encJ(target(args[0], addr, 21), 1));
            else { expect(args, 2, 'jal rd, rótulo'); out.push(encJ(target(args[1], addr, 21), reg(args[0]))); }
            break;
          case 'jalr':
            if (args.length === 1) out.push(encI(0, reg(args[0]), 0, 1, OPCODE.JALR));
            else if (args.length === 2) {
              const [off, rs1] = parseMemOperand(args[1]);
              out.push(encI(off, rs1, 0, reg(args[0]), OPCODE.JALR));
            } else {
              expect(args, 3, 'jalr rd, rs1, imediato');
              const v = value(args[2]);
              checkRange(v, 12, true, 'imediato');
              out.push(encI(v, reg(args[1]), 0, reg(args[0]), OPCODE.JALR));
            }
            break;
          case 'ecall': expect(args, 0, 'ecall'); out.push(0x00000073); break;
          case 'ebreak': expect(args, 0, 'ebreak'); out.push(0x00100073); break;
          // ---- pseudoinstruções ----
          case 'nop': expect(args, 0, 'nop'); out.push(encI(0, 0, 0, 0, OPCODE.OPIMM)); break;
          case 'li': {
            expect(args, 2, 'li rd, valor');
            const n = parseNumber(args[1]);
            if (n === null) fail('li espera um número; para endereços use la.');
            emitLi(reg(args[0]), n!, false);
            break;
          }
          case 'la': expect(args, 2, 'la rd, rótulo'); emitLi(reg(args[0]), value(args[1], 'rótulo'), true); break;
          case 'mv': expect(args, 2, 'mv rd, rs'); out.push(encI(0, reg(args[1]), 0, reg(args[0]), OPCODE.OPIMM)); break;
          case 'not': expect(args, 2, 'not rd, rs'); out.push(encI(-1, reg(args[1]), 4, reg(args[0]), OPCODE.OPIMM)); break;
          case 'neg': expect(args, 2, 'neg rd, rs'); out.push(encR(0x20, reg(args[1]), 0, 0, reg(args[0]), OPCODE.OP)); break;
          case 'seqz': expect(args, 2, 'seqz rd, rs'); out.push(encI(1, reg(args[1]), 3, reg(args[0]), OPCODE.OPIMM)); break;
          case 'snez': expect(args, 2, 'snez rd, rs'); out.push(encR(0, reg(args[1]), 0, 3, reg(args[0]), OPCODE.OP)); break;
          case 'j': expect(args, 1, 'j rótulo'); out.push(encJ(target(args[0], addr, 21), 0)); break;
          case 'call': expect(args, 1, 'call rótulo'); out.push(encJ(target(args[0], addr, 21), 1)); break;
          case 'jr': expect(args, 1, 'jr rs'); out.push(encI(0, reg(args[0]), 0, 0, OPCODE.JALR)); break;
          case 'ret': expect(args, 0, 'ret'); out.push(encI(0, 1, 0, 0, OPCODE.JALR)); break;
          case 'beqz': expect(args, 2, 'beqz rs, rótulo'); out.push(encB(target(args[1], addr, 13), 0, reg(args[0]), 0)); break;
          case 'bnez': expect(args, 2, 'bnez rs, rótulo'); out.push(encB(target(args[1], addr, 13), 0, reg(args[0]), 1)); break;
          case 'bltz': expect(args, 2, 'bltz rs, rótulo'); out.push(encB(target(args[1], addr, 13), 0, reg(args[0]), 4)); break;
          case 'bgez': expect(args, 2, 'bgez rs, rótulo'); out.push(encB(target(args[1], addr, 13), 0, reg(args[0]), 5)); break;
          case 'bgtz': expect(args, 2, 'bgtz rs, rótulo'); out.push(encB(target(args[1], addr, 13), reg(args[0]), 0, 4)); break;
          case 'blez': expect(args, 2, 'blez rs, rótulo'); out.push(encB(target(args[1], addr, 13), reg(args[0]), 0, 5)); break;
          case 'bgt': expect(args, 3, 'bgt rs1, rs2, rótulo'); out.push(encB(target(args[2], addr, 13), reg(args[0]), reg(args[1]), 4)); break;
          case 'ble': expect(args, 3, 'ble rs1, rs2, rótulo'); out.push(encB(target(args[2], addr, 13), reg(args[0]), reg(args[1]), 5)); break;
          case 'bgtu': expect(args, 3, 'bgtu rs1, rs2, rótulo'); out.push(encB(target(args[2], addr, 13), reg(args[0]), reg(args[1]), 6)); break;
          case 'bleu': expect(args, 3, 'bleu rs1, rs2, rótulo'); out.push(encB(target(args[2], addr, 13), reg(args[0]), reg(args[1]), 7)); break;
          default: fail(`instrução desconhecida: "${mn}".`);
        }
      }
      out.forEach((w, i) => {
        const a = addr + 4 * i;
        text[(a - TEXT_BASE) / 4] = w;
        lineOf.set(a, it.line);
        sourceOf.set(a, out.length > 1 ? `${it.src}  (${i + 1}/${out.length})` : it.src);
      });
    } catch (e) {
      if (e instanceof LineError) errors.push({ line: it.line, message: e.message });
      else throw e;
    }
  }

  const data: number[] = [];
  for (const d of dataItems) {
    try {
      const base = d.addr - DATA_BASE;
      const put = (off: number, v: number, n: number) => {
        for (let i = 0; i < n; i++) data[base + off + i] = (v >> (8 * i)) & 0xff;
      };
      if (d.dir === '.space') {
        const n = parseNumber(d.args[0]) ?? 0;
        for (let i = 0; i < n; i++) data[base + i] = 0;
      } else if (d.dir === '.asciz' || d.dir === '.string' || d.dir === '.ascii') {
        const s = d.args[0];
        for (let i = 0; i < s.length; i++) data[base + i] = s.charCodeAt(i) & 0xff;
        if (d.dir !== '.ascii') data[base + s.length] = 0;
      } else {
        const n = d.dir === '.word' ? 4 : d.dir === '.half' ? 2 : 1;
        d.args.forEach((a, i) => {
          const v = value(a, 'valor');
          if (n < 4) checkRange(v, 8 * n, v < 0, 'valor');
          put(i * n, v, n);
        });
      }
    } catch (e) {
      if (e instanceof LineError) errors.push({ line: d.line, message: e.message });
      else throw e;
    }
  }
  for (let i = 0; i < data.length; i++) if (data[i] === undefined) data[i] = 0;

  if (errors.length) throw new AssemblyError(errors.sort((a, b) => a.line - b.line));
  if (!text.length) throw new AssemblyError([{ line: 1, message: 'o programa não tem instruções.' }]);
  return { text, data, labels, lineOf, sourceOf };
}
