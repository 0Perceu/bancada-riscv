/**
 * Placa completa: o mesmo caminho de dados da vista 2D (todos os componentes da microarquitetura),
 * desenhado como placa em nanquim colorido, no estilo da bancada.
 * A geometria em planta (x, y) é a da vista 2D; aqui ela é "deitada" na placa e cada componente vira um chip.
 * Usa uma projeção oblíqua (x na horizontal, profundidade em diagonal) em vez da isométrica da placa simples:
 * com ~20 componentes, assim a placa ocupa a largura da tela e os textos ficam retos e legíveis.
 */
import type { CycleReport, StageName } from '../core/machine';
import { CompId, LATCH_NAMES, LATCH_X, PIPE_ONLY, STAGE_X, WIRES, WireId, computeDatapath } from './datapath';
import { Pt, el, polyline } from './iso';
import type { BoardOptions } from './board';

const BASE_H = 14;
const Z = BASE_H + 8; // altura da superfície da placa (PCB)
const LATCH_H = 30;
/** Direção da profundidade (eixo y da planta) na tela. */
const KX = -0.42;
const KY = 0.68;
/** Projeção oblíqua: x da planta vai para a direita, y recua em diagonal, z sobe. */
const P = (x: number, y: number, z = 0): Pt => [x + KX * y, KY * y - z];

type Shape = { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'poly'; pts: Pt[] };

interface CompDef {
  id: CompId;
  shape: Shape;
  height: number;
  title?: string;
  sub?: string;
  pipeOnly?: boolean;
}

const mux = (x: number, y: number, h: number): Shape => ({ kind: 'poly', pts: [[x, y], [x + 16, y + 8], [x + 16, y + h - 8], [x, y + h]] });
const ellipse = (cx: number, cy: number, rx: number, ry: number): Shape => ({
  kind: 'poly',
  pts: Array.from({ length: 24 }, (_, k) => [cx + rx * Math.cos((k / 24) * 2 * Math.PI), cy + ry * Math.sin((k / 24) * 2 * Math.PI)] as Pt),
});

/** Mesma planta da vista 2D (src/ui/datapath.ts). */
const COMPS: CompDef[] = [
  { id: 'pcmux', shape: mux(22, 205, 60), height: 14 },
  { id: 'pc', shape: { kind: 'rect', x: 55, y: 215, w: 40, h: 40 }, height: 20, title: 'PC' },
  { id: 'add4', shape: { kind: 'rect', x: 125, y: 112, w: 40, h: 36 }, height: 16, title: '+4' },
  { id: 'imem', shape: { kind: 'rect', x: 125, y: 190, w: 100, h: 100 }, height: 24, title: 'Mem. instr.', sub: '' },
  { id: 'ctl', shape: ellipse(370, 82, 45, 18), height: 14, title: 'Controle' },
  { id: 'regs', shape: { kind: 'rect', x: 320, y: 180, w: 120, h: 125 }, height: 24, title: 'Registradores', sub: 'x0 … x31' },
  { id: 'imm', shape: { kind: 'rect', x: 330, y: 336, w: 100, h: 38 }, height: 16, title: 'Gerador imm' },
  { id: 'hazard', shape: { kind: 'rect', x: 340, y: 412, w: 120, h: 40 }, height: 16, title: 'Unid. hazard', pipeOnly: true },
  { id: 'fa', shape: mux(530, 185, 50), height: 14 },
  { id: 'fb', shape: mux(530, 250, 50), height: 14 },
  { id: 'src', shape: mux(580, 262, 56), height: 14 },
  { id: 'alu', shape: { kind: 'poly', pts: [[630, 185], [690, 215], [690, 285], [630, 315], [630, 265], [646, 250], [630, 235]] }, height: 26, title: 'ALU', sub: '' },
  { id: 'badd', shape: { kind: 'rect', x: 620, y: 82, w: 60, h: 36 }, height: 16, title: 'PC+imm' },
  { id: 'fwd', shape: { kind: 'rect', x: 560, y: 402, w: 150, h: 40 }, height: 16, title: 'Unid. forwarding', pipeOnly: true },
  { id: 'dmem', shape: { kind: 'rect', x: 820, y: 190, w: 120, h: 120 }, height: 24, title: 'Mem. dados', sub: '' },
  { id: 'wbmux', shape: mux(1040, 220, 150), height: 14 },
];

