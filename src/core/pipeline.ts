/**
 * Pipeline clássico de 5 estágios (IF, ID, EX, MEM, WB).
 *
 * - O banco de registradores escreve na 1ª metade do ciclo e lê na 2ª: WB e ID no mesmo ciclo não conflitam.
 * - Desvios e saltos são resolvidos em EX com predição "não tomado": se tomados, IF e ID são descartados (2 bolhas).
 * - Com forwarding: caminhos EX/MEM→EX e MEM/WB→EX; resta só a bolha de load-use.
 * - Sem forwarding: a instrução espera em ID até o produtor chegar a WB.
 * - Com caches: uma falta na cache de instruções segura o IF (bolhas entram em ID); uma falta na
 *   cache de dados congela IF, ID, EX e MEM até o bloco chegar (bolha em WB).
 *
 * O ciclo é calculado a partir dos latches antigos, do fim para o começo, como no hardware.
 */
import { execute, load, store } from './exec';
import { Decoded, halts, isControl, isLoad, isStore, readsRs1, readsRs2, usesImm, writesRd } from './isa';
import { Cache } from './cache';
import { CacheSetup, CacheState, CycleReport, Datapath, FwdSrc, Machine, SimEvent, Slot, StageName, emptyStats, fetchAt, initialRegs } from './machine';
import { Memory, TEXT_BASE } from './memory';

export interface PipelineConfig {
  forwarding: boolean;
  caches?: CacheSetup | null;
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
  icache: Cache | null = null;
  dcache: Cache | null = null;
  /** Ciclos que ainda faltam para o bloco chegar, e se ele já está na cache. */
  private wait = { i: 0, iFilled: false, d: 0, dFilled: false };

