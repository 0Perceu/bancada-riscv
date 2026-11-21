/** Desenha o caminho de dados como uma placa isométrica e atualiza o estado a cada ciclo. */
import type { CycleReport, Slot, StageName } from '../core/machine';
import { STAGES } from '../core/machine';
import { C, P, Pt, box, el, polyline, topPlane, topPlaneY } from './iso';

const BX = 50;
const BY = 90;
const BW = 112;
const BD = 128;
const BH = 34;
const STEP = 158;
const BASE_H = 14;
const PCB_Z = BASE_H + 8;

const STAGE_INFO: Record<StageName, { name: string; pipe: string; single: string }> = {
  IF: { name: 'IF', pipe: 'busca', single: 'IMEM' },
  ID: { name: 'ID', pipe: 'decodifica', single: 'REGS' },
  EX: { name: 'EX', pipe: 'executa', single: 'ALU' },
  MEM: { name: 'MEM', pipe: 'memória', single: 'DMEM' },
  WB: { name: 'WB', pipe: 'escreve', single: 'WB' },
};

const LATCHES = ['IF/ID', 'ID/EX', 'EX/MEM', 'MEM/WB'];

export interface BoardOptions {
  model: 'single' | 'pipeline';
  labels: boolean;
  exploded: boolean;
}

interface StageView {
  group: SVGGElement;
  chip: SVGGElement;
  label: SVGGElement;
  labelRect: SVGRectElement;
  labelText: SVGTextElement;
  leader: SVGLineElement;
  tag: SVGGElement;
  tagText: SVGTextElement;
  tagRect: SVGRectElement;
}

export class Board {
  readonly svg: SVGSVGElement;
  private root!: SVGGElement;
  private stages = new Map<StageName, StageView>();
  private latchGroups: SVGGElement[] = [];
  private fwdLayer!: SVGGElement;
  private turbulence!: SVGFETurbulenceElement;
  private displace!: SVGFEDisplacementMapElement;
  private wobbleTimer = 0;
  private opts: BoardOptions = { model: 'pipeline', labels: true, exploded: false };

  constructor(host: HTMLElement) {
    this.svg = el('svg', { class: 'board', role: 'img', 'aria-label': 'Caminho de dados isométrico' }) as SVGSVGElement;
    host.appendChild(this.svg);
    this.build();
  }

  private stageX(i: number) {
    return BX + i * STEP;
  }

  setOptions(o: Partial<BoardOptions>) {
    const rebuild = o.model !== undefined && o.model !== this.opts.model;
    this.opts = { ...this.opts, ...o };
    if (rebuild) this.build();
    this.svg.classList.toggle('no-labels', !this.opts.labels);
    this.svg.classList.toggle('exploded', this.opts.exploded);
  }

  setWobble(scale: number) {
    this.displace.setAttribute('scale', String(scale));
    this.root.setAttribute('filter', scale > 0 ? 'url(#wobble)' : '');
    clearInterval(this.wobbleTimer);
    if (scale > 0) {
      let seed = 1;
      // "boil": troca a semente do ruído para o traço tremer como desenho animado à mão
      this.wobbleTimer = window.setInterval(() => this.turbulence.setAttribute('seed', String((seed = (seed % 6) + 1))), 160);
    }
  }

  private build() {
    this.svg.replaceChildren();
    this.stages.clear();
    this.latchGroups = [];
    const W = BX * 2 + STEP * 4 + BW;
    const D = BY * 2 + BD + 20;
    const corners = [P(0, 0, 0), P(W, 0, 0), P(0, D, 0), P(W, D, 0), P(0, 0, 150)];
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const pad = 24;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - 70, maxY = Math.max(...ys) + pad;
    this.svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);

