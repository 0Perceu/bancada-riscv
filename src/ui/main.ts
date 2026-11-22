import './style.css';
import { AssemblyError } from '../core/assembler';
import { Cache, CacheConfig, DEFAULT_CACHE, hitRate } from '../core/cache';
import { ABI_NAMES } from '../core/isa';
import { CacheSetup, CycleReport, STAGES, StageName } from '../core/machine';
import { DATA_BASE } from '../core/memory';
import { ModelKind, Session } from '../core/session';
import { FIGURES, Figure } from '../programs';
import { Board } from './board';
import { DatapathView } from './datapath';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ACCENTS = [
  { name: 'amarelo', v: '#E9B028' },
  { name: 'vermelho', v: '#E25243' },
  { name: 'verde', v: '#8DD6A6' },
  { name: 'azul', v: '#6D93D9' },
  { name: 'rosa', v: '#EB8FB4' },
];

const store = {
  get(k: string) {
    try { return localStorage.getItem('rvb.' + k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem('rvb.' + k, v); } catch { /* sem armazenamento: tudo bem */ }
  },
};

// ---------------- estado da interface ----------------
let fig: Figure = FIGURES[0];
let model: ModelKind = fig.config.model;
let forwarding = fig.config.forwarding;
let session: Session | null = null;
let prevRegs = new Int32Array(32);
let running = 0;
let exploded = false;
let labels = true;
let cachesOn = false;
let cacheCfg: CacheConfig = { ...DEFAULT_CACHE };

const board = new Board($('board-host'));
const datapath = new DatapathView($('datapath'));

const cacheSetup = (): CacheSetup | null => (cachesOn ? { i: { ...cacheCfg }, d: { ...cacheCfg } } : null);
const geom = (c: CacheConfig) => `${c.sets} conj. × ${c.ways} via${c.ways > 1 ? "s" : ""} × ${c.blockBytes} B = ${c.sets * c.ways * c.blockBytes} B`;

// ---------------- barra lateral ----------------
function buildSidebar() {
  const nav = $('figs');
  nav.replaceChildren();
  let group = '';
  FIGURES.forEach((f, i) => {
    if (f.group !== group) {
      group = f.group;
      const h = document.createElement('div');
      h.className = 'nav-group';
      h.textContent = group;
      nav.appendChild(h);
    }
    const b = document.createElement('button');
    b.className = 'nav-item' + (f === fig ? ' active' : '');
    b.innerHTML = `<span class="n">Fig. ${String(i + 1).padStart(2, '0')}</span><span class="t">${f.title}</span><span class="s">${f.subtitle}</span>`;
    b.onclick = () => selectFigure(f);
    nav.appendChild(b);
  });
}

function selectFigure(f: Figure) {
  stop();
  fig = f;
  model = f.config.model;
  forwarding = f.config.forwarding;
  cachesOn = !!f.config.caches;
  if (f.config.caches) cacheCfg = { ...f.config.caches.d };
  syncCacheForm();
  const idx = FIGURES.indexOf(f) + 1;
  $('fig-title').textContent = `Fig. ${String(idx).padStart(2, '0')} — ${f.title}`;
  $('fig-tagline').textContent = f.tagline;
  $('intro').innerHTML = f.intro.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  $('editor-title').textContent = f.title.toLowerCase();
  $<HTMLTextAreaElement>('code').value = f.source;
  buildSidebar();
  assembleAndReset();
}

// ---------------- sessão ----------------
function assembleAndReset() {
  stop();
  const src = $<HTMLTextAreaElement>('code').value;
  const msg = $('asm-msg');
  try {
    session = new Session(src, { model, forwarding, caches: cacheSetup() });
    prevRegs = Int32Array.from(session.machine.regs);
    msg.textContent = `${session.program.text.length} instruções · ${session.program.data.length} bytes de dados`;
    msg.className = 'asm-msg ok';
    setTip(model === 'single' ? 'MONTADO. CADA PASSO = UMA INSTRUÇÃO →' : 'MONTADO. CADA PASSO = UM CICLO →');
    compare(src);
  } catch (e) {
    session = null;
    if (e instanceof AssemblyError) {
      msg.textContent = e.errors.map((x) => `linha ${x.line}: ${x.message}`).join('  ·  ');
      msg.className = 'asm-msg err';
      setTip('ERRO DE MONTAGEM: VEJA O EDITOR');
    } else throw e;
  }
  const cs = cacheSetup();
  board.setOptions({ model, caches: cs ? { i: geom(cs.i), d: geom(cs.d) } : null });
  datapath.setModel(model, !!cs);
  refreshControls();
  render();
}

function step() {
  if (!session || session.done) return false;
  prevRegs = Int32Array.from(session.machine.regs);
  session.step();
  render();
  return !session.done;
}

function back() {
  if (!session) return;
  stop();
  session.stepBack();
  prevRegs = Int32Array.from(session.machine.regs);
  render();
}

function run() {
  if (running) return stop();
  if (!session || session.done) return;
  const speed = Number($<HTMLInputElement>('speed').value);
  const interval = Math.round(1000 / speed);
  running = window.setInterval(() => {
    if (!step()) stop();
  }, interval);
  refreshControls();
}

function stop() {
  if (running) clearInterval(running);
  running = 0;
  refreshControls();
}

function toEnd() {
  if (!session) return;
  stop();
  prevRegs = Int32Array.from(session.machine.regs);
  session.run();
  render();
}

// ---------------- renderização ----------------
function setTip(text: string) {
  $('tip').textContent = text;
}

function tipFor(rep: CycleReport | undefined): string {
  if (!session) return '';
  if (!rep) return model === 'single' ? 'MONTADO. CADA PASSO = UMA INSTRUÇÃO →' : 'MONTADO. CADA PASSO = UM CICLO →';
  const ev = rep.events;
  const halt = ev.find((e) => e.kind === 'halt');
  if (halt) return `FIM EM ${rep.cycle} CICLOS. ← VOLTE PARA REVER`;
  if (rep.stages.MEM?.status === 'miss') return 'FALTA NA D-CACHE: PIPELINE CONGELADO ATÉ O BLOCO CHEGAR';
  if (rep.stages.IF?.status === 'miss') return 'FALTA NA I-CACHE: BOLHAS ENTRAM ENQUANTO O BLOCO CHEGA';
  const stall = ev.find((e) => e.kind === 'stall');
  if (stall) return `STALL: x${stall.reg} AINDA NÃO ESTÁ PRONTO`;
  if (ev.some((e) => e.kind === 'flush')) return 'FLUSH: DESVIO TOMADO, 2 INSTRUÇÕES DESCARTADAS';
  const fw = ev.filter((e) => e.kind === 'forward');
  if (fw.length) return `FORWARDING DE ${[...new Set(fw.map((f) => 'x' + f.reg))].join(' E ')} PARA A ALU`;
  if (model === 'single') return 'INSTRUÇÃO CONCLUÍDA EM 1 CICLO';
  const holes = (['ID', 'EX', 'MEM', 'WB'] as StageName[]).filter((s) => !rep.stages[s]);
  if (holes.length && rep.cycle > 4) return `BOLHA EM ${holes.join(', ')}: EFEITO DE UM STALL, FLUSH OU FALTA DE CACHE ANTERIOR`;
  if (holes.length) return 'PIPELINE ENCHENDO';
  return 'PIPELINE CHEIO, SEM CONFLITOS';
}

function statusFor(rep: CycleReport | undefined): string {
  if (!session) return 'ERRO';
  if (session.done) return 'FIM';
  if (running) return 'RODANDO';
  if (!rep) return 'PRONTO';
  if (rep.events.some((e) => e.kind === 'stall')) return 'STALL';
  if (Object.values(rep.stages).some((x) => x?.status === 'miss')) return 'MISS';
  if (rep.events.some((e) => e.kind === 'flush')) return 'FLUSH';
  return 'PAUSADO';
}

function render() {
  const rep = session?.lastReport;
  board.render(rep);
  $('st-cycle').textContent = String(session?.cycle ?? 0);
  $('st-status').textContent = statusFor(rep);
  const st = session?.machine.stats;
  $('st-cpi').textContent = st && st.retired ? (st.cycles / st.retired).toFixed(2) : '—';
  setTip(tipFor(rep));
  renderEvents(rep);
  renderBackdrop(rep);
  renderDiagram();
  renderRegs();
  renderMem();
  datapath.render(rep);
  renderCaches(rep);
  refreshControls();
}

const KIND_LABEL: Record<string, string> = {
  stall: 'STALL', forward: 'FWD', flush: 'FLUSH', retire: 'OK', halt: 'FIM', load: 'LOAD', store: 'STORE', branch: 'DESVIO', cache: 'CACHE',
};

function renderEvents(rep: CycleReport | undefined) {
  const ul = $('events');
  ul.replaceChildren();
  $('events-title').textContent = rep ? `O que aconteceu no ciclo ${rep.cycle}` : 'O que aconteceu';
  if (!rep) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Nada ainda. Aperte Passo para avançar um ciclo.';
    ul.appendChild(li);
    return;
  }
  if (!rep.events.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = model === 'single'
      ? 'Instrução executada do começo ao fim neste ciclo.'
      : 'Fluxo normal: cada estágio passou sua instrução adiante.';
    ul.appendChild(li);
  }
  for (const e of rep.events) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="kind k-${e.kind}">${KIND_LABEL[e.kind]}</span>`;
    li.appendChild(document.createTextNode(e.message));
    ul.appendChild(li);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

/** Destaca no editor as linhas que estão em cada estágio. */
function renderBackdrop(rep: CycleReport | undefined) {
  const code = $<HTMLTextAreaElement>('code').value;
  const lines = code.split('\n');
  const tags = new Map<number, string[]>();
  if (session && rep) {
    const stages = model === 'single' ? (['EX'] as StageName[]) : STAGES;
    for (const s of stages) {
      const slot = rep.stages[s];
      if (!slot) continue;
      const line = session.program.lineOf.get(slot.pc);
      if (line === undefined) continue;
      const label = model === 'single' ? 'EXEC' : s + (slot.status === 'stall' ? '·STALL' : slot.status === 'squash' ? '·FLUSH' : slot.status === 'miss' ? '·MISS' : '');
      tags.set(line, [...(tags.get(line) ?? []), label]);
    }
  }
  const html = lines
    .map((l, i) => {
      const t = tags.get(i + 1);
      const text = escapeHtml(l) || ' ';
      if (!t) return `<span class="ln">${text}</span>`;
      const cls = t.some((x) => x.includes('STALL') || x.includes('MISS')) ? 'hl stall' : t.some((x) => x.includes('FLUSH')) ? 'hl squash' : 'hl';
      return `<span class="ln ${cls}">${text}<i class="stag">${t.join(' ')}</i></span>`;
    })
    .join('\n');
  $('backdrop').innerHTML = html + '\n';
  syncScroll();
}

function syncScroll() {
  const ta = $<HTMLTextAreaElement>('code');
  const bd = $('backdrop');
  bd.scrollTop = ta.scrollTop;
  bd.scrollLeft = ta.scrollLeft;
}

const STAGE_SHORT: Record<StageName, string> = { IF: 'IF', ID: 'ID', EX: 'EX', MEM: 'MEM', WB: 'WB' };

function renderDiagram() {
  const host = $('diagram');
  host.replaceChildren();
  if (!session || !session.trace.length) {
    host.innerHTML = '<p class="muted">O diagrama aparece quando a execução começa.</p>';
    return;
  }
  const trace = session.trace;
  const WINDOW = 22;
  const first = Math.max(0, trace.length - WINDOW);
  const cycles = trace.slice(first);
  const rows = new Map<number, { text: string; cells: Map<number, { st: StageName; status: string }> }>();
  cycles.forEach((rep) => {
    const stages = model === 'single' ? (['EX'] as StageName[]) : STAGES;
    for (const s of stages) {
      const slot = rep.stages[s];
      if (!slot) continue;
      if (!rows.has(slot.seq)) rows.set(slot.seq, { text: slot.text.replace(/\s+#.*$/, ''), cells: new Map() });
      rows.get(slot.seq)!.cells.set(rep.cycle, { st: model === 'single' ? 'EX' : s, status: slot.status });
    }
  });
  const seqs = [...rows.keys()].sort((a, b) => a - b).slice(-14);
  const table = document.createElement('table');
  const head = document.createElement('tr');
  head.innerHTML = '<th class="itext">instrução</th>' + cycles.map((c, i) => `<th class="${i === cycles.length - 1 ? 'now' : ''}">${c.cycle}</th>`).join('');
  table.appendChild(head);
  for (const seq of seqs) {
    const r = rows.get(seq)!;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="itext">${escapeHtml(r.text)}</td>` + cycles
      .map((c, i) => {
        const cell = r.cells.get(c.cycle);
        const now = i === cycles.length - 1 ? ' now' : '';
        if (!cell) return `<td class="empty${now}"></td>`;
        const label = model === 'single' ? '●' : cell.status === 'miss' ? '$' : STAGE_SHORT[cell.st];
        return `<td class="cell s-${cell.status}${now}">${label}</td>`;
      })
      .join('');
    table.appendChild(tr);
  }
  host.appendChild(table);
  host.scrollLeft = host.scrollWidth;
}

