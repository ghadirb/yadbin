import { expect, request as pwRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import { goOffline, goOnline } from './bot';

// Yadbin Kids acceptance journey in a REAL Chromium against the REAL Worker + local D1:
// parent registers → adds a child → child opens the link → plays (also OFFLINE) → results sync once → parent sees growth.
test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let parentToken = '', childId = '', link = '';
const auth = () => ({ Authorization: `Bearer ${parentToken}` });

test.beforeAll(async ({ playwright }) => {
  api = await pwRequest.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8787' });
  const phone = `0912${String(Date.now()).slice(-7)}`;
  const reg = await api.post('/api/kids/parent/register', { data: { name: 'مادر آزمون', phone, password: 'parent-pass-1' } });
  expect(reg.status()).toBe(201); parentToken = (await reg.json()).token;
  const c = await api.post('/api/kids/parent/children', { headers: auth(), data: { name: 'سارا', age: 7, avatar: '🦊' } });
  expect(c.status()).toBe(201); const body = await c.json(); childId = body.child.id; link = new URL(body.childLink).pathname;
  void playwright;
});

/** Plays one game the way a small child might: tapping around until the "آفرین" result appears. */
async function playOne(page: Page) {
  const card = page.locator('.journey-card.next, .journey-card:not(.done):not([disabled])').first();
  await card.click();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await page.getByText('آفرین').first().isVisible().catch(() => false)) return;
    const tiles = page.locator('.play-body .tile:not([disabled]), .play-body .react-stage');
    const n = await tiles.count(); if (n) await tiles.nth(Math.floor(Math.random() * n)).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(120);
  }
  throw new Error('game did not finish');
}

test('child opens the pairing link and sees today\'s three games (no login, no test wording)', async ({ page }) => {
  await page.goto(link);
  await expect(page).toHaveURL(/\/kids$/);                                  // the token is removed from the address bar
  await expect(page.locator('.journey-card')).toHaveCount(3);
  const text = await page.locator('body').innerText();
  for (const bad of ['آزمون', 'تست', 'نمره', 'IQ', 'ADHD', 'تشخیص']) expect(text).not.toContain(bad);
});

test('plays a game online → stars, queue drains, server stored exactly one session', async ({ page }) => {
  await page.goto(link); await playOne(page);
  await expect(page.locator('.stars')).toBeVisible();
  await expect.poll(async () => (await (await api.get(`/api/kids/parent/children/${childId}/dashboard`, { headers: auth() })).json()).status.gamesCompleted, { timeout: 30_000 }).toBe(1);
});

test('plays OFFLINE: the game still works and is delivered once when the network returns', async ({ page, context }) => {
  await page.goto(link); await expect(page.locator('.journey-card')).toHaveCount(3);   // shell + journey are cached after the first visit
  await goOffline(context);
  await page.getByRole('button', { name: /خانه/ }).click().catch(() => {});
  await playOne(page);
  await expect(page.locator('.stars')).toBeVisible();
  await goOnline(context);
  await expect.poll(async () => (await (await api.get(`/api/kids/parent/children/${childId}/dashboard`, { headers: auth() })).json()).status.gamesCompleted, { timeout: 60_000 }).toBe(2);
  await page.reload();                                                                 // a reload must not re-send anything
  await page.waitForTimeout(2500);
  expect((await (await api.get(`/api/kids/parent/children/${childId}/dashboard`, { headers: auth() })).json()).status.gamesCompleted).toBe(2);
});

test('parent dashboard shows growth with gentle wording; a child link cannot open it', async ({ page }) => {
  await page.goto(link); await page.goto('/kids/parent');
  await expect(page.locator('#p-phone')).toBeVisible();                              // child device ≠ parent access
  const d = await (await api.get(`/api/kids/parent/children/${childId}/dashboard`, { headers: auth() })).json();
  expect(d.skills).toHaveLength(8); expect(d.notice).toContain('جایگزین نظر متخصص نیست');
  expect(JSON.stringify(d)).not.toMatch(/ADHD|اختلال|نابغه|ضعیف/);
});