    const defs = el('defs', {}, this.svg);
    const f = el('filter', { id: 'wobble', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
    this.turbulence = el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.022', numOctaves: 2, seed: 1, result: 'n' }, f) as SVGFETurbulenceElement;
    this.displace = el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G' }, f) as SVGFEDisplacementMapElement;
    const m = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--ink)' }, m);
    const hatch = el('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 6, height: 6, fill: 'var(--stall)' }, hatch);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--ink)', 'stroke-width': 1.4 }, hatch);

    this.root = el('g', {}, this.svg) as SVGGElement;

    // base de madeira clara e placa (PCB) na cor de destaque
    box(this.root, 0, 0, 0, W, D, BASE_H, { top: 'var(--base-top)', left: 'var(--base-left)', right: 'var(--base-right)' });
    box(this.root, 14, 14, BASE_H, W - 28, D - 28, PCB_Z - BASE_H, { top: 'var(--pcb-top)', left: 'var(--pcb-left)', right: 'var(--pcb-right)' });
    // furos de fixação
    for (const [hx, hy] of [[30, 30], [W - 30, 30], [30, D - 30], [W - 30, D - 30]]) {
      const [cx, cy] = P(hx, hy, PCB_Z);
      el('ellipse', { cx, cy, rx: 7 * C * 1.15, ry: 7 * 0.5 * 1.15, fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': 2 }, this.root);
    }
    // serigrafia
    const silk = el('text', { transform: topPlane(40, D - 44, PCB_Z), class: 'silk' }, this.root);
    silk.textContent = this.opts.model === 'single' ? 'RV32I · MONOCICLO · REV A' : 'RV32I · PIPELINE 5 ESTÁGIOS · REV B';

    // trilhas entre estágios
    const traces = el('g', { class: 'traces' }, this.root);
    for (let i = 0; i < 4; i++) {
      for (const dy of [BD * 0.35, BD * 0.5, BD * 0.65]) {
        const x0 = this.stageX(i) + BW, x1 = this.stageX(i + 1);
        polyline(traces, [P(x0, BY + dy, PCB_Z), P(x1, BY + dy, PCB_Z)], { class: 'trace' });
      }
    }
    // retorno do WB para o banco de registradores (ID)
    const wbx = this.stageX(4) + BW / 2, idx = this.stageX(1) + BW / 2;
    polyline(traces, [P(wbx, BY + BD, PCB_Z), P(wbx, BY + BD + 62, PCB_Z), P(idx, BY + BD + 62, PCB_Z), P(idx, BY + BD, PCB_Z)], { class: 'trace back' });
    // PC + 4 / destino de desvio volta ao IF
    const exx = this.stageX(2) + BW / 2, ifx = this.stageX(0) + BW / 2;
    polyline(traces, [P(exx, BY, PCB_Z), P(exx, BY - 36, PCB_Z), P(ifx, BY - 36, PCB_Z), P(ifx, BY, PCB_Z)], { class: 'trace back' });

    // estágios
    const order: Array<{ kind: 'stage'; i: number } | { kind: 'latch'; i: number }> = [];
    for (let i = 0; i < 5; i++) {
      order.push({ kind: 'stage', i });
      if (i < 4) order.push({ kind: 'latch', i });
    }
    for (const it of order) {
      if (it.kind === 'latch') {
        if (this.opts.model === 'pipeline') this.buildLatch(it.i);
      } else {
        this.buildStage(STAGES[it.i], it.i);
      }
    }
    this.fwdLayer = el('g', { class: 'fwd-layer' }, this.root) as SVGGElement;
    this.fit();
  }

  /** Enquadra o viewBox no desenho real (placa + etiquetas), sem sobras vazias. */
  private fit() {
    const hadNoLabels = this.svg.classList.contains('no-labels');
    this.svg.classList.remove('no-labels');
    try {
      const b = this.root.getBBox();
      if (b.width > 0 && b.height > 0) {
        const padX = 56; // etiquetas crescem com o texto da instrução
        const padTop = 84; // espaço para a vista explodida (estágios sobem 78)
        const padBottom = 12;
        this.svg.setAttribute('viewBox', `${b.x - padX} ${b.y - padTop} ${b.width + padX * 2} ${b.height + padTop + padBottom}`);
      }
    } catch {
      // sem layout (ex.: elemento oculto): mantém o viewBox calculado em build()
    } finally {
      if (hadNoLabels) this.svg.classList.add('no-labels');
    }
  }

  private buildLatch(i: number) {
    const x = this.stageX(i) + BW + (STEP - BW) / 2 - 8;
    const g = el('g', { class: 'lift latch' }, this.root) as SVGGElement;
    box(g, x, BY - 12, PCB_Z, 16, BD + 24, 54, { top: 'var(--latch-top)', left: 'var(--latch-left)', right: 'var(--latch-right)' });
    const t = el('text', { transform: topPlaneY(x + 11, BY + BD + 8, PCB_Z + 54), class: 'latch-name' }, g);
    t.textContent = LATCHES[i];
    this.latchGroups.push(g);
  }

  private buildStage(name: StageName, i: number) {
    const x = this.stageX(i);
    const info = STAGE_INFO[name];
    const fp = [P(x, BY, PCB_Z), P(x + BW, BY, PCB_Z), P(x + BW, BY + BD, PCB_Z), P(x, BY + BD, PCB_Z)];
    el('polygon', { points: fp.map((q) => q.join(',')).join(' '), class: 'footprint' }, this.root);
    const group = el('g', { class: 'lift stage', 'data-stage': name }, this.root) as SVGGElement;
    box(group, x, BY, PCB_Z, BW, BD, BH, { top: 'var(--chip-top)', left: 'var(--chip-left)', right: 'var(--chip-right)', className: 'stage-block' });
    // pinos na frente
    for (let k = 0; k < 7; k++) {
      const px = x + 10 + k * 15;
      const a = P(px, BY + BD, PCB_Z + 4), b = P(px, BY + BD + 7, PCB_Z);
      el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'pin' }, group);
    }
    const title = el('text', { transform: topPlane(x + 12, BY + 30, PCB_Z + BH), class: 'stage-name' }, group);
    title.textContent = this.opts.model === 'single' ? info.single : info.name;
    const sub = el('text', { transform: topPlane(x + 12, BY + 52, PCB_Z + BH), class: 'stage-sub' }, group);
    sub.textContent = info.pipe;
    // "LED" de atividade
    const [lx, ly] = P(x + BW - 18, BY + 18, PCB_Z + BH);
    el('ellipse', { cx: lx, cy: ly, rx: 6, ry: 3.5, class: 'led' }, group);

