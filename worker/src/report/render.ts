/**
 * Print-ready HTML (A4, RTL, Persian) for the student report. Built from the structured StudentReport only — no new numbers are computed here.
 * Charts are inline SVG (no external script, font or image), so it works offline inside the Android WebView and prints/saves as PDF through the system.
 * See docs/student-reports.md.
 */
import { toFa } from '../growth/compute';
import { gregorianToJalali, jalaliText } from './period';
import type { StudentReport } from './service';

export const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fa = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : toFa(Number.isInteger(n) ? n.toFixed(0) : n.toFixed(d).replace('.', '٫')));
const faPct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${fa(n)}٪`);
const MISSING = 'داده کافی برای این شاخص ثبت نشده است.';

/** Safe filename: yadbin-student-report-{studentId}-{academicYear|from_to}.pdf (ASCII only). */
export function reportFileName(r: StudentReport): string {
  const sid = String(r.student.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'student';
  const yr = r.period.academicYear ? String(r.period.academicYear).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace('–', '-') : `${r.period.from.slice(0, 10)}_${r.period.to.slice(0, 10)}`;
  return `yadbin-student-report-${sid}-${yr}${r.type === 'summary' ? '-summary' : ''}.pdf`;
}

function shortLabel(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) { const j = gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3])); return toFa(`${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`); }
  return jalaliText(s).slice(5);
}

interface P { label: string; value: number }
/** Line chart 0–100. RTL: oldest point on the right. Only real points are drawn; with < 2 points nothing is drawn. */
function lineChart(points: P[], title: string, color = '#1f6feb', w = 680, h = 230): string {
  if (points.length < 2) return '';
  const L = 16, R = 42, T = 14, B = 34, iw = w - L - R, ih = h - T - B; // value axis on the right: time starts at the right in RTL
  const x = (i: number) => w - R - (i / (points.length - 1)) * iw; // RTL
  const y = (v: number) => T + (1 - Math.max(0, Math.min(100, v)) / 100) * ih;
  const grid = [0, 25, 50, 75, 100].map((g) => `<line x1="${L}" x2="${w - R}" y1="${y(g)}" y2="${y(g)}" stroke="#d0d7de" stroke-width="1"/><text x="${w - R + 6}" y="${y(g) + 4}" text-anchor="start" font-size="10" fill="#57606a">${toFa(g)}</text>`).join('');
  const step = Math.max(1, Math.ceil(points.length / 8));
  const xl = points.map((p, i) => (i % step === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${h - 12}" text-anchor="middle" font-size="9.5" fill="#57606a">${esc(p.label)}</text>` : '')).join('');
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.6" fill="${color}" stroke="#fff" stroke-width="1.2"/>`).join('');
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption><svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(title)}" direction="ltr">${grid}${xl}<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>${dots}</svg></figure>`;
}

