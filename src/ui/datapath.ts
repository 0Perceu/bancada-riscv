/**
 * Vista detalhada do caminho de dados: cada componente da microarquitetura desenhado
 * explicitamente (PC, somador, memórias/caches, banco de registradores, gerador de imediato,
 * controle, multiplexadores, ALU, unidades de forwarding e de hazard, registradores de pipeline).
 * A cada ciclo acendem os fios realmente usados e aparecem os valores que passam por eles.
 */
import { ABI_NAMES } from '../core/isa';
import type { CycleReport, Datapath, StageName } from '../core/machine';
import { Pt, el, polyline } from './iso';

type WireId =
  | 'pc_imem' | 'pc_add' | 'add_mux' | 'br_mux' | 'mux_pc' | 'imem_ifid' | 'pc_ifid'
  | 'ifid_rs1' | 'ifid_rs2' | 'ifid_imm' | 'ifid_ctl' | 'regA' | 'regB' | 'imm_idex' | 'ctl_idex' | 'pc_idex'
  | 'idexA' | 'idexB' | 'fa_alu' | 'fb_src' | 'imm_src' | 'src_alu' | 'alu_exmem' | 'pc_badd' | 'imm_badd' | 'badd_out'
  | 'exmem_fa' | 'exmem_fb' | 'memwb_fa' | 'memwb_fb' | 'b_exmem' | 'ctl_ex'
  | 'exmem_addr' | 'exmem_wd' | 'exmem_bypass' | 'dmem_memwb' | 'ctl_mem'
  | 'memwb_mem' | 'memwb_alu' | 'wb_regs' | 'rd_regs';

const WIRES: Record<WireId, Pt[]> = {
  // IF
  pc_imem: [[95, 235], [125, 235]],
  pc_add: [[105, 235], [105, 130], [125, 130]],
  add_mux: [[165, 130], [178, 130], [178, 92], [14, 92], [14, 220], [22, 220]],
  br_mux: [[680, 105], [720, 105], [720, 52], [6, 52], [6, 250], [22, 250]],
  mux_pc: [[38, 235], [55, 235]],
  imem_ifid: [[225, 240], [255, 240]],
  pc_ifid: [[105, 170], [255, 170]],
  // ID
  ifid_rs1: [[269, 205], [320, 205]],
  ifid_rs2: [[269, 235], [320, 235]],
  ifid_imm: [[269, 355], [330, 355]],
  ifid_ctl: [[269, 82], [325, 82]],
  regA: [[440, 195], [485, 195]],
  regB: [[440, 260], [485, 260]],
  imm_idex: [[430, 355], [485, 355]],
  ctl_idex: [[415, 82], [485, 82]],
  pc_idex: [[269, 170], [485, 170]],
  // EX
  idexA: [[499, 195], [530, 195]],
  idexB: [[499, 260], [530, 260]],
  fa_alu: [[546, 210], [630, 210]],
  fb_src: [[546, 275], [580, 275]],
  imm_src: [[499, 355], [565, 355], [565, 305], [580, 305]],
  src_alu: [[596, 290], [630, 290]],
  alu_exmem: [[690, 250], [765, 250]],
  pc_badd: [[499, 170], [600, 170], [600, 108], [620, 108]],
  imm_badd: [[499, 355], [505, 355], [505, 92], [620, 92]],
  badd_out: [[680, 100], [700, 100]],
  exmem_fa: [[779, 250], [790, 250], [790, 375], [522, 375], [522, 210], [530, 210]],
  exmem_fb: [[779, 250], [790, 250], [790, 375], [522, 375], [522, 275], [530, 275]],
  memwb_fa: [[1056, 295], [1100, 295], [1100, 390], [514, 390], [514, 225], [530, 225]],
  memwb_fb: [[1056, 295], [1100, 295], [1100, 390], [514, 390], [514, 290], [530, 290]],
  b_exmem: [[556, 275], [556, 330], [765, 330]],
  ctl_ex: [[499, 82], [765, 82]],
  // MEM
  exmem_addr: [[779, 250], [800, 250], [800, 230], [820, 230]],
  exmem_wd: [[779, 330], [806, 330], [806, 290], [820, 290]],
  exmem_bypass: [[779, 250], [800, 250], [800, 350], [985, 350]],
  dmem_memwb: [[940, 240], [985, 240]],
  ctl_mem: [[779, 82], [985, 82]],
  // WB
  memwb_mem: [[999, 240], [1040, 240]],
  memwb_alu: [[999, 350], [1040, 350]],
  wb_regs: [[1056, 295], [1100, 295], [1100, 485], [296, 485], [296, 290], [320, 290]],
  rd_regs: [[999, 465], [306, 465], [306, 265], [320, 265]],
};