  constructor(readonly mem: Memory, public config: PipelineConfig, private sourceOf?: Map<number, string>) {
    if (config.caches) {
      this.icache = new Cache('I-cache', config.caches.i);
      this.dcache = new Cache('D-cache', config.caches.d);
    }
  }

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
    const dp: Datapath = { pc: this.pc, pcNext: this.pc, pcSrc: 'hold', icache: null, hazard: false, flush: false };

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
      dp.wb = {
        rd: wb.d.rd, value: wb.wbValue, write: !halts(wb.d) && writesRd(wb.d) && wb.d.rd !== 0,
        src: isLoad(wb.d) ? 'mem' : wb.d.op === 'jal' || wb.d.op === 'jalr' ? 'pc4' : 'alu',
      };
    }

    // ---------- MEM ----------
    let newMemwb: Inflight | null = null;
    let memStall = false;
    const m = old.exmem;
    stages.MEM = slot(m);
    if (m && !this.halted) {
      const touches = isLoad(m.d) || isStore(m.d);
      let dstate: CacheState = null;
      if (touches && this.dcache) {
        if (this.wait.d === 0 && !this.wait.dFilled) {
          const acc = this.dcache.access(m.memAddr, isStore(m.d));
          dstate = acc.hit ? 'hit' : 'miss';
          if (acc.hit) {
            events.push({ kind: 'cache', message: `D-cache: acerto no endereço ${m.memAddr} (conjunto ${acc.set}, via ${acc.way}).` });
          } else {
            this.wait.d = acc.penalty;
            this.wait.dFilled = true;
            events.push({
              kind: 'cache',
              message: `D-cache: falta no endereço ${m.memAddr}. O bloco vem da memória em ${acc.penalty} ciclos${acc.writeback ? ' (inclui gravar de volta o bloco sujo expulso)' : ''}; o pipeline congela.`,
            });
          }
        } else if (this.wait.d > 0) {
          dstate = 'wait';
          events.push({ kind: 'cache', message: `D-cache: ainda esperando o bloco (${this.wait.d} ciclo(s)).` });
        }
        if (this.wait.d > 0) {
          this.wait.d--;
          memStall = true;
        } else {
          this.wait.dFilled = false;
        }
      }
      if (memStall) {
        stages.MEM = slot(m, 'miss');
        this.stats.cacheStalls++;
      } else {
        newMemwb = { ...m, wbValue: m.result };
        if (isLoad(m.d)) {
          newMemwb.wbValue = load(this.mem, m.d.op, m.memAddr);
          events.push({ kind: 'load', message: `${m.d.op} leu ${newMemwb.wbValue} do endereço ${m.memAddr}.` });
        } else if (isStore(m.d)) {
          store(this.mem, m.d.op, m.memAddr, m.storeVal);
          events.push({ kind: 'store', message: `${m.d.op} escreveu ${m.storeVal} no endereço ${m.memAddr}.` });
        }
      }
      dp.mem = {
        kind: isLoad(m.d) ? 'load' : isStore(m.d) ? 'store' : 'none', addr: m.memAddr,
        value: isLoad(m.d) ? (newMemwb?.wbValue ?? 0) : m.storeVal, cache: dstate,
      };
    }

    if (memStall) {
      // Falta na D-cache: tudo atrás de MEM fica parado; WB recebe uma bolha.
      const e = old.idex;
      let held = e;
      if (e && fwd && old.memwb && writesRd(old.memwb.d) && old.memwb.d.rd !== 0) {
        // O produtor em MEM/WB sai do pipeline agora: a instrução parada em EX guarda o valor dele.
        const r = old.memwb.d.rd;
        const newer = old.exmem && writesRd(old.exmem.d) && old.exmem.d.rd === r;
        if (!newer) {
          held = { ...e };
          if (readsRs1(e.d) && e.d.rs1 === r) held.rs1v = old.memwb.wbValue;
          if (readsRs2(e.d) && e.d.rs2 === r) held.rs2v = old.memwb.wbValue;
        }
      }
      if (e) stages.EX = slot(e, 'stall');
      if (old.ifid) stages.ID = slot(old.ifid, 'stall');
      const blocked = [old.ifid, old.idex, old.exmem].some((x) => x && halts(x.d));
      if (!blocked) stages.IF = slot(this.fetch(this.pc, this.seq), 'stall');
      dp.icache = this.wait.i > 0 ? 'wait' : null;
      this.latches = { ifid: old.ifid, idex: held, exmem: old.exmem, memwb: null };
      return { cycle, stages, events, dp };
    }

    // ---------- EX ----------
    let newExmem: Inflight | null = null;
    let redirect: number | null = null;
    const e = old.idex;
    stages.EX = slot(e);
    if (e) {
      let a = e.rs1v;
      let b = e.rs2v;
      let fwdA: FwdSrc = 'reg';
      let fwdB: FwdSrc = 'reg';
      if (fwd) {
        const pick = (r: number, cur: number, which: 'rs1' | 'rs2'): [number, FwdSrc] => {
          if (r === 0) return [cur, 'reg'];
          if (old.exmem && writesRd(old.exmem.d) && !isLoad(old.exmem.d) && old.exmem.d.rd === r) {
            this.stats.forwards++;
            events.push({ kind: 'forward', from: 'MEM', to: 'EX', reg: r, message: `Forwarding EX/MEM→EX: x${r} = ${old.exmem.result} (${which}) vem de "${old.exmem.text}".` });
            return [old.exmem.result, 'exmem'];
          }
          if (old.memwb && writesRd(old.memwb.d) && old.memwb.d.rd === r) {
            this.stats.forwards++;
            events.push({ kind: 'forward', from: 'WB', to: 'EX', reg: r, message: `Forwarding MEM/WB→EX: x${r} = ${old.memwb.wbValue} (${which}) vem de "${old.memwb.text}".` });
            return [old.memwb.wbValue, 'memwb'];
          }
          return [cur, 'reg'];
        };
        if (readsRs1(e.d)) [a, fwdA] = pick(e.d.rs1, a, 'rs1');
        if (readsRs2(e.d)) [b, fwdB] = pick(e.d.rs2, b, 'rs2');
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
      dp.ex = {
        op: e.d.op, a, b, imm: e.d.imm, fwdA, fwdB, aluSrcImm: usesImm(e.d), result: r.result,
        isBranch: isControl(e.d), taken: r.taken, target: r.target,
      };
    }

    // ---------- ID ----------
    let newIdex: Inflight | null = null;
    let stall = false;
    const i = old.ifid;
    if (i) {
      dp.id = {
        rs1: i.d.rs1, rs2: i.d.rs2, rd: i.d.rd, imm: i.d.imm,
        readsRs1: readsRs1(i.d), readsRs2: readsRs2(i.d), usesImm: usesImm(i.d),
      };
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
          dp.hazard = true;
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
      if (this.wait.i > 0) events.push({ kind: 'cache', message: 'I-cache: a espera pelo bloco foi abandonada; a busca recomeça no destino do desvio.' });
      this.wait.i = 0;
      this.wait.iFilled = false;
      this.pc = redirect;
      dp.flush = true;
      dp.pcSrc = 'branch';
    } else if (stall) {
      newIfid = old.ifid;
      if (this.wait.i > 0) {
        this.wait.i--;
        dp.icache = 'wait';
      }
      if (!blocked) stages.IF = slot(this.fetch(this.pc, this.seq), 'stall');
    } else if (!blocked) {
      let waiting = false;
      if (this.icache) {
        if (this.wait.i === 0 && !this.wait.iFilled) {
          const acc = this.icache.access(this.pc, false);
          dp.icache = acc.hit ? 'hit' : 'miss';
          if (!acc.hit) {
            this.wait.i = acc.penalty;
            this.wait.iFilled = true;
            events.push({ kind: 'cache', message: `I-cache: falta no PC ${this.pc}. O bloco de ${this.icache.config.blockBytes} bytes chega em ${acc.penalty} ciclos; enquanto isso entram bolhas em ID.` });
          }
        } else if (this.wait.i > 0) {
          dp.icache = 'wait';
        }
        if (this.wait.i > 0) {
          this.wait.i--;
          waiting = true;
        } else {
          this.wait.iFilled = false;
        }
      }
      if (waiting) {
        stages.IF = slot(this.fetch(this.pc, this.seq), 'miss');
        this.stats.cacheStalls++;
      } else {
        newIfid = this.fetch(this.pc, this.seq++);
        stages.IF = slot(newIfid);
        this.pc = (this.pc + 4) | 0;
        dp.pcSrc = 'pc4';
      }
    }
    dp.pcNext = this.pc;

    if (this.halted) {
      this.latches = { ifid: null, idex: null, exmem: null, memwb: null };
    } else {
      this.latches = { ifid: newIfid, idex: newIdex, exmem: newExmem, memwb: newMemwb };
    }
    return { cycle, stages, events, dp };
  }

  snapshot() {
    return structuredClone({
      regs: Array.from(this.regs), pc: this.pc, halted: this.halted, stats: this.stats,
      latches: this.latches, seq: this.seq, config: this.config, wait: this.wait,
      icache: this.icache?.snapshot() ?? null, dcache: this.dcache?.snapshot() ?? null,
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
    this.wait = v.wait;
    if (this.icache && v.icache) this.icache.restore(v.icache);
    if (this.dcache && v.dcache) this.dcache.restore(v.dcache);
  }
}