const trendBadge = (label: string, dir: string) => `<span class="badge t-${esc(dir)}">${esc(label)}</span>`;
const empty = (msg: string) => `<p class="empty">${esc(msg)}</p>`;
const card = (k: string, v: string, sub = '') => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${v}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`;

const CSS = `
@page { size: A4; margin: 16mm 14mm 20mm 14mm; @bottom-center { content: "صفحه " counter(page) " از " counter(pages); font: 9pt "Vazirmatn","Noto Naskh Arabic","Noto Sans Arabic",Tahoma,sans-serif; color: #57606a; } }
* { box-sizing: border-box; }
html { direction: rtl; }
body { margin: 0; font: 11pt/1.8 "Vazirmatn","Noto Naskh Arabic","Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif; color: #1f2328; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 19pt; margin: 0 0 4px; } h2 { font-size: 14pt; margin: 0 0 8px; border-inline-start: 5px solid #1f6feb; padding-inline-start: 8px; } h3 { font-size: 11.5pt; margin: 12px 0 4px; }
.page { break-after: page; page-break-after: always; } .page:last-of-type { break-after: auto; page-break-after: auto; }
.meta { width: 100%; border-collapse: collapse; margin: 10px 0; } .meta td { padding: 6px 8px; border-bottom: 1px solid #d8dee4; } .meta td:first-child { color: #57606a; width: 30%; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
.card { border: 1px solid #d0d7de; border-radius: 8px; padding: 8px 10px; break-inside: avoid; page-break-inside: avoid; } .card .k { font-size: 9.5pt; color: #57606a; } .card .v { font-size: 15pt; font-weight: 700; } .card .s { font-size: 9pt; color: #57606a; }
table.grid { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 10pt; } table.grid th { background: #eef2f6; text-align: right; } table.grid th, table.grid td { border: 1px solid #d0d7de; padding: 4px 7px; }
tr, figure, .skill, .card, .note { break-inside: avoid; page-break-inside: avoid; } thead { display: table-header-group; }
.chart { margin: 6px 0 10px; } .chart figcaption { font-size: 10pt; color: #57606a; margin-bottom: 2px; }
.skill { border: 1px solid #d0d7de; border-radius: 8px; padding: 8px 10px; margin: 8px 0; }
.badge { display: inline-block; border-radius: 10px; padding: 0 8px; font-size: 9.5pt; background: #eef2f6; } .t-up { background: #dafbe1; } .t-down { background: #ffebe9; } .t-fluctuating { background: #fff8c5; } .t-stable { background: #ddf4ff; }
.empty { color: #57606a; background: #f6f8fa; border: 1px dashed #d0d7de; border-radius: 8px; padding: 8px 10px; }
.note { font-size: 9.5pt; color: #57606a; } .disclaimer { border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 8px; padding: 8px 12px; font-size: 10pt; margin-top: 14px; }
.toolbar { position: sticky; top: 0; background: #1f6feb; padding: 8px; text-align: center; } .toolbar button { font: inherit; padding: 6px 16px; margin: 0 6px; border-radius: 6px; border: 0; cursor: pointer; }
@media print { .toolbar { display: none; } body { font-size: 10.5pt; } }
@media screen { .sheet { max-width: 794px; margin: 0 auto; padding: 16px; } }`;

function section(inner: string) { return `<section class="page">${inner}</section>`; }

export function renderReportHtml(r: StudentReport, opts: { toolbar?: boolean } = {}): string {
  const full = r.type === 'full';
  const o = r.overview;
  const idPage = `<h1>${esc(r.period.title)}</h1>
    <table class="meta">
      <tr><td>نام دانش‌آموز</td><td>${esc(r.student.name)}</td></tr>
      <tr><td>کلاس</td><td>${esc(r.student.className ?? '—')}</td></tr>
      <tr><td>پایه</td><td>${esc(r.student.gradeLabel ?? '—')}</td></tr>
      <tr><td>سال تحصیلی</td><td>${esc(r.student.academicYear)}</td></tr>
      <tr><td>بازهٔ گزارش</td><td>${esc(r.period.label)}: از ${esc(r.period.fromJalali)} تا ${esc(r.period.toJalali)}</td></tr>
      <tr><td>نوع گزارش</td><td>${full ? 'گزارش کامل' : 'گزارش خلاصه'}</td></tr>
      <tr><td>تاریخ تولید گزارش</td><td>${esc(r.metadata.generatedAtJalali)}</td></tr>
    </table>
    <h2>خلاصهٔ عملکرد</h2>
    <div class="cards">
      ${card('فعالیت‌های شناختی انجام‌شده', fa(o.activityCount))}
      ${card('آزمون‌های درسی انجام‌شده', fa(o.assessmentCount))}
      ${card('میانگین عملکرد فعالیت‌ها', o.cognitiveAverage === null ? '—' : faPct(o.cognitiveAverage), o.cognitiveAverage === null ? MISSING : '')}
      ${card('آخرین عملکرد ثبت‌شده', o.lastPerformance === null ? '—' : faPct(o.lastPerformance), o.lastPerformance === null ? 'هنوز فعالیتی ثبت نشده است.' : '')}
      ${card('تغییر نسبت به ابتدای بازه', o.startVsCurrent ? esc(o.startVsCurrentLabel ?? '') : '—', o.startVsCurrent ? `${faPct(o.startVsCurrent.startPercent)} ← ${faPct(o.startVsCurrent.currentPercent)}` : 'برای محاسبه حداقل ۳ نتیجه لازم است.')}
      ${card('روزهای فعال', fa(o.activeDays))}
      ${card('آخرین فعالیت', o.lastActivityJalali ? esc(o.lastActivityJalali) : '—', o.lastActivityJalali ? '' : 'فعالیتی ثبت نشده است.')}
    </div>`;

  const tl = r.cognitiveGrowth.timeline;
  const growth = `<h2>نمودار رشد کلی (فعالیت‌های شناختی)</h2>${tl.available
    ? `${trendBadge(tl.trend.label, tl.trend.direction)} <span class="note">هر نقطه میانگین وزن‌دار یک ${tl.bucket === 'day' ? 'روز' : tl.bucket === 'week' ? 'هفته' : 'بلوک چهارهفته‌ای'} است؛ محور افقی: زمان (شمسی)، محور عمودی: عملکرد (٪).</span>${lineChart(tl.points.map((p) => ({ label: shortLabel(p.bucketStart), value: p.percent })), 'عملکرد شناختی در طول زمان')}`
    : empty(tl.message ?? 'هنوز داده کافی برای نمایش روند رشد ثبت نشده است.')}`;

  const rc = r.skillTrends.responseControl, lr = r.skillTrends.learning;
  const skillBlocks = r.skillTrends.skills.map((s) => `<div class="skill"><h3>${esc(s.skill)} ${trendBadge(s.trend.label, s.trend.direction)}</h3>
      <div class="note">${fa(s.results)} نتیجه • ${fa(s.samples)} پاسخ${s.sufficient ? ` • شروع ${faPct(s.start)} ← اکنون ${faPct(s.current)} (${esc(s.changeLabel ?? '')})` : ''}</div>
      <p>${esc(s.summary)}</p>${s.trend.direction === 'insufficient' ? '' : lineChart(s.series.map((p) => ({ label: shortLabel(p.at), value: p.percent })), `روند ${s.skill}`, '#1a7f37', 680, 190)}</div>`).join('');
  const rcBlock = `<div class="skill"><h3>${esc(rc.title)} ${rc.available ? trendBadge(rc.trend.label, rc.trend.direction) : ''}</h3>${rc.available
    ? `<div class="note">${fa(rc.results)} نتیجه • شروع ${faPct(rc.start)} ← اکنون ${faPct(rc.current)} (${esc(rc.changeLabel ?? '')})</div><p class="note">${esc(rc.basis)}</p>${lineChart(rc.series.map((p) => ({ label: shortLabel(p.at), value: p.percent })), 'روند کنترل پاسخ', '#9a6700', 680, 190)}`
    : empty(rc.message ?? '')}</div>
    <div class="skill"><h3>${esc(lr.title)}</h3>${empty(lr.message)}</div>`;
  const skills = `<h2>روند مهارت‌ها</h2>${r.skillTrends.skills.length ? skillBlocks : empty(r.skillTrends.skillsMessage ?? MISSING)}${rcBlock}`;

  const a = r.academicAssessments;
  const subj = a.subjects.map((s) => `<div class="skill"><h3>${esc(s.subject)} ${trendBadge(s.trend.label, s.trend.direction)}</h3>
      <div class="note">${fa(s.count)} آزمون • میانگین ${faPct(s.average)}${s.changeLabel ? ` • تغییر از اولین به آخرین آزمون: ${esc(s.changeLabel)}` : ''}</div>
      ${full && s.exams.length ? `<table class="grid"><thead><tr><th>#</th><th>آزمون</th><th>تاریخ</th><th>نمره</th></tr></thead><tbody>${s.exams.map((e) => `<tr><td>${fa(e.index)}</td><td>${esc(e.title)}</td><td>${esc(jalaliText(e.at))}</td><td>${faPct(e.percent)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${s.exams.length >= 3 ? lineChart(s.exams.map((e) => ({ label: shortLabel(e.at), value: e.percent })), `نمرات ${s.subject}`, '#8250df', 680, 180) : ''}</div>`).join('');
  const t = a.totals;
  const academic = `<h2>${esc(a.title)}</h2><p class="note">${esc(a.note)}</p>${a.count === 0 ? empty(a.message ?? 'در این بازه آزمون درسیِ انجام‌شده‌ای ثبت نشده است.') : `
    <div class="cards">${card('تعداد آزمون‌ها', fa(a.count))}${card('میانگین نمره', faPct(a.average))}${card('آخرین نمره', faPct(a.last))}
    ${t ? card('درصد موفقیت (پاسخ صحیح)', faPct(t.successPercent)) + card('پاسخ صحیح / غلط', `${fa(t.correct)} / ${fa(t.wrong)}`) + card('بدون پاسخ', fa(t.unanswered)) : ''}</div>
    ${a.chartAvailable ? lineChart(a.series.map((p) => ({ label: shortLabel(p.at), value: p.percent })), 'نمرهٔ آزمون‌ها در طول بازه', '#8250df') : empty(a.message ?? '')}${subj}`}`;

  const act = r.activities;
  const activities = `<h2>فعالیت‌های انجام‌شده</h2><p class="note">تعداد کل: ${fa(act.total)}${act.total > act.items.length ? ` — در این گزارش ${full ? `صفحهٔ ${fa(act.page)} از ${fa(act.pages)} (${fa(act.items.length)} مورد)` : `آخرین ${fa(act.items.length)} مورد`} نمایش داده شده است.` : ''}</p>
    ${act.items.length ? `<table class="grid"><thead><tr><th>فعالیت</th><th>نوع</th><th>تاریخ</th><th>عملکرد</th></tr></thead><tbody>${act.items.map((x) => `<tr><td>${esc(x.title)}</td><td>${esc(x.skill)}</td><td>${esc(x.dateJalali)}</td><td>${faPct(x.percent)}</td></tr>`).join('')}</tbody></table>` : empty('در این بازه فعالیتی ثبت نشده است.')}`;

  const an = r.analysis;
  const analysis = `<h2>تحلیل عملکرد</h2><p>${esc(an.text)}</p><p class="note">${esc(an.notice)}</p><div class="disclaimer">${esc(r.metadata.disclaimer)}</div>`;

  const pages = full
    ? [section(idPage), section(growth + skills), section(academic), section(activities + analysis)]
    : [section(idPage + growth), section(academic + analysis)];
  const toolbar = opts.toolbar ? `<div class="toolbar"><button onclick="window.print()">چاپ گزارش</button><button onclick="window.print()">ذخیره PDF</button></div>` : '';
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(reportFileName(r).replace(/\.pdf$/, ''))}</title><style>${CSS}</style></head><body>${toolbar}<main class="sheet">${pages.join('')}</main></body></html>`;
}