let showHex = false;
function renderRegs() {
  const host = $('regs');
  host.replaceChildren();
  const regs = session?.machine.regs ?? new Int32Array(32);
  for (let i = 0; i < 32; i++) {
    const d = document.createElement('div');
    const changed = session && session.cycle > 0 && regs[i] !== prevRegs[i];
    d.className = 'reg' + (changed ? ' changed' : '') + (regs[i] === 0 ? ' zero' : '');
    const v = showHex ? '0x' + (regs[i] >>> 0).toString(16).padStart(8, '0') : String(regs[i]);
    d.innerHTML = `<span class="rn">x${i}</span><span class="ra">${ABI_NAMES[i]}</span><span class="rv">${v}</span>`;
    d.onclick = () => {
      showHex = !showHex;
      renderRegs();
    };
    host.appendChild(d);
  }
}

function renderMem() {
  const host = $('mem');
  host.replaceChildren();
  if (!session) return;
  const names = new Map<number, string>();
  for (const [k, v] of session.program.labels) if (v >= DATA_BASE) names.set(v, k);
  const words = Math.max(4, Math.min(24, Math.ceil(session.program.data.length / 4)));
  const written = new Set(session.lastWrites.map((a) => a & ~3));
  for (let i = 0; i < words; i++) {
    const a = DATA_BASE + i * 4;
    const d = document.createElement('div');
    d.className = 'mrow' + (written.has(a) ? ' changed' : '');
    d.innerHTML = `<span class="ma">0x${a.toString(16)}</span><span class="ml">${names.get(a) ?? ''}</span><span class="mv">${session.mem.read32(a)}</span>`;
    host.appendChild(d);
  }
}

