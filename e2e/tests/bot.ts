import { expect, type BrowserContext, type Page } from '@playwright/test';

const MEM_NAME: Record<string, string> = { red: 'قرمز', blue: 'آبی', green: 'سبز', yellow: 'زرد', star: 'ستاره', moon: 'ماه', heart: 'قلب', sun: 'خورشید', triangle: 'مثلث' };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface PlayOptions {
  /** Called after each recorded (non-tutorial) answer. */
  onAnswered?: (n: number) => Promise<void>;
  /** Ask for a hint on the first real problem-solving question. */
  useHint?: boolean;
}

/**
 * A child-like bot that plays the REAL page through the DOM: reads the screen, taps buttons, always answers correctly.
 * Memory/problem answers come from the question pools the page itself downloaded (same data the game uses).
 */
export async function playThrough(page: Page, token: string, game: 'memory' | 'attention' | 'problem_solving', opts: PlayOptions = {}) {
  const resp = page.waitForResponse((r) => /\/api\/play\/[A-Z0-9]+$/.test(r.url()) && r.request().method() === 'GET');
  await page.goto(`/play/${token}`);
  const data: any = await (await resp).json();

  let inTutorial = true, answered = 0, hintDone = false;
  const usedInLevel: Record<number, number> = {};
  const level = () => (data.difficultyMode === 'adaptive' ? Math.min(3, data.startDifficulty + Math.floor(answered / 3)) : data.startDifficulty);
  const answers = new Map<string, string>([['🟡 🟣 🟡 🟣 ؟', '🟡']]);
  for (const list of Object.values<any[]>(data.pools ?? {})) for (const q of list) if (q.question) answers.set(String(q.question).trim(), q.options[q.correctOption]);

  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const kind: string = await page.evaluate(() => {
      if (document.querySelector('section[role=status]')) return 'end';
      if (document.querySelector('section[role=alert]')) return 'error';
      if (document.querySelector('.choices')) return 'memory';
      if (document.querySelector('.grid')) return 'attention';
      if (document.querySelector('.options')) return 'problem';
      if (document.querySelector('.stage .btn') && !document.querySelector('.grid')) return 'stagebtn';
      if (document.querySelector('.card .btn')) return 'button';
      return 'wait';
    });

    if (kind === 'end' || kind === 'error') return { data, endText: (await page.locator('section[role=status], section[role=alert]').first().innerText()).trim(), kind };
    if (kind === 'wait') { await page.waitForTimeout(200); continue; }

    if (kind === 'button') {
      const btn = page.locator('.card .btn').first();
      const label = (await btn.innerText()).trim();
      await btn.click();
      if (label === 'آماده‌ام') inTutorial = false;
      await page.waitForTimeout(150);
      continue;
    }
    if (kind === 'stagebtn') { await page.locator('.stage .btn').first().click(); await page.waitForTimeout(150); continue; } // «فهمیدم» (rule changed)

    if (kind === 'memory') {
      const l = level();
      const q = inTutorial ? { sequence: ['red', 'star', 'blue'], isReverse: false } : data.pools[String(l)][(usedInLevel[l] = (usedInLevel[l] ?? -1) + 1)];
      const target: string[] = q.isReverse ? [...q.sequence].reverse() : q.sequence;
      const node = await nodeOf(page, '.choices');
      for (const s of target) await page.locator(`.choice[aria-label="${MEM_NAME[s]}"]`).click();
      await replaced(page, node);
    } else if (kind === 'attention') {
      const color = (await page.locator('.rule').first().innerText()).trim().split(/\s+/)[0];
      const node = await nodeOf(page, '.grid');
      const cells = page.locator(`button.cell[aria-label="${color}"]`);
      const n = await cells.count();
      for (let i = 0; i < n; i++) await cells.nth(i).click();
      await page.getByRole('button', { name: /تمام شد/ }).click();
      await replaced(page, node);
    } else if (kind === 'problem') {
      const node = await nodeOf(page, '.options');
      const text = (await page.locator('.question').innerText()).trim();
      const ans = answers.get(text);
      expect(ans, `no known answer for question "${text}"`).toBeTruthy();
      if (opts.useHint && !inTutorial && !hintDone) {
        await page.getByRole('button', { name: /راهنمایی/ }).click();
        await expect(page.locator('.hint')).toHaveCount(1);
        hintDone = true;
      }
      await page.locator('.option').filter({ hasText: new RegExp(`^\\s*${esc(ans!)}\\s*$`) }).first().click();
      await replaced(page, node);
    }
    if (!inTutorial) { answered++; await opts.onAnswered?.(answered); }
  }
  throw new Error('bot timed out before the game finished');
}

async function nodeOf(page: Page, sel: string) { return page.locator(sel).first().elementHandle(); }
async function replaced(page: Page, node: Awaited<ReturnType<typeof nodeOf>>) {
  await page.waitForFunction((e) => !e || !e.isConnected, node, { timeout: 15_000 });
}

export async function readIdb(page: Page, key: string): Promise<any> {
  return page.evaluate((k) => new Promise((resolve) => {
    const r = indexedDB.open('yadbin', 1);
    r.onerror = () => resolve('idb-error');
    r.onsuccess = () => {
      const g = r.result.transaction('kv').objectStore('kv').get(k);
      g.onsuccess = () => resolve(g.result ?? null);
      g.onerror = () => resolve('idb-error');
    };
  }), key);
}

export const goOffline = (ctx: BrowserContext) => ctx.setOffline(true);
export const goOnline = (ctx: BrowserContext) => ctx.setOffline(false);
