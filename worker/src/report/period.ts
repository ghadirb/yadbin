/**
 * Report periods and the Iranian academic year (سال تحصیلی). Pure functions, no DB.
 *
 * Academic year N–(N+1) runs from 1 Mehr N to the last day of Shahrivar N+1 (Tehran local time).
 * Stored timestamps stay UTC ISO; only the window edges are computed from Iranian local midnight (UTC+03:30, same as growth/compute.ts).
 */
import { TEHRAN_OFFSET_MIN, toFa } from '../growth/compute';

const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.floor(a / b) * b;
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy: number, withoutLeap = false) {
  let gy = jy + 621, leapJ = -14, jp = BREAKS[0], jump = 0;
  if (jy < jp || jy >= BREAKS[BREAKS.length - 1]) throw new RangeError('Invalid Jalali year');
  for (let i = 1; i < BREAKS.length; i++) {
    const jm = BREAKS[i]; jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (withoutLeap) return { gy, march, leap: 0 };
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function g2d(gy: number, gm: number, gd: number) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1, gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
export function jalaliToGregorian(jy: number, jm: number, jd: number) {
  const r = jalCal(jy, true);
  return d2g(g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1);
}
export function gregorianToJalali(gy: number, gm: number, gd: number) {
  const jdn = g2d(gy, gm, gd);
  let jy = d2g(jdn).gy - 621;
  const r = jalCal(jy), jdn1f = g2d(r.gy, 3, r.march);
  let k = jdn - jdn1f, jm: number, jd: number;
  if (k >= 0) {
    if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy, jm, jd }; }
    k -= 186;
  } else { jy -= 1; k += 179; if (r.leap === 1) k += 1; }
  jm = 7 + div(k, 30); jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

/** UTC instant of Iranian-local midnight at the start of a Gregorian calendar day. */
const tehranMidnightUtc = (gy: number, gm: number, gd: number) => new Date(Date.UTC(gy, gm - 1, gd) - TEHRAN_OFFSET_MIN * 60_000);
const jalaliStartUtc = (jy: number, jm: number, jd: number) => { const g = jalaliToGregorian(jy, jm, jd); return tehranMidnightUtc(g.gy, g.gm, g.gd); };
const pad2 = (n: number) => String(n).padStart(2, '0');
/** ISO instant → Iranian-local Jalali date as «۱۴۰۵/۰۷/۰۱». */
export function jalaliText(iso: string | Date): string {
  const t = (iso instanceof Date ? iso.getTime() : Date.parse(iso)) + TEHRAN_OFFSET_MIN * 60_000;
  const d = new Date(t);
  const j = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return toFa(`${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`);
}
export const jalaliYearOf = (at: Date) => { const d = new Date(at.getTime() + TEHRAN_OFFSET_MIN * 60_000); return gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };

export interface AcademicYear { startYear: number; label: string; from: string; to: string }
/** Academic year that STARTS in Jalali year `startYear`. `to` is exclusive (= 1 Mehr of the next year). */
export function academicYear(startYear: number): AcademicYear {
  return { startYear, label: toFa(`${startYear}–${startYear + 1}`), from: jalaliStartUtc(startYear, 7, 1).toISOString(), to: jalaliStartUtc(startYear + 1, 7, 1).toISOString() };
}
/** The academic year that contains `at` (from 1 Mehr on, the year that starts that Jalali year; before it, the one that started the year before). */
export function academicYearAt(at: Date): AcademicYear {
  const j = jalaliYearOf(at);
  return academicYear(j.jm >= 7 ? j.jy : j.jy - 1);
}

export const PERIOD_KEYS = ['7d', '30d', '3m', '6m', 'year_current', 'year_previous', 'year', 'custom'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const PERIOD_LABELS_FA: Record<'7d' | '30d' | '3m' | '6m', string> = { '7d': '۷ روز اخیر', '30d': '۳۰ روز اخیر', '3m': '۳ ماه اخیر', '6m': '۶ ماه اخیر' };
const RELATIVE_DAYS = { '7d': 7, '30d': 30, '3m': 90, '6m': 180 } as const;

export interface PeriodInput { period: PeriodKey; from?: string; to?: string; year?: number }
export interface ResolvedPeriod {
  key: PeriodKey; label: string;
  /** Inclusive start / exclusive end, both UTC ISO. `to` never exceeds `now`. */
  from: string; to: string;
  /** Display range (Jalali, both inclusive). */
  fromJalali: string; toJalali: string;
  academicYear: string | null; academicYearStart: number | null; days: number;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
function parseLocalDay(s: string): Date | null {
  const m = YMD.exec(s); if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const chk = new Date(Date.UTC(y, mo - 1, d));
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  return tehranMidnightUtc(y, mo, d);
}
export class PeriodError extends Error {}
export const MAX_CUSTOM_DAYS = 800;

export function resolvePeriod(inp: PeriodInput, now: Date = new Date()): ResolvedPeriod {
  let from: Date, endExclusive: Date, label: string, ay: AcademicYear | null = null;
  if (inp.period === '7d' || inp.period === '30d' || inp.period === '3m' || inp.period === '6m') {
    endExclusive = now; from = new Date(now.getTime() - RELATIVE_DAYS[inp.period] * 86_400_000); label = PERIOD_LABELS_FA[inp.period];
  } else if (inp.period === 'custom') {
    const f = inp.from ? parseLocalDay(inp.from) : null, t = inp.to ? parseLocalDay(inp.to) : null;
    if (!f || !t) throw new PeriodError('تاریخ شروع و پایان بازهٔ سفارشی معتبر نیست.');
    if (t.getTime() < f.getTime()) throw new PeriodError('تاریخ پایان باید بعد از تاریخ شروع باشد.');
    endExclusive = new Date(t.getTime() + 86_400_000); from = f;
    if ((endExclusive.getTime() - from.getTime()) / 86_400_000 > MAX_CUSTOM_DAYS) throw new PeriodError('بازهٔ سفارشی نباید بیش از ۸۰۰ روز باشد.');
    label = 'بازهٔ سفارشی';
  } else {
    const cur = academicYearAt(now);
    const start = inp.period === 'year_current' ? cur.startYear : inp.period === 'year_previous' ? cur.startYear - 1 : inp.year;
    if (start === undefined || !Number.isInteger(start) || start < 1380 || start > cur.startYear) throw new PeriodError('سال تحصیلی معتبر نیست.');
    ay = academicYear(start); from = new Date(ay.from); endExclusive = new Date(ay.to); label = `سال تحصیلی ${ay.label}`;
  }
  // The window never reaches into the future; the printed Jalali range still shows the requested edge.
  const effectiveTo = new Date(Math.min(endExclusive.getTime(), now.getTime()));
  const lastDay = new Date(endExclusive.getTime() - 1);
  const days = Math.max(1, Math.ceil((effectiveTo.getTime() - from.getTime()) / 86_400_000));
  return {
    key: inp.period, label, from: from.toISOString(), to: effectiveTo.toISOString(),
    fromJalali: jalaliText(from), toJalali: jalaliText(inp.period === 'custom' || ay ? lastDay : effectiveTo),
    academicYear: ay?.label ?? null, academicYearStart: ay?.startYear ?? null, days,
  };
}

/** Bucket for a report window: ≤ 31 days → daily, up to ~60 weeks → weekly, longer → 4-week blocks (same rule as growth). */
export function bucketForDays(days: number): 'day' | 'week' | 'four_weeks' { return days <= 31 ? 'day' : days / 7 > 60 ? 'four_weeks' : 'week'; }