function compare(src: string) {
  const host = $('compare');
  host.replaceChildren();
  const configs: Array<[string, ModelKind, boolean, CacheSetup | null]> = [
    ['Monociclo', 'single', true, null],
    ['Pipeline sem fwd', 'pipeline', false, null],
    ['Pipeline com fwd', 'pipeline', true, null],
  ];
  const cs = cacheSetup() ?? { i: { ...cacheCfg }, d: { ...cacheCfg } };
  configs.push(['Pipeline com fwd + caches', 'pipeline', true, cs]);
  const results = configs.map(([name, m, f, c]) => {
    const s = new Session(src, { model: m, forwarding: f, caches: c });
    s.run(50000);
    return { name, ...s.machine.stats, done: s.done };
  });
  const max = Math.max(...results.map((r) => r.cycles));
  for (const r of results) {
    const d = document.createElement('div');
    d.className = 'cmp';
    const cpi = r.retired ? (r.cycles / r.retired).toFixed(2) : '—';
    d.innerHTML = `<div class="cmp-head"><span>${r.name}</span><b>${r.cycles} ciclos</b></div>
      <div class="bar"><i style="width:${(100 * r.cycles) / max}%"></i></div>
      <div class="cmp-foot">CPI ${cpi} · bolhas ${r.stalls} · flush ${r.flushes} · fwd ${r.forwards}${r.cacheStalls ? ` · espera de cache ${r.cacheStalls}` : ''}${r.done ? '' : ' · não terminou'}</div>`;
    host.appendChild(d);
  }
  const note = document.createElement('p');
  note.className = 'muted small';
  note.textContent = `Ciclos não são tempo: o ciclo do monociclo é ~5× mais longo que o de um estágio do pipeline. A última linha usa caches ${geom(cs.d)} com falta de ${cs.d.missPenalty} ciclos.`;
  host.appendChild(note);
}