/** Fios que só existem no pipeline (forwarding). */
const PIPE_ONLY: WireId[] = ['exmem_fa', 'exmem_fb', 'memwb_fa', 'memwb_fb'];

type CompId = 'pc' | 'pcmux' | 'add4' | 'imem' | 'ctl' | 'regs' | 'imm' | 'hazard' | 'fa' | 'fb' | 'src' | 'alu' | 'badd' | 'fwd' | 'dmem' | 'wbmux';

const LATCH_X = [255, 485, 765, 985];
const LATCH_NAMES = ['IF/ID', 'ID/EX', 'EX/MEM', 'MEM/WB'];
const STAGE_X: Record<StageName, number> = { IF: 130, ID: 370, EX: 630, MEM: 880, WB: 1090 };

const hex = (v: number) => '0x' + (v >>> 0).toString(16);
const reg = (r: number) => `x${r}`;

export class DatapathView {
  readonly svg: SVGSVGElement;
  private wires = new Map<WireId, SVGPolylineElement>();
  private comps = new Map<CompId, SVGGElement>();
  private texts = new Map<string, SVGTextElement>();
  private heads = new Map<StageName, SVGTextElement>();
  private pipeOnly: Element[] = [];
  private cacheSubs: SVGTextElement[] = [];
  private model: 'single' | 'pipeline' = 'pipeline';

  constructor(host: HTMLElement) {
    this.svg = el('svg', { class: 'dp', viewBox: '0 0 1180 515', role: 'img', 'aria-label': 'Caminho de dados com todos os componentes' }) as SVGSVGElement;
    host.appendChild(this.svg);
    this.build();
  }

  private comp(id: CompId, g: SVGGElement) {
    g.classList.add('comp');
    this.comps.set(id, g);
    return g;
  }

  private rect(id: CompId, x: number, y: number, w: number, h: number, title: string, sub?: string) {
    const g = this.comp(id, el('g', {}, this.svg) as SVGGElement);
    el('rect', { x, y, width: w, height: h, rx: 6, class: 'body' }, g);
    const t = el('text', { x: x + w / 2, y: y + (sub ? h / 2 - 2 : h / 2 + 4), 'text-anchor': 'middle', class: 'ctitle' }, g);
    t.textContent = title;
    if (sub) {
      const s = el('text', { x: x + w / 2, y: y + h / 2 + 13, 'text-anchor': 'middle', class: 'csub' }, g) as SVGTextElement;
      s.textContent = sub;
      return { g, sub: s };
    }
    return { g, sub: null };
  }

  private mux(id: CompId, x: number, y: number, h: number, inputs: string[]) {
    const g = this.comp(id, el('g', {}, this.svg) as SVGGElement);
    el('polygon', { points: `${x},${y} ${x + 16},${y + 8} ${x + 16},${y + h - 8} ${x},${y + h}`, class: 'body' }, g);
    inputs.forEach((s, k) => {
      const t = el('text', { x: x + 3, y: y + ((k + 1) * h) / (inputs.length + 1) + 3, class: 'mux-in' }, g);
      t.textContent = s;
    });
    return g;
  }

  private value(key: string, x: number, y: number, anchor: 'start' | 'middle' | 'end' = 'middle') {
    const t = el('text', { x, y, 'text-anchor': anchor, class: 'val' }, this.svg) as SVGTextElement;
    this.texts.set(key, t);
    return t;
  }