/** Onde aparece cada valor do ciclo (mesmas chaves da vista 2D). ALU e caches viram texto no próprio chip. */
const VALUES: Record<string, Pt> = {
  pc: [75, 290],
  regs: [380, 318],
  immv: [380, 392],
  a: [560, 168],
  b: [600, 340],
  res: [728, 236],
  br: [650, 64],
  mem: [880, 330],
  wb: [1110, 200],
};

/** Fios de controle das unidades de hazard e forwarding (tracejados). */
const CTRL: Array<{ pts: Pt[]; comp: CompId }> = [
  { pts: [[340, 432], [75, 432], [75, 255]], comp: 'hazard' },
  { pts: [[600, 402], [600, 320], [538, 320], [538, 300]], comp: 'fwd' },
];

interface SolidView {
  g: SVGGElement;
  sub: SVGTextElement | null;
}

export class FullBoard {
  readonly svg: SVGSVGElement;
  private root!: SVGGElement;
  private wires = new Map<WireId, { under: SVGPolylineElement; line: SVGPolylineElement }>();
  private solids = new Map<CompId, SolidView>();
  private ctrls: Array<{ el: SVGPolylineElement; comp: CompId }> = [];
  private values = new Map<string, { g: SVGGElement; rect: SVGRectElement; text: SVGTextElement }>();
  private heads = new Map<StageName, { g: SVGGElement; rect: SVGRectElement; text: SVGTextElement }>();
  private turbulence!: SVGFETurbulenceElement;
  private displace!: SVGFEDisplacementMapElement;
  private wobbleTimer = 0;
  private opts: BoardOptions = { model: 'pipeline', labels: true, exploded: false, caches: null };

  constructor(host: HTMLElement) {
    this.svg = el('svg', { class: 'board fb', role: 'img', 'aria-label': 'Placa com o caminho de dados completo' }) as SVGSVGElement;
    host.appendChild(this.svg);
    this.build();
  }

  setOptions(o: Partial<BoardOptions>) {
    this.opts = { ...this.opts, ...o };
    const single = this.opts.model === 'single';
    this.svg.classList.toggle('single', single);
    this.svg.classList.toggle('no-labels', !this.opts.labels);
    this.svg.classList.toggle('exploded', this.opts.exploded);
    this.svg.classList.toggle('with-cache', !!this.opts.caches);
    const i = this.solids.get('imem')!, d = this.solids.get('dmem')!;
    i.g.querySelector('title')!.textContent = this.opts.caches ? `I-cache: ${this.opts.caches.i}` : 'Memória de instruções';
    d.g.querySelector('title')!.textContent = this.opts.caches ? `D-cache: ${this.opts.caches.d}` : 'Memória de dados';
  }

  setWobble(scale: number) {
    this.displace.setAttribute('scale', String(scale));
    this.root.setAttribute('filter', scale > 0 ? 'url(#fb-wobble)' : '');
    clearInterval(this.wobbleTimer);
    if (scale > 0) {
      let seed = 1;
      this.wobbleTimer = window.setInterval(() => this.turbulence.setAttribute('seed', String((seed = (seed % 6) + 1))), 160);
    }
  }

  /** Mostra/esconde a placa; ao mostrar, reenquadra (o enquadramento precisa do layout). */
  show(visible: boolean) {
    this.svg.style.display = visible ? '' : 'none';
    if (visible) this.fit();
  }

