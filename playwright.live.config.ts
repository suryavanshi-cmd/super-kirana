import { defineConfig, devices } from '@playwright/test';

// Live checks against the deployed app and the demo shop (run from GitHub Actions).
export default defineConfig({
  testDir: 'tests/live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: 'live-report/results.json' }]],
  outputDir: 'live-report/artifacts',
  use: { baseURL: process.env.LIVE_URL ?? 'https://super-kirana.vercel.app', screenshot: 'on', trace: 'retain-on-failure', locale: 'en-IN', timezoneId: 'Asia/Kolkata' },
  projects: [
    { name: 'android-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-safari', use: { ...devices['iPhone 13'] } },
  ],
});