  private build() {
    const svg = this.svg;
    // cabeçalho dos estágios
    (Object.keys(STAGE_X) as StageName[]).forEach((s) => {
      const n = el('text', { x: STAGE_X[s], y: 16, 'text-anchor': 'middle', class: 'stage-h' }, svg);
      n.textContent = s;
      this.heads.set(s, el('text', { x: STAGE_X[s], y: 34, 'text-anchor': 'middle', class: 'stage-i' }, svg) as SVGTextElement);
    });

    // fios embaixo dos componentes
    const wl = el('g', { class: 'wires' }, svg);
    (Object.keys(WIRES) as WireId[]).forEach((id) => {
      const p = polyline(wl, WIRES[id], { class: 'wire', 'data-w': id }) as SVGPolylineElement;
      this.wires.set(id, p);
      if (PIPE_ONLY.includes(id)) this.pipeOnly.push(p);
    });

    // registradores de pipeline
    LATCH_X.forEach((x, i) => {
      const g = el('g', { class: 'latch' }, svg);
      el('rect', { x, y: 60, width: 14, height: 415, rx: 3, class: 'body' }, g);
      const t = el('text', { x: x + 7, y: 508, 'text-anchor': 'middle', class: 'csub' }, g);
      t.textContent = LATCH_NAMES[i];
    });

    // IF
    this.mux('pcmux', 22, 205, 60, ['+4', 'd']);
    this.rect('pc', 55, 215, 40, 40, 'PC');
    this.rect('add4', 125, 112, 40, 36, '+4');
    const im = this.rect('imem', 125, 190, 100, 100, 'Mem. de', 'instruções');
    if (im.sub) this.cacheSubs.push(im.sub);
    this.value('pc', 75, 275);
    this.value('icache', 175, 280);

    // ID
    const ctl = this.comp('ctl', el('g', {}, svg) as SVGGElement);
    el('ellipse', { cx: 370, cy: 82, rx: 45, ry: 18, class: 'body' }, ctl);
    el('text', { x: 370, y: 86, 'text-anchor': 'middle', class: 'ctitle' }, ctl).textContent = 'Controle';
    this.rect('regs', 320, 180, 120, 125, 'Banco de', 'registradores');
    for (const [y, s] of [[205, 'rs1'], [235, 'rs2'], [265, 'rd'], [290, 'dado']] as const) {
      el('text', { x: 324, y: y + 3, class: 'port' }, svg).textContent = s;
    }
    this.rect('imm', 330, 336, 100, 38, 'Gerador imm');
    const hz = this.rect('hazard', 340, 412, 120, 40, 'Unid. hazard');
    el('polyline', { points: '340,432 75,432 75,255', class: 'ctrl' }, hz.g);
    el('circle', { cx: 262, cy: 432, r: 4, class: 'ctrl-dot' }, hz.g);
    this.pipeOnly.push(hz.g);
    this.value('regs', 380, 322);
    this.value('immv', 380, 395);

    // EX
    this.mux('fa', 530, 185, 50, ['', '', '']);
    this.mux('fb', 530, 250, 50, ['', '', '']);
    this.mux('src', 580, 262, 56, ['rs2', 'imm']);
    const alu = this.comp('alu', el('g', {}, svg) as SVGGElement);
    el('polygon', { points: '630,185 690,215 690,285 630,315 630,265 646,250 630,235', class: 'body' }, alu);
    el('text', { x: 668, y: 254, 'text-anchor': 'middle', class: 'ctitle' }, alu).textContent = 'ALU';
    this.rect('badd', 620, 82, 60, 36, 'PC+imm');
    const fu = this.rect('fwd', 560, 402, 150, 40, 'Unid. forwarding');
    el('polyline', { points: '600,402 600,320 538,320 538,300', class: 'ctrl' }, fu.g);
    el('polyline', { points: '538,320 538,320', class: 'ctrl' }, fu.g);
    this.pipeOnly.push(fu.g);
    this.value('a', 588, 204);
    this.value('b', 612, 342, 'middle');
    this.value('res', 728, 243);
    this.value('alu-op', 668, 272);
    this.value('br', 650, 140);

    // MEM
    const dm = this.rect('dmem', 820, 190, 120, 120, 'Mem. de', 'dados');
    if (dm.sub) this.cacheSubs.push(dm.sub);
    for (const [y, s] of [[230, 'end.'], [290, 'escr.']] as const) el('text', { x: 824, y: y + 3, class: 'port' }, svg).textContent = s;
    this.value('mem', 880, 330);
    this.value('dcache', 880, 300);

    // WB
    this.mux('wbmux', 1040, 220, 150, ['mem', 'ALU']);
    this.value('wb', 1112, 206);

    // os componentes ficam por cima dos fios; os rótulos de valor por cima de tudo
    for (const t of this.texts.values()) svg.appendChild(t);
  }

