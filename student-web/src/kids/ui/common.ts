import { h } from '../../components/dom';

export interface Settings { sound: boolean; reduceMotion: boolean }
export const defaultSettings = (): Settings => ({ sound: true, reduceMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches });

/** Optional, tiny WebAudio beeps (no asset files). Always silent when the child / parent turned sound off. */
export class Sound {
  private ctx: AudioContext | null = null;
  constructor(public enabled = true) {}
  private beep(freq: number, ms: number, type: OscillatorType = 'sine', gain = 0.06) {
    if (!this.enabled || typeof AudioContext === 'undefined') return;
    try {
      this.ctx ??= new AudioContext(); const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = gain; o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + ms / 1000);
    } catch { /* audio is optional */ }
  }
  good() { this.beep(660, 120); setTimeout(() => this.beep(880, 140), 110); }
  soft() { this.beep(300, 160, 'triangle', 0.04); }   // a gentle "try again", never a buzzer
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f, 160), i * 120)); }
}

export interface PlayCtx { speed: number; sound: Sound; reduceMotion: boolean; now: () => number }
export const defaultCtx = (s: Settings): PlayCtx => ({ speed: 1, sound: new Sound(s.sound), reduceMotion: s.reduceMotion, now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) });
export const wait = (ctx: PlayCtx, ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms * ctx.speed)));
export const fa = (n: number | string) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

/** Big, labelled touch target (≥64px) — no dependence on keyboard or colour. */
export const tile = (label: string, aria: string, cls = '', onClick?: (e: Event) => void) => h('button', { class: `tile ${cls}`.trim(), type: 'button', 'aria-label': aria, onclick: onClick }, label);
export const stars = (n: number, total = 3) => '⭐'.repeat(n) + '☆'.repeat(Math.max(0, total - n));