function syncCacheForm() {
  for (const k of ['sets', 'ways', 'blockBytes', 'missPenalty'] as const) $<HTMLSelectElement>('cc-' + k).value = String(cacheCfg[k]);
}

function renderCaches(rep: CycleReport | undefined) {
  const host = $('caches');
  host.replaceChildren();
  $('caches-note').textContent = cachesOn
    ? `Cada cache: ${geom(cacheCfg)}. Write-back com write-allocate, substituição LRU. Falta = ${cacheCfg.missPenalty} ciclos (o dobro se expulsar um bloco sujo).`
    : 'Caches desligadas: IF e MEM acessam a memória direto, sem espera. Ligue em "Cache" ou mude a geometria abaixo.';
  if (!session || !session.machine.icache || !session.machine.dcache) return;
  const states = { i: rep?.dp?.icache ?? null, d: rep?.dp?.mem?.cache ?? null };
  for (const [key, c] of [['i', session.machine.icache], ['d', session.machine.dcache]] as const) {
    host.appendChild(cacheTable(c, key === 'i' ? 'I-cache · instruções' : 'D-cache · dados', key === 'd', states[key]));
  }
}

function cacheTable(c: Cache, title: string, data: boolean, state: 'hit' | 'miss' | 'wait' | null) {
  const box = document.createElement('div');
  box.className = 'cache-box';
  const st = c.stats;
  const missRate = st.accesses ? st.misses / st.accesses : 0;
  const amat = 1 + missRate * c.config.missPenalty;
  box.innerHTML = `<div class="cache-head"><b>${title}</b><span>${st.accesses ? (hitRate(st) * 100).toFixed(1) + '% de acerto' : 'sem acessos'}</span></div>
    <div class="cache-stats">acessos ${st.accesses} · acertos ${st.hits} · faltas ${st.misses} · write-backs ${st.writebacks}<br>
    AMAT = 1 + ${(missRate * 100).toFixed(1)}% × ${c.config.missPenalty} = <b>${amat.toFixed(2)} ciclos</b></div>
    <div class="cache-split">endereço = tag | índice (${c.indexBits} bits) | deslocamento (${c.offsetBits} bits)</div>`;
  const table = document.createElement('table');
  table.className = 'ctable';
  const words = c.config.blockBytes / 4;
  table.innerHTML = `<tr><th>conj</th><th>via</th><th>V</th><th>D</th><th>tag</th><th>bloco</th><th>conteúdo (${words} palavra${words > 1 ? 's' : ''})</th></tr>`;
  const last = state && c.last ? c.last : null;
  c.lines.forEach((row, set) => {
    row.forEach((l, way) => {
      const tr = document.createElement('tr');
      const isLast = last && last.set === set && last.way === way;
      tr.className = (l.valid ? '' : 'invalid') + (isLast ? ` last ${state}` : '');
      let content = '—';
      let addr = '';
      if (l.valid && session) {
        const base = c.blockAddr(set, l.tag);
        addr = '0x' + base.toString(16);
        const vals = Array.from({ length: words }, (_, k) => session!.mem.read32(base + 4 * k));
        content = vals.map((v, k) => {
          const hl = isLast && (last!.offset >> 2) === k ? ' class="w"' : '';
          return `<span${hl}>${data ? v : '0x' + (v >>> 0).toString(16).padStart(8, '0')}</span>`;
        }).join(' ');
      }
      tr.innerHTML = `<td>${way === 0 ? set : ''}</td><td>${way}</td><td>${l.valid ? 1 : 0}</td><td>${l.dirty ? 1 : 0}</td><td>${l.valid ? '0x' + l.tag.toString(16) : '—'}</td><td>${addr || '—'}</td><td class="cw">${content}</td>`;
      table.appendChild(tr);
    });
  });
  box.appendChild(table);
  return box;
}

