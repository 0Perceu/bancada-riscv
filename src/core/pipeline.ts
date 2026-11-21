/**
 * Pipeline clássico de 5 estágios (IF, ID, EX, MEM, WB).
 *
 * - O banco de registradores escreve na 1ª metade do ciclo e lê na 2ª: WB e ID no mesmo ciclo não conflitam.
 * - Desvios e saltos são resolvidos em EX com predição "não tomado": se tomados, IF e ID são descartados (2 bolhas).
 * - Com forwarding: caminhos EX/MEM→EX e MEM/WB→EX; resta só a bolha de load-use.
 * - Sem forwarding: a instrução espera em ID até o produtor chegar a WB.
 *
 * O ciclo é calculado a partir dos latches antigos, do fim para o começo, como no hardware.
 */
import { execute, load, store } from './exec';
import { Decoded, halts, isControl, isLoad, isStore, readsRs1, readsRs2, writesRd } from './isa';
import { CycleReport, Machine, SimEvent, Slot, StageName, emptyStats, fetchAt, initialRegs } from './machine';
import { Memory, TEXT_BASE } from './memory';

export interface PipelineConfig {
  forwarding: boolean;
}

interface Inflight {
  seq: number;
  pc: number;
  d: Decoded;
  text: string;
  rs1v: number;
  rs2v: number;
  result: number;
  memAddr: number;
  storeVal: number;
  wbValue: number;
}

interface Latches {
  ifid: Inflight | null;
  idex: Inflight | null;
  exmem: Inflight | null;
  memwb: Inflight | null;
}

const slot = (x: Inflight | null, status: Slot['status'] = 'ok'): Slot | undefined =>
  x ? { seq: x.seq, pc: x.pc, text: x.text, status } : undefined;

export class Pipeline implements Machine {
  readonly kind = 'pipeline' as const;
  regs = initialRegs();
  pc = TEXT_BASE;
  halted = false;
  stats = emptyStats();
  latches: Latches = { ifid: null, idex: null, exmem: null, memwb: null };
  private seq = 0;

  constructor(readonly mem: Memory, public config: PipelineConfig, private sourceOf?: Map<number, string>) {}

  private fetch(pc: number, seq: number): Inflight {
    const { d, text } = fetchAt(this.mem, pc, this.sourceOf);
    return { seq, pc, d, text, rs1v: 0, rs2v: 0, result: 0, memAddr: 0, storeVal: 0, wbValue: 0 };
  }