  private build() {
    const svg = this.svg;
    svg.replaceChildren();
    svg.setAttribute('viewBox', '-260 -90 1480 520');

    const defs = el('defs', {}, svg);
    const f = el('filter', { id: 'fb-wobble', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
    this.turbulence = el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.022', numOctaves: 2, seed: 1, result: 'n' }, f) as SVGFETurbulenceElement;
    this.displace = el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G' }, f) as SVGFEDisplacementMapElement;

    this.root = el('g', {}, svg) as SVGGElement;
    const root = this.root;

    // base de madeira e placa
    this.prism(root, { kind: 'rect', x: -34, y: -24, w: 1200, h: 560 }, 0, BASE_H, 'fb-base');
    this.prism(root, { kind: 'rect', x: -22, y: -12, w: 1176, h: 536 }, BASE_H, Z - BASE_H, 'fb-pcb');
    for (const [hx, hy] of [[-6, 4], [1136, 4], [-6, 506], [1136, 506]]) {
      const [cx, cy] = P(hx, hy, Z);
      el('ellipse', { cx, cy, rx: 7, ry: 4.4, class: 'fb-hole' }, root);
    }
    // serigrafia: nomes dos estágios e da placa
    (Object.keys(STAGE_X) as StageName[]).forEach((s) => {
      const [sx, sy] = P(STAGE_X[s], 36, Z);
      const t = el('text', { x: sx, y: sy, 'text-anchor': 'middle', class: 'fb-silk-stage' }, root);
      t.textContent = s;
    });
    const [kx, ky] = P(530, 514, Z);
    const silk = el('text', { x: kx, y: ky, class: 'silk' }, root);
    silk.textContent = 'RV32I · DATAPATH · REV C';

    // trilhas (na superfície da placa, embaixo de tudo)
    const wl = el('g', { class: 'fb-wires' }, root);
    (Object.keys(WIRES) as WireId[]).forEach((id) => {
      const pts = WIRES[id].map(([x, y]) => P(x, y, Z));
      const cls = PIPE_ONLY.includes(id) ? ' pipe-only' : '';
      const under = polyline(wl, pts, { class: 'fb-wire-under' + cls }) as SVGPolylineElement;
      const line = polyline(wl, pts, { class: 'fb-wire' + cls }) as SVGPolylineElement;
      this.wires.set(id, { under, line });
    });
    for (const c of CTRL) {
      const p = polyline(wl, c.pts.map(([x, y]) => P(x, y, Z)), { class: 'fb-ctrl pipe-only' }) as SVGPolylineElement;
      this.ctrls.push({ el: p, comp: c.comp });
    }
    // marcas dos registradores de pipeline na placa (aparecem tracejadas no monociclo)
    LATCH_X.forEach((x) => this.footprint(root, x, 60, 14, 415));

    // componentes por região (entre latches), de trás para frente, para um tapar o outro corretamente
    const region = (c: CompDef) => {
      const xs = c.shape.kind === 'rect' ? [c.shape.x] : c.shape.pts.map((p) => p[0]);
      const x = Math.min(...xs);
      return LATCH_X.filter((lx) => lx < x).length;
    };
    const depth = (c: CompDef) => {
      const ps = this.points(c.shape);
      return ps.reduce((a, p) => a + p[0] + p[1], 0) / ps.length;
    };
    for (let r = 0; r <= LATCH_X.length; r++) {
      COMPS.filter((c) => region(c) === r)
        .sort((a, b) => depth(a) - depth(b))
        .forEach((c) => this.buildComp(c));
      if (r < LATCH_X.length) this.buildLatch(r);
    }

    // etiquetas (por cima de tudo, fora do filtro de traço tremido)
    const labels = el('g', { class: 'fb-labels' }, svg);
    (Object.keys(STAGE_X) as StageName[]).forEach((s) => {
      const [ax, ay] = P(STAGE_X[s], -12, Z);
      const g = el('g', { class: 'fb-head' }, labels) as SVGGElement;
      const ly = ay - 40;
      el('line', { x1: ax, y1: ay, x2: ax, y2: ly + 11, class: 'leader' }, g);
      const rect = el('rect', { x: ax - 40, y: ly - 11, width: 80, height: 22, rx: 11, class: 'pill' }, g) as SVGRectElement;
      const text = el('text', { x: ax, y: ly + 4.5, 'text-anchor': 'middle', class: 'pill-text' }, g) as SVGTextElement;
      this.heads.set(s, { g, rect, text });
    });
    const vals = el('g', { class: 'fb-vals' }, labels);
    for (const [k, [x, y]] of Object.entries(VALUES)) {
      const [cx, cy] = P(x, y, Z + 26);
      const g = el('g', { class: 'fb-val' }, vals) as SVGGElement;
      const rect = el('rect', { x: cx - 30, y: cy - 10, width: 60, height: 20, rx: 10, class: 'fb-val-pill' }, g) as SVGRectElement;
      const text = el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'fb-val-text' }, g) as SVGTextElement;
      this.values.set(k, { g, rect, text });
    }
  }

