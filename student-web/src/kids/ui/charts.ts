import { h } from '../../components/dom';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>, ...kids: (Element | string)[]) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); for (const k of kids) e.append(k); return e; };
export interface Pt { day: string; value: number }
const dayFa = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Accessible SVG line chart: a text summary is always present (not colour-only); empty data says so honestly. */
export function lineChart(points: Pt[], opts: { title: string; w?: number; hgt?: number; compact?: boolean } = { title: '' }): HTMLElement {
  const w = opts.w ?? 320, hg = opts.hgt ?? (opts.compact ? 70 : 150), pad = opts.compact ? 6 : 22;
  if (points.length < 2) return h('div', { class: 'chart empty', role: 'img', 'aria-label': `${opts.title}: هنوز داده کافی نیست` }, h('small', {}, 'با چند بازی دیگر نمودار ساخته می‌شود.'));
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1), y = (v: number) => hg - pad - (Math.max(0, Math.min(100, v)) / 100) * (hg - 2 * pad);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const first = points[0], last = points[points.length - 1];
  const el = svg('svg', { viewBox: `0 0 ${w} ${hg}`, class: 'chart-svg', role: 'img', 'aria-label': `${opts.title}: از ${first.value} به ${last.value} در ${points.length} روز فعال` });
  if (!opts.compact) for (const g of [0, 50, 100]) el.append(svg('line', { x1: pad, x2: w - pad, y1: y(g), y2: y(g), class: 'grid-line' }), svg('text', { x: 2, y: y(g) + 4, class: 'axis' }, String(g)));
  el.append(svg('path', { d, class: 'line', fill: 'none' }));
  points.forEach((p, i) => { if (!opts.compact || i === points.length - 1) el.append(svg('circle', { cx: x(i), cy: y(p.value), r: opts.compact ? 3 : 4, class: 'dot-pt' })); });
  if (!opts.compact) { el.append(svg('text', { x: pad, y: hg - 4, class: 'axis' }, dayFa(first.day)), svg('text', { x: w - pad, y: hg - 4, class: 'axis end', 'text-anchor': 'end' }, dayFa(last.day))); }
  return h('div', { class: 'chart' }, el as unknown as Node);
}

export function barRow(label: string, value: number, max: number, text: string): HTMLElement {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return h('div', { class: 'barrow' }, h('span', {}, label), h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${label} ${text}` }, h('span', { style: `width:${pct}%` })), h('strong', {}, text));
}