function refreshControls() {
  document.querySelectorAll<HTMLButtonElement>('[data-model]').forEach((b) => b.classList.toggle('on', b.dataset.model === model));
  const fwd = $<HTMLButtonElement>('fwd');
  fwd.textContent = forwarding ? 'On' : 'Off';
  fwd.classList.toggle('on', forwarding);
  fwd.disabled = model === 'single';
  const cb = $<HTMLButtonElement>('cache');
  cb.textContent = cachesOn ? 'On' : 'Off';
  cb.classList.toggle('on', cachesOn);
  const runBtn = document.querySelector<HTMLButtonElement>('[data-act="run"]')!;
  runBtn.textContent = running ? 'Pausar ❚❚' : 'Rodar ▸';
  runBtn.classList.toggle('on', !!running);
  document.querySelector<HTMLButtonElement>('[data-act="back"]')!.disabled = !session?.canStepBack();
  const done = !session || session.done;
  for (const a of ['step', 'run', 'end']) document.querySelector<HTMLButtonElement>(`[data-act="${a}"]`)!.disabled = done && !(a === 'run' && running);
  document.querySelector<HTMLButtonElement>('[data-act="explode"]')!.classList.toggle('on', exploded);
  $('st-status').textContent = statusFor(session?.lastReport);
}