  setModel(model: 'single' | 'pipeline', caches: boolean) {
    this.model = model;
    for (const e of this.pipeOnly) (e as SVGElement).style.display = model === 'single' ? 'none' : '';
    const [is, ds] = this.cacheSubs;
    is.textContent = caches ? 'I-cache' : 'instruções';
    ds.textContent = caches ? 'D-cache' : 'dados';
    this.svg.classList.toggle('with-cache', caches);
    this.svg.classList.toggle('single', model === 'single');
  }

  render(rep: CycleReport | undefined) {
    const on = new Set<WireId>();
    const hot = new Set<WireId>();
    const comps = new Map<CompId, string>();
    const set = (k: string, v: string) => (this.texts.get(k)!.textContent = v);
    for (const k of this.texts.keys()) set(k, '');
    const single = this.model === 'single';

    (Object.keys(STAGE_X) as StageName[]).forEach((s) => {
      const slot = rep?.stages[s];
      const head = this.heads.get(s)!;
      let t = slot ? slot.text.replace(/\s+#.*$/, '') : rep ? 'bolha' : '';
      if (t.length > 22) t = t.slice(0, 21) + '…';
      if (slot && slot.status !== 'ok') t += slot.status === 'miss' ? ' · MISS' : slot.status === 'stall' ? ' · STALL' : ' · FLUSH';
      head.textContent = single && s !== 'EX' ? '' : t;
      head.classList.toggle('empty', !slot);
    });
    if (single && rep?.stages.EX) this.heads.get('EX')!.textContent = rep.stages.EX.text.replace(/\s+#.*$/, '');

    const dp: Datapath | undefined = rep?.dp;
    if (rep && dp) {
      const st = rep.stages;
      // ---- IF ----
      if (st.IF) {
        on.add('pc_imem');
        comps.set('pc', 'on');
        comps.set('imem', dp.icache === 'miss' || dp.icache === 'wait' ? 'miss' : 'on');
        if (st.IF.status === 'ok') {
          for (const w of ['pc_add', 'imem_ifid', 'pc_ifid'] as WireId[]) on.add(w);
          comps.set('add4', 'on');
        }
      }
      if (dp.pcSrc === 'pc4') {
        on.add('add_mux');
        on.add('mux_pc');
        comps.set('pcmux', 'on');
      } else if (dp.pcSrc === 'branch') {
        hot.add('br_mux');
        hot.add('mux_pc');
        comps.set('pcmux', 'hot');
      }
      set('pc', `PC ${hex(dp.pc)}`);
      if (dp.icache) set('icache', { hit: 'acerto', miss: 'FALTA', wait: 'esperando…' }[dp.icache]);

      // ---- ID ----
      if (dp.id && st.ID && st.ID.status !== 'squash') {
        const d = dp.id;
        on.add('ifid_ctl');
        on.add('ctl_idex');
        on.add('pc_idex');
        comps.set('ctl', 'on');
        comps.set('regs', 'on');
        if (d.readsRs1) on.add('ifid_rs1'), on.add('regA');
        if (d.readsRs2) on.add('ifid_rs2'), on.add('regB');
        if (d.usesImm) {
          on.add('ifid_imm');
          on.add('imm_idex');
          comps.set('imm', 'on');
          set('immv', `imm = ${d.imm}`);
        }
        const parts = [d.readsRs1 ? `rs1=${reg(d.rs1)}` : '', d.readsRs2 ? `rs2=${reg(d.rs2)}` : ''].filter(Boolean);
        set('regs', parts.join('  '));
      }
      if (dp.hazard) comps.set('hazard', 'alert');

      // ---- EX ----
      if (dp.ex && st.EX && st.EX.status === 'ok') {
        const x = dp.ex;
        comps.set('alu', 'on');
        on.add('alu_exmem');
        on.add('ctl_ex');
        const a = { reg: 'idexA', exmem: 'exmem_fa', memwb: 'memwb_fa' }[x.fwdA] as WireId;
        (x.fwdA === 'reg' ? on : hot).add(a);
        on.add('fa_alu');
        comps.set('fa', x.fwdA === 'reg' ? 'on' : 'hot');
        const b = { reg: 'idexB', exmem: 'exmem_fb', memwb: 'memwb_fb' }[x.fwdB] as WireId;
        const isStore = ['sb', 'sh', 'sw'].includes(x.op);
        const usesRs2 = !x.aluSrcImm || isStore;
        if (usesRs2) {
          (x.fwdB === 'reg' ? on : hot).add(b);
          comps.set('fb', x.fwdB === 'reg' ? 'on' : 'hot');
        }
        comps.set('src', 'on');
        on.add('src_alu');
        on.add(x.aluSrcImm ? 'imm_src' : 'fb_src');
        if (isStore) on.add('b_exmem');
        if (x.fwdA !== 'reg' || (usesRs2 && x.fwdB !== 'reg')) comps.set('fwd', 'hot');
        if (x.isBranch) {
          comps.set('badd', 'on');
          on.add('pc_badd');
          on.add('imm_badd');
          on.add('badd_out');
          set('br', x.taken ? `tomado → ${hex(x.target)}` : 'não tomado');
        }
        set('a', `A=${x.a}`);
        set('b', x.aluSrcImm ? `B=imm ${x.imm}` : `B=${x.b}`);
        set('res', `${x.result}`);
        set('alu-op', x.op);
      }

      // ---- MEM ----
      if (dp.mem && st.MEM) {
        const m = dp.mem;
        on.add('ctl_mem');
        const waiting = st.MEM.status === 'miss';
        if (m.kind === 'none') {
          on.add('exmem_bypass');
        } else {
          on.add('exmem_addr');
          if (m.kind === 'store') on.add('exmem_wd');
          if (m.kind === 'load' && !waiting) on.add('dmem_memwb');
          comps.set('dmem', m.cache === 'miss' || m.cache === 'wait' ? 'miss' : 'on');
          set('mem', waiting ? `end. ${m.addr}` : m.kind === 'load' ? `leu ${m.value} de ${m.addr}` : `escreveu ${m.value} em ${m.addr}`);
          if (m.cache) set('dcache', { hit: 'acerto', miss: 'FALTA', wait: 'esperando…' }[m.cache]);
        }
      }

      // ---- WB ----
      if (dp.wb && st.WB) {
        const w = dp.wb;
        comps.set('wbmux', 'on');
        on.add(w.src === 'mem' ? 'memwb_mem' : 'memwb_alu');
        if (w.write) {
          on.add('wb_regs');
          on.add('rd_regs');
          set('wb', `${reg(w.rd)} (${ABI_NAMES[w.rd]}) ← ${w.value}`);
        }
      }
    }

    for (const [id, p] of this.wires) {
      p.classList.toggle('on', on.has(id));
      p.classList.toggle('hot', hot.has(id));
    }
    for (const [id, g] of this.comps) {
      g.classList.remove('on', 'hot', 'miss', 'alert');
      const c = comps.get(id);
      if (c) g.classList.add(c);
    }
    // fios acesos por último, para ficarem por cima dos apagados
    const layer = this.svg.querySelector('.wires')!;
    for (const [id, p] of this.wires) if (on.has(id) || hot.has(id)) layer.appendChild(p);
  }
}
