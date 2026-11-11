// Optional: SHOTS=1 npm run test:e2e — saves screenshots of the main screens to .e2e/shots.
import { expect, test } from '@playwright/test';

test.skip(!process.env.SHOTS, 'set SHOTS=1 to capture screenshots');

test('capture screens', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const ocr: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/ocr/')) ocr.push(new URL(r.url()).pathname); });
  await page.goto('/login');
  await page.screenshot({ path: '.e2e/shots/01-login.png' });
  await page.getByLabel('वापरकर्तानाव').fill('gaurav');
  await page.getByLabel('पासवर्ड', { exact: true }).fill('Nashik#2026kirana');
  await page.getByRole('button', { name: 'लॉगिन करा' }).click();
  await page.getByRole('button', { name: /सुपर किराणा, निफाड/ }).click();
  await expect(page.getByTestId('summary')).toBeVisible();
  await page.screenshot({ path: '.e2e/shots/02-home.png', fullPage: true });
  await page.goto('/customers'); await expect(page.getByText('सुरेश पाटील')).toBeVisible();
  await page.screenshot({ path: '.e2e/shots/03-customers.png' });
  await page.getByText('सुरेश पाटील').click(); await expect(page.getByTestId('customer-balance')).toBeVisible();
  await page.screenshot({ path: '.e2e/shots/04-customer.png', fullPage: true });
  await page.goto('/bill');
  await page.getByPlaceholder('उत्पादन शोधा आणि जोडा').fill('साखर');
  await page.getByTestId('product-results').getByRole('button', { name: /साखर/ }).click();
  await page.screenshot({ path: '.e2e/shots/05-bill.png', fullPage: true });
  await page.getByRole('button', { name: 'बिल तपासा' }).click();
  await page.screenshot({ path: '.e2e/shots/06-bill-confirm.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'बिल सेव्ह करा' }).click();
  await expect(page.getByTestId('receipt')).toBeVisible();
  await page.screenshot({ path: '.e2e/shots/07-receipt.png', fullPage: true });
  await page.goto('/reports'); await expect(page.getByTestId('net-sales')).toBeVisible();
  await page.screenshot({ path: '.e2e/shots/08-reports.png', fullPage: true });
  await page.goto('/settings'); await expect(page.getByTestId('member').first()).toBeVisible();
  await page.screenshot({ path: '.e2e/shots/09-settings.png', fullPage: true });
  await page.goto('/admin'); await expect(page.getByTestId('admin-shop').first()).toBeVisible();
  await page.screenshot({ path: '.e2e/shots/10-admin.png', fullPage: true });

  const shot = await (await browser.newContext()).newPage();
  await shot.setViewportSize({ width: 900, height: 420 });
  await shot.setContent('<body style="margin:0;background:#fff;font:700 54px sans-serif;padding:36px;line-height:1.7">साखर 2 किलो<br>Rice 5 kg = 300<br>तेल 1 लिटर 140</body>');
  const png = await shot.screenshot();
  await page.goto('/scan');
  await page.screenshot({ path: '.e2e/shots/11-scan.png' });
  await page.getByTestId('gallery-input').setInputFiles({ name: 'list.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'यादी वाचा' }).click();
  await expect(page.getByRole('button', { name: 'बिलात जोडा' }).or(page.getByText('फोटो स्पष्ट नाही').first())).toBeVisible({ timeout: 150_000 });
  await page.screenshot({ path: '.e2e/shots/12-scan-review-phone.png', fullPage: true });
  console.log('OCR assets requested:', [...new Set(ocr)].join(' '));
  console.log('OCR items:', JSON.stringify(await page.getByTestId('ocr-stepper').getByTestId('ocr-item').allInnerTexts()));
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.screenshot({ path: '.e2e/shots/13-scan-review-wide.png', fullPage: true });
});
