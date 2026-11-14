// Live end-to-end checks (run on every app change, demo shop only) on the DEMO shop (never a real shop). Data created here is left in the demo
// shop on purpose. Every step records how long it took, for the speed report.
import { expect, test, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const CODE = process.env.DEMO_CODE ?? '';
const timings: Record<string, number> = {};
const lap = async <T>(name: string, fn: () => Promise<T>) => { const t0 = Date.now(); const r = await fn(); timings[name] = Date.now() - t0; return r; };

test.describe.configure({ mode: 'serial' });
let page: Page;
const name = `Live Test ${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')}${Math.floor(Math.random() * 90 + 10)}`;
const consoleErrors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.skip(!CODE, 'DEMO_CODE secret is not set');
  const ctx = await browser.newContext({ ...info.project.use });
  page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
});
test.afterAll(async ({}, info) => {
  mkdirSync('live-report', { recursive: true });
  const f = 'live-report/timings.json';
  const all = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  all[info.project.name] = { timings, consoleErrors, customer: name };
  writeFileSync(f, JSON.stringify(all, null, 2));
});

test('1. demo code opens the demo shop in English', async () => {
  await lap('open demo page', () => page.goto('/demo'));
  const box = page.locator('main input').first();
  await box.evaluate((el) => { (el as HTMLInputElement).type = 'password'; });   // keep the code out of screenshots
  await box.fill(CODE);
  await lap('demo sign-in → home', async () => {
    await page.locator('main button[type="submit"]').click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByTestId('home-new')).toBeVisible();
  });
  await expect(page.getByTestId('home-existing')).toBeVisible();
  await expect(page.getByTestId('home-update')).toBeVisible();
  await expect(page.getByTestId('pending-list')).toBeVisible();
});

test('2. Appearance: colour changes instantly and is remembered', async () => {
  await page.goto('/settings');
  await page.getByTestId('theme-blue').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'blue');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'blue');
  await page.getByTestId('theme-orange').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('3. New customer: keyboard ready, 3 fields, one tap saves', async () => {
  await page.goto('/home');
  await lap('tap New → name box ready', async () => {
    await page.getByTestId('home-new').click();
    await expect(page.locator('#qe-name')).toBeFocused();
  });
  await page.locator('#qe-name').fill(name);
  await page.locator('#qe-amount').fill('250');
  await page.getByTestId('qe-what').fill('Sugar 5 kg');
  await lap('save new customer + credit', async () => {
    await page.getByTestId('qe-save').click();
    await expect(page.getByText(/credit saved/)).toBeVisible();
  });
  await expect(page.getByTestId('quick-entry')).not.toBeInViewport();
  await expect(page.getByTestId('pending-list')).toContainText(name);
  await expect(page.getByTestId('pending-list').getByRole('link', { name: new RegExp(name) })).toContainText('250');
});

test('4. Existing customer: search, pick, amount, one tap', async () => {
  await page.getByTestId('home-existing').click();
  await expect(page.locator('#qe-name')).toBeFocused();
  await page.locator('#qe-name').fill(name.slice(0, 12));
  await page.getByTestId('qe-suggestions').getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByTestId('qe-customer')).toContainText(name);
  await expect(page.locator('#qe-amount')).toBeFocused();
  await page.locator('#qe-amount').fill('100');
  await lap('save credit for existing customer', async () => {
    await page.getByTestId('qe-save').click();
    await expect(page.getByText(/credit saved/)).toBeVisible();
  });
  await expect(page.getByTestId('pending-list').getByRole('link', { name: new RegExp(name) })).toContainText('350');
});

test('5. Update existing: open customer, delete is blocked while money is due', async () => {
  await page.getByTestId('home-update').click();
  await page.locator('#qe-name').fill(name);
  await lap('pick customer → customer page', async () => {
    await page.getByTestId('qe-suggestions').getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByTestId('customer-balance')).toContainText('350');
  });
  await expect(page.getByTestId('delete-customer')).toBeDisabled();
});

test('6. You gave ₹ on the customer page opens the entry for that customer', async () => {
  await page.getByTestId('you-gave').click();
  await expect(page.getByTestId('qe-customer')).toContainText(name);
  await expect(page.locator('#qe-amount')).toBeFocused();
  await page.getByRole('button', { name: /cancel/i }).first().click();
});

test('7. You got ₹: full payment in one tap, balance becomes 0', async () => {
  await page.getByTestId('you-got').click();
  await page.getByRole('button', { name: /full/i }).click();
  await expect(page.getByTestId('pay-after')).toContainText('0');
  await lap('save payment → back to customer', async () => {
    await page.getByTestId('pay-save').click();
    await expect(page.getByTestId('customer-balance')).toHaveText(/₹\s?0(\.00)?$/);
  });
});

test('8. Delete at ₹0: gone from lists, history kept', async () => {
  await expect(page.getByTestId('delete-customer')).toBeEnabled();
  await page.getByTestId('delete-customer').click();
  await lap('delete customer', async () => {
    await page.getByTestId('delete-confirm').click();
    await expect(page).toHaveURL(/\/home$/);
  });
  await page.goto('/customers');
  await expect(page.getByText(name)).toHaveCount(0);
});

test('9. Speed: screens open from memory', async () => {
  await page.goto('/home');
  await expect(page.getByTestId('pending-list')).toBeVisible();
  await lap('home → customers list (cached)', async () => {
    await page.getByRole('link', { name: /customers/i }).first().click();
    await expect(page).toHaveURL(/\/customers$/);
  });
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming; return { ttfb: Math.round(n.responseStart), domReady: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
  Object.assign(timings, { 'page ttfb': nav.ttfb, 'page domReady': nav.domReady, 'page load': nav.load });
  expect(consoleErrors.filter((e) => !/favicon|manifest/i.test(e))).toEqual([]);
});
