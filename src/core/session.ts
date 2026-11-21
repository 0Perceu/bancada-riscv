/** Sessão de simulação: monta, carrega, executa e guarda histórico para voltar no tempo. */
import { Program, assemble } from './assembler';
import { CycleReport, Machine, loadProgram } from './machine';
import { Memory } from './memory';
import { Pipeline } from './pipeline';
import { SingleCycle } from './single';

export type ModelKind = 'single' | 'pipeline';

export interface SessionConfig {
  model: ModelKind;
  forwarding: boolean;
}

interface HistoryEntry {
  snap: unknown;
  memUndo: Array<[number, number]>;
}

export class Session {
  readonly mem = new Memory();
  readonly machine: Machine;
  readonly program: Program;
  readonly trace: CycleReport[] = [];
  private history: HistoryEntry[] = [];
  /** Memória antes da última escrita: para destacar endereços alterados. */
  lastWrites: number[] = [];

  constructor(source: string, readonly config: SessionConfig, readonly maxHistory = 20000) {
    this.program = assemble(source);
    loadProgram(this.mem, this.program);
    this.machine = config.model === 'single'
      ? new SingleCycle(this.mem, this.program.sourceOf)
      : new Pipeline(this.mem, { forwarding: config.forwarding }, this.program.sourceOf);
  }

  get cycle() {
    return this.machine.stats.cycles;
  }

  get done() {
    return this.machine.halted;
  }

  step(): CycleReport | null {
    if (this.machine.halted) return null;
    const snap = this.machine.snapshot();
    this.mem.beginJournal();
    const rep = this.machine.step();
    const memUndo = this.mem.endJournal();
    this.lastWrites = memUndo.map(([a]) => a);
    this.history.push({ snap, memUndo });
    this.trace.push(rep);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    return rep;
  }

  canStepBack() {
    return this.history.length > 0;
  }

  stepBack(): boolean {
    const h = this.history.pop();
    if (!h) return false;
    this.mem.undo(h.memUndo);
    this.machine.restore(h.snap);
    this.trace.pop();
    const prev = this.history[this.history.length - 1];
    this.lastWrites = prev ? prev.memUndo.map(([a]) => a) : [];
    return true;
  }

  run(maxCycles = 100000): number {
    let n = 0;
    while (!this.machine.halted && n < maxCycles) {
      this.step();
      n++;
    }
    return n;
  }

  get lastReport(): CycleReport | undefined {
    return this.trace[this.trace.length - 1];
  }
}
