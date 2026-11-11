// Optional: SHOTS=1 npm run test:e2e — saves screenshots of the main screens to .e2e/shots.
import { expect, test } from '@playwright/test';

test.skip(!process.env.SHOTS, 'set SHOTS=1 to capture screenshots');

test('capture screens', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('वापरकर्तानाव').fill('gaurav');
  await page.getByLabel('पासवर्ड', { exact: true }).fill('Nashik#2026kirana');
  await page.getByRole('button', { name: 'लॉगिन करा' }).click();
  await expect(page.getByTestId('pending-list')).toBeVisible();
  await page.screenshot({ path: '.e2e/shots/a-home.png', fullPage: true });
  await page.getByRole('link', { name: /उधारी नोंदवा/ }).click();
  await page.screenshot({ path: '.e2e/shots/b-udhari-pick.png' });
  await page.getByRole('button', { name: /सुरेश पाटील/ }).click();
  await page.getByLabel('बिलाची रक्कम').fill('120');
  await page.getByLabel('आत्ता दिलेले पैसे').fill('20');
  await page.screenshot({ path: '.e2e/shots/c-udhari-form.png', fullPage: true });
  await page.goto('/admin');
  await expect(page.getByTestId('admin-shop').first()).toBeVisible();
  await page.screenshot({ path: '.e2e/shots/d-admin.png', fullPage: true });
});