  private points(s: Shape): Pt[] {
    return s.kind === 'rect' ? [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]] : s.pts;
  }

  /** Extrusão de um polígono em planta: faces laterais visíveis (de trás para a frente) e o topo. */
  private prism(parent: Element, shape: Shape, z: number, h: number, cls: string) {
    const ps = this.points(shape);
    const g = el('g', { class: cls }, parent) as SVGGElement;
    let area = 0;
    for (let i = 0; i < ps.length; i++) {
      const [ax, ay] = ps[i], [bx, by] = ps[(i + 1) % ps.length];
      area += ax * by - bx * ay;
    }
    const sides: Array<{ d: number; pts: Pt[]; cls: string }> = [];
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i], b = ps[(i + 1) % ps.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const n: Pt = area > 0 ? [dy, -dx] : [-dy, dx];
      if (n[0] + n[1] <= 1e-6) continue; // face de trás
      sides.push({
        d: a[0] + a[1] + b[0] + b[1],
        pts: [P(a[0], a[1], z), P(b[0], b[1], z), P(b[0], b[1], z + h), P(a[0], a[1], z + h)],
        cls: Math.abs(n[1]) >= Math.abs(n[0]) ? 'left' : 'right',
      });
    }
    sides.sort((p, q) => p.d - q.d);
    const str = (q: Pt[]) => q.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    for (const s of sides) el('polygon', { points: str(s.pts), class: s.cls }, g);
    el('polygon', { points: str(ps.map(([x, y]) => P(x, y, z + h))), class: 'top' }, g);
    return g;
  }

  private footprint(parent: Element, x: number, y: number, w: number, h: number) {
    const q = [P(x, y, Z), P(x + w, y, Z), P(x + w, y + h, Z), P(x, y + h, Z)];
    el('polygon', { points: q.map((p) => p.join(',')).join(' '), class: 'fb-footprint' }, parent);
  }

  private buildComp(c: CompDef) {
    const g = el('g', { class: 'fb-lift fb-solid' + (c.pipeOnly ? ' pipe-only' : '') }, this.root) as SVGGElement;
    this.prism(g, c.shape, Z, c.height, 'fb-body');
    const ps = this.points(c.shape);
    const cx = ps.reduce((a, p) => a + p[0], 0) / ps.length;
    const cy = ps.reduce((a, p) => a + p[1], 0) / ps.length;
    const top = Z + c.height;
    let sub: SVGTextElement | null = null;
    if (c.title) {
      const big = c.shape.kind === 'rect' && c.shape.w >= 100 && c.shape.h >= 90;
      const [tx, ty] = P(cx, cy, top);
      const t = el('text', { x: tx, y: ty + (c.sub !== undefined ? -1 : 5), 'text-anchor': 'middle', class: big ? 'fb-title big' : 'fb-title' }, g);
      t.textContent = c.title;
      if (c.sub !== undefined) {
        sub = el('text', { x: tx, y: ty + 14, 'text-anchor': 'middle', class: 'fb-sub' }, g) as SVGTextElement;
        sub.textContent = c.sub;
      }
    }
    el('title', {}, g).textContent = c.title ?? 'Multiplexador';
    this.solids.set(c.id, { g, sub });
  }

  private buildLatch(i: number) {
    const x = LATCH_X[i];
    const g = el('g', { class: 'fb-lift fb-latch' }, this.root) as SVGGElement;
    this.prism(g, { kind: 'rect', x, y: 60, w: 14, h: 415 }, Z, LATCH_H, 'fb-body');
    const [tx, ty] = P(x + 7, 475, Z);
    const t = el('text', { x: tx, y: ty + 14, 'text-anchor': 'middle', class: 'fb-latch-name' }, g);
    t.textContent = LATCH_NAMES[i];
  }

  /** Enquadra a placa e as etiquetas, com folga em cima para a vista explodida e os rótulos dos estágios. */
  fit() {
    try {
      const b = this.root.getBBox();
      if (!b.width) return;
      const top = 64, side = 12, bottom = 8;
      this.svg.setAttribute('viewBox', `${b.x - side} ${b.y - top} ${b.width + 2 * side} ${b.height + top + bottom}`);
    } catch {
      // sem layout (placa escondida): mantém o viewBox anterior
    }
  }

  render(rep: CycleReport | undefined) {
    const single = this.opts.model === 'single';
    const { on, hot, comps, texts, heads } = computeDatapath(rep, this.opts.model);
    for (const [id, w] of this.wires) {
      for (const e of [w.under, w.line]) {
        e.classList.toggle('on', on.has(id));
        e.classList.toggle('hot', hot.has(id));
      }
    }
    // trilhas acesas por cima das apagadas
    const layer = this.svg.querySelector('.fb-wires')!;
    for (const [id, w] of this.wires) if (on.has(id) || hot.has(id)) layer.append(w.under, w.line);
    for (const c of this.ctrls) layer.appendChild(c.el);

    for (const [id, s] of this.solids) {
      s.g.classList.remove('on', 'hot', 'miss', 'alert');
      const st = comps.get(id);
      if (st) s.g.classList.add(st);
    }
    for (const c of this.ctrls) {
      const st = comps.get(c.comp);
      c.el.classList.toggle('alert', st === 'alert');
      c.el.classList.toggle('hot', st === 'hot');
    }

    // textos que moram no próprio chip
    const ic = texts.get('icache'), dc = texts.get('dcache');
    this.solids.get('imem')!.sub!.textContent = this.opts.caches ? `I-cache${ic ? ' · ' + ic : ''}` : '';
    this.solids.get('dmem')!.sub!.textContent = this.opts.caches ? `D-cache${dc ? ' · ' + dc : ''}` : '';
    this.solids.get('alu')!.sub!.textContent = texts.get('alu-op') ?? '';

    for (const [k, v] of this.values) {
      const t = texts.get(k) ?? '';
      v.g.style.display = t ? '' : 'none';
      if (!t) continue;
      v.text.textContent = t;
      const w = t.length * 7.6 + 16;
      const cx = Number(v.text.getAttribute('x'));
      v.rect.setAttribute('x', String(cx - w / 2));
      v.rect.setAttribute('width', String(w));
    }

    for (const [s, h] of this.heads) {
      const v = heads.get(s)!;
      const show = !single || s === 'EX';
      h.g.style.display = show ? '' : 'none';
      const t = `${s} · ${v.text || (rep ? 'bolha' : '—')}`;
      h.text.textContent = t;
      h.g.classList.toggle('empty', v.empty);
      const w = Math.max(70, t.length * 8 + 22);
      const cx = Number(h.text.getAttribute('x'));
      h.rect.setAttribute('x', String(cx - w / 2));
      h.rect.setAttribute('width', String(w));
    }
  }
}