// ---------------- aparência ----------------
function setAccent(v: string) {
  document.documentElement.style.setProperty('--accent', v);
  store.set('accent', v);
  document.querySelectorAll<HTMLButtonElement>('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
}

function buildSwatches() {
  const host = $('swatches');
  for (const a of ACCENTS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.v = a.v;
    b.style.background = a.v;
    b.title = a.name;
    b.setAttribute('aria-label', `cor ${a.name}`);
    b.onclick = () => setAccent(a.v);
    host.appendChild(b);
  }
}

// ---------------- eventos ----------------
document.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
  b.addEventListener('click', () => {
    switch (b.dataset.act) {
      case 'step': stop(); step(); break;
      case 'back': back(); break;
      case 'run': run(); break;
      case 'end': toEnd(); break;
      case 'reset': assembleAndReset(); break;
      case 'assemble': assembleAndReset(); break;
      case 'explode':
        exploded = !exploded;
        board.setOptions({ exploded });
        render();
        break;
    }
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-model]').forEach((b) => {
  b.onclick = () => {
    model = b.dataset.model as ModelKind;
    assembleAndReset();
  };
});
$('fwd').onclick = () => {
  forwarding = !forwarding;
  assembleAndReset();
};
$('cache').onclick = () => {
  cachesOn = !cachesOn;
  assembleAndReset();
};
for (const k of ['sets', 'ways', 'blockBytes', 'missPenalty'] as const) {
  $<HTMLSelectElement>('cc-' + k).onchange = (e) => {
    cacheCfg = { ...cacheCfg, [k]: Number((e.target as HTMLSelectElement).value) };
    cachesOn = true;
    assembleAndReset();
  };
}
$('labels').onclick = () => {
  labels = !labels;
  $('labels').textContent = labels ? 'On' : 'Off';
  $('labels').classList.toggle('on', labels);
  board.setOptions({ labels });
};
const wobble = $<HTMLInputElement>('wobble-range');
wobble.oninput = () => {
  board.setWobble(Number(wobble.value));
  store.set('wobble', wobble.value);
};
$<HTMLInputElement>('speed').oninput = () => {
  if (running) {
    stop();
    run();
  }
};

const code = $<HTMLTextAreaElement>('code');
code.addEventListener('scroll', syncScroll);
code.addEventListener('input', () => {
  renderBackdrop(undefined);
  $('asm-msg').textContent = 'código alterado: aperte Montar';
  $('asm-msg').className = 'asm-msg';
});
code.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    assembleAndReset();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const s = code.selectionStart;
    code.setRangeText('        ', s, code.selectionEnd, 'end');
  }
});

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight') { stop(); step(); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { back(); e.preventDefault(); }
  else if (e.key === ' ') { run(); e.preventDefault(); }
  else if (e.key.toLowerCase() === 'e') document.querySelector<HTMLButtonElement>('[data-act="explode"]')!.click();
});

// ---------------- início ----------------
buildSwatches();
setAccent(store.get('accent') ?? '#6D93D9');
const w = store.get('wobble');
if (w) {
  wobble.value = w;
  board.setWobble(Number(w));
}
selectFigure(FIGURES[0]);
