/** Monociclo: cada ciclo busca, decodifica, executa, acessa a memória e escreve de uma vez. */
import { execute, load, store } from './exec';
import { halts, isLoad, isStore, writesRd } from './isa';
import { CycleReport, Machine, Slot, emptyStats, fetchAt, initialRegs } from './machine';
import { Memory, TEXT_BASE } from './memory';

export class SingleCycle implements Machine {
  readonly kind = 'single' as const;
  regs = initialRegs();
  pc = TEXT_BASE;
  halted = false;
  stats = emptyStats();
  private seq = 0;

  constructor(readonly mem: Memory, private sourceOf?: Map<number, string>) {}

  step(): CycleReport {
    const cycle = ++this.stats.cycles;
    const { d, text } = fetchAt(this.mem, this.pc, this.sourceOf);
    const slot: Slot = { seq: this.seq++, pc: this.pc, text, status: 'ok' };
    const report: CycleReport = {
      cycle,
      stages: { IF: slot, ID: slot, EX: slot, MEM: slot, WB: slot },
      events: [],
    };
    this.stats.retired++;
    if (halts(d)) {
      this.halted = true;
      report.events.push({ kind: 'halt', message: d.op === 'invalid' ? `Palavra inválida em ${this.pc}: fim da execução.` : `${d.op}: fim do programa.` });
      return report;
    }
    const a = this.regs[d.rs1];
    const b = this.regs[d.rs2];
    const r = execute(d, a, b, this.pc);
    let value = r.result;
    if (isLoad(d)) {
      value = load(this.mem, d.op, r.memAddr);
      report.events.push({ kind: 'load', message: `${d.op}: leu ${value} do endereço ${r.memAddr}.` });
    } else if (isStore(d)) {
      store(this.mem, d.op, r.memAddr, b);
      report.events.push({ kind: 'store', message: `${d.op}: escreveu ${b} no endereço ${r.memAddr}.` });
    }
    if (writesRd(d)) this.regs[d.rd] = value;
    if (d.fmt === 'B') {
      report.events.push({ kind: 'branch', message: r.taken ? `Desvio tomado para ${r.target}.` : 'Desvio não tomado.' });
    }
    this.pc = r.taken ? r.target : (this.pc + 4) | 0;
    return report;
  }

  snapshot() {
    return { regs: Array.from(this.regs), pc: this.pc, halted: this.halted, stats: { ...this.stats }, seq: this.seq };
  }

  restore(s: unknown) {
    const v = s as ReturnType<SingleCycle['snapshot']>;
    this.regs = Int32Array.from(v.regs);
    this.pc = v.pc;
    this.halted = v.halted;
    this.stats = { ...v.stats };
    this.seq = v.seq;
  }
}
