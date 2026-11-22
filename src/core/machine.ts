/** Tipos compartilhados pelos modelos de execução e utilidades de carga do programa. */
import { Decoded, decode, disassemble } from './isa';
import { DATA_BASE, Memory, STACK_TOP, TEXT_BASE } from './memory';
import type { Program } from './assembler';
import type { Cache, CacheConfig } from './cache';

export type StageName = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB';
export const STAGES: StageName[] = ['IF', 'ID', 'EX', 'MEM', 'WB'];

/** ok: avançou; stall: parado por hazard; squash: descartado; miss: esperando a cache. */
export type SlotStatus = 'ok' | 'stall' | 'squash' | 'miss';

export interface Slot {
  /** Número de ordem da busca: identifica a instrução no diagrama do pipeline. */
  seq: number;
  pc: number;
  text: string;
  status: SlotStatus;
}

export type EventKind = 'stall' | 'forward' | 'flush' | 'retire' | 'halt' | 'load' | 'store' | 'branch' | 'cache';

export interface SimEvent {
  kind: EventKind;
  message: string;
  /** Para forwarding: estágio de origem e registrador. */
  from?: StageName;
  to?: StageName;
  reg?: number;
}

export type CacheState = 'hit' | 'miss' | 'wait' | null;
export type FwdSrc = 'reg' | 'exmem' | 'memwb';

/** O que cada componente do caminho de dados fez neste ciclo (para a vista detalhada). */
export interface Datapath {
  /** PC usado pela busca e de onde veio o próximo. */
  pc: number;
  pcNext: number;
  pcSrc: 'pc4' | 'branch' | 'hold';
  icache: CacheState;
  id?: { rs1: number; rs2: number; rd: number; imm: number; readsRs1: boolean; readsRs2: boolean; usesImm: boolean };
  /** A unidade de hazard segurou PC e IF/ID (bolha em ID/EX). */
  hazard: boolean;
  /** Desvio tomado: IF/ID e a busca atual viram bolha. */
  flush: boolean;
  ex?: { op: string; a: number; b: number; imm: number; fwdA: FwdSrc; fwdB: FwdSrc; aluSrcImm: boolean; result: number; isBranch: boolean; taken: boolean; target: number };
  mem?: { kind: 'load' | 'store' | 'none'; addr: number; value: number; cache: CacheState };
  wb?: { rd: number; value: number; src: 'alu' | 'mem' | 'pc4'; write: boolean };
}

export interface CycleReport {
  cycle: number;
  stages: Partial<Record<StageName, Slot>>;
  events: SimEvent[];
  dp?: Datapath;
}

export interface CacheSetup {
  i: CacheConfig;
  d: CacheConfig;
}

export interface Stats {
  cycles: number;
  retired: number;
  stalls: number;
  flushes: number;
  forwards: number;
  /** Ciclos perdidos esperando as caches. */
  cacheStalls: number;
}

export interface Machine {
  readonly kind: 'single' | 'pipeline';
  readonly mem: Memory;
  regs: Int32Array;
  pc: number;
  halted: boolean;
  stats: Stats;
  icache: Cache | null;
  dcache: Cache | null;
  step(): CycleReport;
  /** Estado sem a memória (a memória é desfeita pelo diário). */
  snapshot(): unknown;
  restore(s: unknown): void;
}

export const emptyStats = (): Stats => ({ cycles: 0, retired: 0, stalls: 0, flushes: 0, forwards: 0, cacheStalls: 0 });

export function loadProgram(mem: Memory, prog: Program) {
  prog.text.forEach((w, i) => mem.write32(TEXT_BASE + 4 * i, w));
  prog.data.forEach((b, i) => mem.write8(DATA_BASE + i, b));
}

export function initialRegs(): Int32Array {
  const r = new Int32Array(32);
  r[2] = STACK_TOP;
  return r;
}

/** Busca e decodifica; o texto vem do fonte quando existe. */
export function fetchAt(mem: Memory, pc: number, sourceOf?: Map<number, string>): { raw: number; d: Decoded; text: string } {
  const raw = mem.read32(pc);
  const d = decode(raw);
  const src = sourceOf?.get(pc);
  return { raw, d, text: src ? src.replace(/^[\w.$]+:\s*/, '').replace(/\s*(#|\/\/).*?(?=\s*\(\d\/\d\)$|$)/, '').trim() : disassemble(d) };
}

export const hex = (v: number, digits = 8) => '0x' + (v >>> 0).toString(16).padStart(digits, '0');
