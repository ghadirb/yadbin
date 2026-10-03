import type { Env } from '../env';
import { newId, nowIso } from '../utils/ids';
import { freeLimits, trialDays, UNLIMITED, type FreeLimits } from './config';

export type PlanKind = 'FREE' | 'TRIAL' | 'PRO';
export type AccessStatus = 'FREE' | 'TRIAL' | 'ACTIVE' | 'EXPIRED';

export interface Entitlements {
  plan: PlanKind;
  status: AccessStatus;
  trialActive: boolean;
  subscriptionActive: boolean;
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
  /** End of the current Pro period (null when there is none). */
  expiresAt: string | null;
  planId: string | null;
  limits: FreeLimits;
  features: { teacherAssessment: boolean; aiBuilder: boolean; fullReports: boolean };
  serverTime: string;
}

/**
 * Start the one-and-only Trial for an account. Atomic and idempotent: the UPDATE only matches while trial_used = 0,
 * so a second call (re-login, retry, parallel requests, a client "asking" for another trial) changes nothing.
 */
export async function startTrialIfNeeded(env: Env, teacherId: string, now = new Date()): Promise<boolean> {
  const days = trialDays(env);
  const started = now.toISOString();
  const expires = new Date(now.getTime() + days * 86400_000).toISOString();
  const r = await env.DB.prepare('UPDATE teachers SET trial_used = 1, trial_started_at = ?, trial_expires_at = ? WHERE id = ? AND trial_used = 0')
    .bind(started, expires, teacherId).run();
  return (r.meta.changes ?? 0) > 0;
}

/** The latest expiry among ACTIVE subscriptions that are still running right now (server clock only). */
export async function currentProExpiry(env: Env, teacherId: string, nowIsoStr = nowIso()): Promise<{ expiresAt: string; planId: string } | null> {
  const row = await env.DB.prepare(
    "SELECT expires_at, plan_id FROM subscriptions WHERE teacher_id = ? AND status = 'active' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1",
  ).bind(teacherId, nowIsoStr).first<{ expires_at: string; plan_id: string }>();
  return row ? { expiresAt: row.expires_at, planId: row.plan_id } : null;
}

/**
 * THE one place that decides what a teacher may do. Every endpoint and the subscription screen go through it.
 *   active Pro  -> PRO (everything)      running Trial -> TRIAL (everything)
 *   otherwise   -> FREE limits (status EXPIRED if the person had a Trial/Pro before, FREE otherwise)
 * Only the server clock is used; the phone's clock is never consulted.
 */
export async function getUserEntitlements(env: Env, teacherId: string): Promise<Entitlements> {
  const now = nowIso();
  const t = await env.DB.prepare('SELECT trial_used, trial_started_at, trial_expires_at FROM teachers WHERE id = ?').bind(teacherId).first<any>();
  if (t && !t.trial_used) {
    // Accounts that existed before subscriptions (or whose registration-time start failed) get their single Trial on first access.
    await startTrialIfNeeded(env, teacherId);
    const again = await env.DB.prepare('SELECT trial_used, trial_started_at, trial_expires_at FROM teachers WHERE id = ?').bind(teacherId).first<any>();
    Object.assign(t, again);
  }
  const pro = await currentProExpiry(env, teacherId, now);
  const trialActive = !!t?.trial_expires_at && t.trial_expires_at > now;
  const everSubscribed = !!(await env.DB.prepare("SELECT 1 AS x FROM subscriptions WHERE teacher_id = ? AND status = 'active' LIMIT 1").bind(teacherId).first());

  let plan: PlanKind, status: AccessStatus;
  if (pro) { plan = 'PRO'; status = 'ACTIVE'; }
  else if (trialActive) { plan = 'TRIAL'; status = 'TRIAL'; }
  else { plan = 'FREE'; status = t?.trial_used || everSubscribed ? 'EXPIRED' : 'FREE'; }

  const full = plan !== 'FREE';
  return {
    plan, status, trialActive, subscriptionActive: !!pro,
    trialStartedAt: t?.trial_started_at ?? null, trialExpiresAt: t?.trial_expires_at ?? null,
    expiresAt: pro?.expiresAt ?? null, planId: pro?.planId ?? null,
    limits: full ? UNLIMITED : freeLimits(env),
    features: { teacherAssessment: true, aiBuilder: full, fullReports: full },
    serverTime: now,
  };
}

export { newId };
