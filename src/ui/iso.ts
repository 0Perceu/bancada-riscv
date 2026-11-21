/** Projeção isométrica (30°) e primitivas SVG no estilo "nanquim". */
export const C = Math.cos(Math.PI / 6);
export const S = 0.5;

export type Pt = [number, number];

export function P(x: number, y: number, z = 0): Pt {
  return [(x - y) * C, (x + y) * S - z];
}

const pts = (ps: Pt[]) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

export const NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

export interface BoxStyle {
  top: string;
  left: string;
  right: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: string;
  className?: string;
}

/** Caixa com 3 faces visíveis: topo, frente-esquerda (y máx.) e frente-direita (x máx.). */
export function box(parent: Element, x: number, y: number, z: number, w: number, d: number, h: number, st: BoxStyle) {
  const g = el('g', st.className ? { class: st.className } : {}, parent);
  const stroke = st.stroke ?? 'var(--ink)';
  const sw = st.strokeWidth ?? 2;
  const common = { stroke, 'stroke-width': sw, 'stroke-linejoin': 'round', ...(st.dash ? { 'stroke-dasharray': st.dash } : {}) };
  el('polygon', { points: pts([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)]), fill: st.left, ...common }, g);
  el('polygon', { points: pts([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)]), fill: st.right, ...common }, g);
  el('polygon', { points: pts([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)]), fill: st.top, ...common }, g);
  return g;
}

/** Matriz que deita um texto no plano do topo (eixo x do texto = eixo x do mundo). */
export function topPlane(x: number, y: number, z: number) {
  const [tx, ty] = P(x, y, z);
  return `matrix(${C} ${S} ${-C} ${S} ${tx} ${ty})`;
}

/** Texto ao longo do eixo y do mundo, no topo. */
export function topPlaneY(x: number, y: number, z: number) {
  const [tx, ty] = P(x, y, z);
  return `matrix(${-C} ${S} ${C} ${S} ${tx} ${ty})`;
}

export function polyline(parent: Element, ps: Pt[], attrs: Record<string, string | number>) {
  return el('polyline', { points: pts(ps), fill: 'none', ...attrs }, parent);
}