  step(): CycleReport {
    const cycle = ++this.stats.cycles;
    const old = this.latches;
    const events: SimEvent[] = [];
    const stages: Partial<Record<StageName, Slot>> = {};
    const fwd = this.config.forwarding;

    // ---------- WB ----------
    const wb = old.memwb;
    stages.WB = slot(wb);
    if (wb) {
      this.stats.retired++;
      if (halts(wb.d)) {
        this.halted = true;
        events.push({ kind: 'halt', message: wb.d.op === 'invalid' ? 'Palavra inválida chegou a WB: fim da execução.' : `${wb.d.op} chegou a WB: fim do programa.` });
      } else if (writesRd(wb.d)) {
        this.regs[wb.d.rd] = wb.wbValue;
      }
    }

    // ---------- MEM ----------
    let newMemwb: Inflight | null = null;
    const m = old.exmem;
    stages.MEM = slot(m);
    if (m && !this.halted) {
      newMemwb = { ...m, wbValue: m.result };
      if (isLoad(m.d)) {
        newMemwb.wbValue = load(this.mem, m.d.op, m.memAddr);
        events.push({ kind: 'load', message: `${m.d.op} leu ${newMemwb.wbValue} do endereço ${m.memAddr}.` });
      } else if (isStore(m.d)) {
        store(this.mem, m.d.op, m.memAddr, m.storeVal);
        events.push({ kind: 'store', message: `${m.d.op} escreveu ${m.storeVal} no endereço ${m.memAddr}.` });
      }
    }

    // ---------- EX ----------
    let newExmem: Inflight | null = null;
    let redirect: number | null = null;
    const e = old.idex;
    stages.EX = slot(e);
    if (e) {
      let a = e.rs1v;
      let b = e.rs2v;
      if (fwd) {
        const pick = (r: number, cur: number, which: 'rs1' | 'rs2'): number => {
          if (r === 0) return cur;
          if (old.exmem && writesRd(old.exmem.d) && !isLoad(old.exmem.d) && old.exmem.d.rd === r) {
            this.stats.forwards++;
            events.push({ kind: 'forward', from: 'MEM', to: 'EX', reg: r, message: `Forwarding EX/MEM→EX: x${r} = ${old.exmem.result} (${which}) vem de "${old.exmem.text}".` });
            return old.exmem.result;
          }
          if (old.memwb && writesRd(old.memwb.d) && old.memwb.d.rd === r) {
            this.stats.forwards++;
            events.push({ kind: 'forward', from: 'WB', to: 'EX', reg: r, message: `Forwarding MEM/WB→EX: x${r} = ${old.memwb.wbValue} (${which}) vem de "${old.memwb.text}".` });
            return old.memwb.wbValue;
          }
          return cur;
        };
        if (readsRs1(e.d)) a = pick(e.d.rs1, a, 'rs1');
        if (readsRs2(e.d)) b = pick(e.d.rs2, b, 'rs2');
      }
      const r = execute(e.d, a, b, e.pc);
      newExmem = { ...e, rs1v: a, rs2v: b, result: r.result, memAddr: r.memAddr, storeVal: b };
      if (isControl(e.d)) {
        if (r.taken) {
          redirect = r.target;
          events.push({ kind: 'branch', message: `${e.d.op} tomado em EX: próximo PC = ${r.target}.` });
        } else {
          events.push({ kind: 'branch', message: `${e.d.op} não tomado: a predição acertou, nada é descartado.` });
        }
      }
    }

    // ---------- ID ----------
    let newIdex: Inflight | null = null;
    let stall = false;
    const i = old.ifid;
    if (i) {
      if (redirect !== null) {
        stages.ID = slot(i, 'squash');
      } else {
        const producers = fwd ? [old.idex].filter((p) => p && isLoad(p.d)) : [old.idex, old.exmem];
        for (const p of producers) {
          if (!p || !writesRd(p.d)) continue;
          const r = p.d.rd;
          if ((readsRs1(i.d) && i.d.rs1 === r) || (readsRs2(i.d) && i.d.rs2 === r)) {
            stall = true;
            events.push({
              kind: 'stall', reg: r,
              message: fwd
                ? `Load-use: "${i.text}" precisa de x${r}, que "${p.text}" só lê da memória no próximo ciclo. Uma bolha.`
                : `Hazard RAW sem forwarding: "${i.text}" espera x${r} de "${p.text}" chegar a WB.`,
            });
            break;
          }
        }
        stages.ID = slot(i, stall ? 'stall' : 'ok');
        if (stall) {
          this.stats.stalls++;
        } else {
          newIdex = { ...i, rs1v: this.regs[i.d.rs1], rs2v: this.regs[i.d.rs2] };
        }
      }
    }

    // ---------- IF ----------
    let newIfid: Inflight | null = null;
    const blocked = [redirect === null ? old.ifid : null, old.idex, old.exmem].some((x) => x && halts(x.d));
    if (this.halted) {
      // nada a buscar
    } else if (redirect !== null) {
      const squashed = this.fetch(this.pc, this.seq++);
      stages.IF = slot(squashed, 'squash');
      const lost = (old.ifid ? 1 : 0) + 1;
      this.stats.flushes += lost;
      events.push({ kind: 'flush', message: `Flush: ${lost} instrução(ões) buscadas pelo caminho errado foram descartadas.` });
      this.pc = redirect;
    } else if (stall) {
      newIfid = old.ifid;
      if (!blocked) stages.IF = slot(this.fetch(this.pc, this.seq), 'stall');
    } else if (!blocked) {
      newIfid = this.fetch(this.pc, this.seq++);
      stages.IF = slot(newIfid);
      this.pc = (this.pc + 4) | 0;
    }

    if (this.halted) {
      this.latches = { ifid: null, idex: null, exmem: null, memwb: null };
    } else {
      this.latches = { ifid: newIfid, idex: newIdex, exmem: newExmem, memwb: newMemwb };
    }
    return { cycle, stages, events };
  }

  snapshot() {
    return structuredClone({
      regs: Array.from(this.regs), pc: this.pc, halted: this.halted, stats: this.stats,
      latches: this.latches, seq: this.seq, config: this.config,
    });
  }

  restore(s: unknown) {
    const v = structuredClone(s) as ReturnType<Pipeline['snapshot']>;
    this.regs = Int32Array.from(v.regs);
    this.pc = v.pc;
    this.halted = v.halted;
    this.stats = v.stats;
    this.latches = v.latches;
    this.seq = v.seq;
    this.config = v.config;
  }
}
