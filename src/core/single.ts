/** Monociclo: cada ciclo busca, decodifica, executa, acessa a memória e escreve de uma vez. */
import { execute, load, store } from './exec';
import { Cache } from './cache';
import { halts, isControl, isLoad, isStore, readsRs1, readsRs2, usesImm, writesRd } from './isa';
import { CacheSetup, CycleReport, Machine, Slot, emptyStats, fetchAt, initialRegs } from './machine';
import { Memory, TEXT_BASE } from './memory';

export class SingleCycle implements Machine {
  readonly kind = 'single' as const;
  regs = initialRegs();
  pc = TEXT_BASE;
  halted = false;
  stats = emptyStats();
  private seq = 0;
  icache: Cache | null = null;
  dcache: Cache | null = null;

  /**
   * Com caches, uma falta alonga o ciclo daquela instrução: os ciclos extras entram na contagem
   * (e no CPI), mas cada passo continua sendo uma instrução inteira.
   */
  constructor(readonly mem: Memory, private sourceOf?: Map<number, string>, caches?: CacheSetup | null) {
    if (caches) {
      this.icache = new Cache('I-cache', caches.i);
      this.dcache = new Cache('D-cache', caches.d);
    }
  }

  private charge(c: Cache | null, addr: number, write: boolean, report: CycleReport) {
    if (!c) return null;
    const acc = c.access(addr, write);
    if (!acc.hit) {
      this.stats.cycles += acc.penalty;
      this.stats.cacheStalls += acc.penalty;
      report.events.push({ kind: 'cache', message: `${c.name}: falta no endereço ${addr}; +${acc.penalty} ciclos esperando a memória${acc.writeback ? ' (inclui gravar um bloco sujo)' : ''}.` });
    } else {
      report.events.push({ kind: 'cache', message: `${c.name}: acerto no endereço ${addr}.` });
    }
    return acc.hit ? 'hit' as const : 'miss' as const;
  }

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
    const ic = this.charge(this.icache, this.pc, false, report);
    if (halts(d)) {
      this.halted = true;
      report.events.push({ kind: 'halt', message: d.op === 'invalid' ? `Palavra inválida em ${this.pc}: fim da execução.` : `${d.op}: fim do programa.` });
      return report;
    }
    const a = this.regs[d.rs1];
    const b = this.regs[d.rs2];
    const r = execute(d, a, b, this.pc);
    let value = r.result;
    const dc = isLoad(d) || isStore(d) ? this.charge(this.dcache, r.memAddr, isStore(d), report) : null;
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
    const next = r.taken ? r.target : (this.pc + 4) | 0;
    report.dp = {
      pc: this.pc, pcNext: next, pcSrc: r.taken ? 'branch' : 'pc4', icache: ic, hazard: false, flush: false,
      id: { rs1: d.rs1, rs2: d.rs2, rd: d.rd, imm: d.imm, readsRs1: readsRs1(d), readsRs2: readsRs2(d), usesImm: usesImm(d) },
      ex: { op: d.op, a, b, imm: d.imm, fwdA: 'reg', fwdB: 'reg', aluSrcImm: usesImm(d), result: r.result, isBranch: isControl(d), taken: r.taken, target: r.target },
      mem: { kind: isLoad(d) ? 'load' : isStore(d) ? 'store' : 'none', addr: r.memAddr, value: isLoad(d) ? value : b, cache: dc },
      wb: { rd: d.rd, value, src: isLoad(d) ? 'mem' : d.op === 'jal' || d.op === 'jalr' ? 'pc4' : 'alu', write: writesRd(d) && d.rd !== 0 },
    };
    this.pc = next;
    return report;
  }

  snapshot() {
    return {
      regs: Array.from(this.regs), pc: this.pc, halted: this.halted, stats: { ...this.stats }, seq: this.seq,
      icache: this.icache?.snapshot() ?? null, dcache: this.dcache?.snapshot() ?? null,
    };
  }

  restore(s: unknown) {
    const v = s as ReturnType<SingleCycle['snapshot']>;
    this.regs = Int32Array.from(v.regs);
    this.pc = v.pc;
    this.halted = v.halted;
    this.stats = { ...v.stats };
    this.seq = v.seq;
    if (this.icache && v.icache) this.icache.restore(v.icache);
    if (this.dcache && v.dcache) this.dcache.restore(v.dcache);
  }
}
