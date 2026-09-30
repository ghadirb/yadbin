import { defineConfig } from '@playwright/test';

// Runs against a LOCAL `wrangler dev` (Worker + built Student Web + local D1). Never point this at production:
// the journey registers teachers and creates classes/students.
export default defineConfig({
  testDir: './tests',
  timeout: 6 * 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8787',
    locale: 'fa-IR',
    viewport: { width: 390, height: 800 }, // phone-sized
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
