import { z } from 'zod';
import type { Env } from '../env';
import { getOwnedStudent } from '../db/queries';
import { PERIOD_KEYS, PeriodError, resolvePeriod } from '../report/period';
import { renderReportHtml, reportFileName } from '../report/render';
import { buildReport, MAX_PAGE_SIZE } from '../report/service';
import { badRequest, json } from '../utils/http';
import { rateLimit } from '../utils/ratelimit';
import { parse } from '../validation/schemas';

const querySchema = z.object({
  period: z.enum(PERIOD_KEYS, { error: 'بازهٔ زمانی معتبر نیست.' }).default('year_current'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'تاریخ شروع معتبر نیست (YYYY-MM-DD).' }).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'تاریخ پایان معتبر نیست (YYYY-MM-DD).' }).optional(),
  year: z.coerce.number().int().min(1380).max(1500).optional(),
  type: z.enum(['full', 'summary'], { error: 'نوع گزارش معتبر نیست.' }).default('full'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

async function load(req: Request, env: Env, teacherId: string, id: string) {
  const student = await getOwnedStudent(env.DB, teacherId, id); // a foreign / unknown student is a 404 before anything else is read
  const q = new URL(req.url).searchParams, obj: Record<string, string> = {};
  for (const k of ['period', 'from', 'to', 'year', 'type', 'page', 'pageSize']) { const v = q.get(k); if (v) obj[k] = v; }
  const f = parse(querySchema, obj);
  await rateLimit(env, `report:${teacherId}`, 60, 60);
  let period;
  try { period = resolvePeriod({ period: f.period, from: f.from, to: f.to, year: f.year }); }
  catch (e) { if (e instanceof PeriodError) throw badRequest(e.message); throw e; }
  return buildReport(env.DB, teacherId, student, period, { type: f.type, page: f.page, pageSize: f.pageSize });
}

/** GET /students/:id/report — structured report (JSON). Teacher + ownership. Never part of a play link. */
export async function getStudentReport(req: Request, env: Env, teacherId: string, id: string) {
  return json(await load(req, env, teacherId, id));
}

/** GET /students/:id/report/print — the same report as print-ready A4 HTML (RTL, inline SVG charts). The app prints / saves it as PDF via the OS. */
export async function getStudentReportPrint(req: Request, env: Env, teacherId: string, id: string) {
  const report = await load(req, env, teacherId, id);
  const name = reportFileName(report);
  return new Response(renderReportHtml(report), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Report-Filename': name, 'Content-Disposition': `inline; filename="${name}"`,
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    },
  });
}
