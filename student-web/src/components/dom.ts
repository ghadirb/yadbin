export type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}
export const clear = (root: HTMLElement) => { root.replaceChildren(); };
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export function bigButton(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return h('button', { class: `btn ${cls}`.trim(), type: 'button', onclick: onClick }, text);
}
export const waitForClick = (btn: HTMLElement) => new Promise<void>((r) => btn.addEventListener('click', () => r(), { once: true }));
export function progress(index: number, total: number): HTMLElement {
  const dots = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': index });
  for (let i = 0; i < total; i++) dots.append(h('span', { class: `dot${i < index ? ' done' : i === index ? ' now' : ''}` }));
  return dots;
}
export async function feedback(root: HTMLElement, ok: boolean, ms = 1100): Promise<void> {
  const el = h('div', { class: `feedback ${ok ? 'ok' : 'retry'}`, role: 'status', 'aria-live': 'polite' }, ok ? 'عالی! ✨' : 'دوباره امتحان کن.');
  root.append(el); await sleep(ms); el.remove();
}
