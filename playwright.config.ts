import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100', ...devices['Pixel 7'], locale: 'en-IN', timezoneId: 'Asia/Kolkata', trace: 'retain-on-failure' },
  webServer: [
    { command: 'bash tests/harness/start-stack.sh > .e2e/stack.log 2>&1', url: 'http://127.0.0.1:54400/health', reuseExistingServer: false, timeout: 120_000,
      env: { TEST_DB: 'kirana_e2e', DENO_BIN: process.env.DENO_BIN ?? 'deno' } },
    { command: 'npx next start -p 3100', url: 'http://127.0.0.1:3100/login', reuseExistingServer: false, timeout: 60_000 },
  ],
});