    // chip da instrução (aparece quando o estágio está ocupado)
    const chip = el('g', { class: 'chip' }, group) as SVGGElement;
    box(chip, x + 46, BY + 78, PCB_Z + BH, BW - 58, BD - 92, 10, { top: 'var(--ichip-top)', left: 'var(--ichip-left)', right: 'var(--ichip-right)' });

    // etiqueta com linha guia
    const anchor = P(x + 46 + (BW - 58) / 2, BY + 96, PCB_Z + BH + 10);
    const high = i % 2 === 1;
    const lx2 = anchor[0];
    const ly2 = anchor[1] - (high ? 150 : 104);
    const label = el('g', { class: 'ilabel' }, group) as SVGGElement;
    const leader = el('line', { x1: anchor[0], y1: anchor[1], x2: lx2, y2: ly2 + 12, class: 'leader' }, label) as SVGLineElement;
    const labelRect = el('rect', { x: lx2 - 50, y: ly2 - 12, width: 100, height: 24, rx: 12, class: 'pill' }, label) as SVGRectElement;
    const labelText = el('text', { x: lx2, y: ly2 + 4.5, 'text-anchor': 'middle', class: 'pill-text' }, label) as SVGTextElement;
    const tag = el('g', { class: 'tag' }, label) as SVGGElement;
    const tagRect = el('rect', { x: lx2 - 26, y: ly2 - 34, width: 52, height: 18, rx: 4, class: 'tag-rect' }, tag) as SVGRectElement;
    const tagText = el('text', { x: lx2, y: ly2 - 21, 'text-anchor': 'middle', class: 'tag-text' }, tag) as SVGTextElement;
    this.stages.set(name, { group, chip, label, labelRect, labelText, leader, tag, tagText, tagRect });
  }

  render(rep: CycleReport | undefined) {
    const single = this.opts.model === 'single';
    for (const name of STAGES) {
      const v = this.stages.get(name)!;
      const s: Slot | undefined = rep?.stages[name];
      v.group.classList.remove('busy', 'stall', 'squash', 'bubble');
      if (!s) {
        v.group.classList.add(rep ? 'bubble' : 'idle');
        this.setLabel(v, rep ? 'bolha' : '—', null);
        continue;
      }
      v.group.classList.remove('idle');
      v.group.classList.add('busy');
      if (s.status !== 'ok') v.group.classList.add(s.status);
      const showText = !single || name === 'EX';
      this.setLabel(v, showText ? s.text.replace(/\s+#.*$/, '') : '', s.status === 'stall' ? 'STALL' : s.status === 'squash' ? 'FLUSH' : null);
      v.label.style.display = showText ? '' : 'none';
    }
    // forwarding: trilhas acesas na frente da placa, do latch de origem até a entrada da ALU (EX)
    this.fwdLayer.replaceChildren();
    const seen = new Set<string>();
    const fwds = (rep?.events.filter((e) => e.kind === 'forward') ?? []).filter((e) => {
      const k = `${e.from}-${e.reg}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    fwds.forEach((ev) => {
      const fromWB = ev.from === 'WB';
      const srcX = fromWB ? this.stageX(4) - (STEP - BW) / 2 : this.stageX(3) - (STEP - BW) / 2;
      const dstX = this.stageX(2) + 22;
      const y0 = BY + BD + 12;
      const y1 = BY + BD + (fromWB ? 44 : 26);
      const pts: Pt[] = [P(srcX, y0, PCB_Z), P(srcX, y1, PCB_Z), P(dstX, y1, PCB_Z), P(dstX, y0, PCB_Z)];
      polyline(this.fwdLayer, pts, { class: 'fwd-under' });
      const line = polyline(this.fwdLayer, pts, { class: 'fwd', 'marker-end': 'url(#arrow)' });
      line.setAttribute('pathLength', '100');
      const [mx, my] = P((srcX + dstX) / 2, y1, PCB_Z);
      const txt = `FWD x${ev.reg} ${fromWB ? 'MEM/WB' : 'EX/MEM'}→EX`;
      const w = txt.length * 7.4 + 18;
      const ly = my + 26;
      el('line', { x1: mx, y1: my, x2: mx, y2: ly - 11, class: 'leader' }, this.fwdLayer);
      el('rect', { x: mx - w / 2, y: ly - 11, width: w, height: 22, rx: 11, class: 'pill fwd-pill' }, this.fwdLayer);
      const t = el('text', { x: mx, y: ly + 4, 'text-anchor': 'middle', class: 'pill-text' }, this.fwdLayer);
      t.textContent = txt;
    });
  }

  private setLabel(v: StageView, text: string, tag: string | null) {
    const t = text.length > 24 ? text.slice(0, 23) + '…' : text;
    v.labelText.textContent = t;
    const w = Math.max(56, t.length * 7.6 + 22);
    const cx = Number(v.leader.getAttribute('x2'));
    v.labelRect.setAttribute('x', String(cx - w / 2));
    v.labelRect.setAttribute('width', String(w));
    v.tag.style.display = tag ? '' : 'none';
    if (tag) v.tagText.textContent = tag;
  }
}
