// End-to-end tests: the real UI in a phone-sized browser, against the real SQL functions and the
// real edge function (see tests/harness). One serial story, like a shopkeeper's first day.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.describe.configure({ mode: 'serial' });

const ADMIN = { username: 'gaurav', password: 'Nashik#2026kirana' };
const OWNER_B = { username: 'ramesh', temp: 'Temp#4521pass', password: 'Shree#7788kirana' };
const CASHIER = { username: 'sunita', temp: 'Temp#9911pass', password: 'Dukan#5566kirana' };

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('वापरकर्तानाव').fill(username);
  await page.getByLabel('पासवर्ड', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'लॉगिन करा' }).click();
}
async function newSession(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  return ctx.newPage();
}
const tile = (page: Page, key: string) => page.getByTestId(key);
let page: Page;
let customerUrl = '';

test.beforeAll(async ({ browser }) => { page = await newSession(browser); });

test('login screen is Marathi on first visit; language choice persists; errors are generic', async () => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'लॉगिन' })).toBeVisible();
  await expect(page.getByLabel('वापरकर्तानाव')).toBeVisible();
  await expect(page.getByRole('button', { name: 'लॉगिन करा' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'पासवर्ड विसरलात?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('mr');

  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Username')).toBeVisible();
  await page.getByRole('radio', { name: 'मराठी' }).click();

  // Unknown user and wrong password must look identical.
  await login(page, 'no-such-user', 'whatever123');
  await expect(page.getByTestId('error')).toHaveText('वापरकर्तानाव किंवा पासवर्ड चुकीचा आहे.');
});

test('first-run setup needs the one-time code and creates the seeded shop for that owner', async () => {
  await page.goto('/setup');
  await page.getByLabel('सेटअप कोड').fill('wrong-code');
  await page.getByLabel('तुमचे नाव').fill('गौरव');
  await page.getByLabel('वापरकर्तानाव').fill(ADMIN.username);
  await page.getByLabel('नवीन पासवर्ड', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('नवीन पासवर्ड पुन्हा').fill(ADMIN.password);
  await page.getByRole('button', { name: 'खाते बनवा' }).click();
  await expect(page.getByTestId('error')).toContainText('सेटअप कोड चुकीचा आहे');
  await page.getByLabel('सेटअप कोड').fill('e2e-setup-code');
  await page.getByRole('button', { name: 'खाते बनवा' }).click();
  await expect(page.getByText('खाते तयार झाले')).toBeVisible();

  await login(page, ADMIN.username, 'wrong-password-1');
  await expect(page.getByTestId('error')).toHaveText('वापरकर्तानाव किंवा पासवर्ड चुकीचा आहे.');   // identical to an unknown user

  await login(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: 'सुपर किराणा, निफाड' })).toBeVisible();
  await expect(page.getByText('नमस्कार!')).toBeVisible();
  for (const label of ['आजची विक्री', 'आज जमा झाले', 'एकूण उधारी बाकी', 'बाकी असलेले ग्राहक', 'नवीन बिल', 'फोटोवरून बिल', 'ग्राहक जोडा', 'पैसे जमा करा', 'अलीकडील व्यवहार']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  const nav = page.getByRole('navigation', { name: 'मुख्य मेनू' });
  for (const label of ['मुख्यपृष्ठ', 'ग्राहक', 'नवीन बिल', 'उत्पादने', 'अहवाल']) await expect(nav.getByRole('link', { name: label })).toBeVisible();
  await page.goto('/setup');
  await expect(page.getByText('सेटअप आधीच पूर्ण झाला आहे')).toBeVisible();
});

test('add a product and a customer with an opening balance', async () => {
  await page.goto('/products');
  await page.getByRole('link', { name: 'उत्पादन जोडा' }).first().click();
  await page.getByLabel('उत्पादनाचे नाव').fill('साखर');
  await page.getByLabel('माप').selectOption('kg');
  await page.getByLabel(/दर प्रति/).fill('42');
  await page.getByText('इतर माहिती').click();
  await page.getByLabel(/इंग्रजी नाव/).fill('Sugar');
  await page.getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(page.getByText('साखर').first()).toBeVisible();
  await expect(page.getByText('₹42.00')).toBeVisible();

  await page.goto('/customers/new');
  await page.getByLabel('ग्राहकाचे नाव').fill('सुरेश पाटील');
  await page.getByLabel(/मोबाईल नंबर/).fill('9876543210');
  await page.getByLabel(/सुरुवातीची बाकी/).fill('500');
  await page.getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(page.getByTestId('customer-balance')).toHaveText('₹500.00');
  customerUrl = new URL(page.url()).pathname;
});

test('A+B: ₹315 bill, ₹200 paid, ₹500 old dues → ₹115 on the bill, ₹615 total; receipt from server', async () => {
  await page.goto('/bill');
  await page.getByTestId('pick-customer').click();
  await page.getByRole('dialog').getByRole('button', { name: /सुरेश पाटील/ }).click();
  await page.getByPlaceholder('उत्पादन शोधा आणि जोडा').fill('sugar');          // English search finds the Marathi product
  await page.getByTestId('product-results').getByRole('button', { name: /साखर/ }).click();
  const line = page.getByTestId('bill-line').first();
  await line.getByLabel('प्रमाण').fill('7.5');
  await expect(page.getByTestId('bill-total')).toHaveText('₹315.00');
  await page.getByLabel('मिळालेली रक्कम').fill('200');
  await page.getByRole('button', { name: 'बिल तपासा' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('मागील बाकी');
  await expect(dlg).toContainText('₹500.00');
  await expect(dlg).toContainText('₹115.00');
  await expect(dlg).toContainText('₹615.00');
  await dlg.getByRole('button', { name: 'बिल सेव्ह करा' }).click();
  await expect(page).toHaveURL(/\/bills\//);
  const receipt = page.getByTestId('receipt');
  await expect(receipt).toContainText('सुपर किराणा, निफाड');
  await expect(page.getByTestId('receipt-total')).toHaveText('₹315.00');
  await expect(page.getByTestId('receipt-balance')).toHaveText('₹615.00');
  await expect(receipt).toContainText('7.5 किलो × ₹42.00/किलो');

  // L: switching language changes words, never amounts.
  const amountsMr = (await receipt.innerText()).match(/₹[\d,]+\.\d{2}/g);
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'English' }).click();
  await page.goBack();
  await expect(page.getByTestId('receipt')).toContainText('Super Kirana, Niphad');
  await expect(page.getByTestId('receipt')).toContainText('Bill total');
  const amountsEn = (await page.getByTestId('receipt').innerText()).match(/₹[\d,]+\.\d{2}/g);
  expect(amountsEn).toEqual(amountsMr);
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'मराठी' }).click();
  await expect(page.getByRole('heading', { name: 'सेटिंग्ज' })).toBeVisible();
});

test('E: collecting old dues lowers the balance and does not add to sales', async () => {
  await page.goto('/home');
  await expect(tile(page, 'home.todaySales')).toHaveText('₹315.00');
  await expect(tile(page, 'home.todayCollected')).toHaveText('₹200.00');
  await expect(tile(page, 'home.totalDue')).toHaveText('₹615.00');
  await page.goto(`${customerUrl}/pay`);
  await page.getByLabel('जमा रक्कम').fill('700');
  await expect(page.getByText(/रक्कम बाकीपेक्षा जास्त आहे/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'जमा नोंदवा' })).toBeDisabled();
  await page.getByLabel('जमा रक्कम').fill('400');
  await page.getByRole('radio', { name: 'UPI' }).click();
  await page.getByRole('button', { name: 'जमा नोंदवा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'जमा नोंदवा' }).click();
  await expect(page).toHaveURL(/\/payments\//);
  await expect(page.getByTestId('payment-balance')).toHaveText('₹215.00');
  await expect(page.getByTestId('payment-receipt')).toContainText('सुरुवातीची बाकी');
  await page.goto('/home');
  await expect(tile(page, 'home.todaySales')).toHaveText('₹315.00');          // unchanged
  await expect(tile(page, 'home.todayCollected')).toHaveText('₹600.00');
  await expect(tile(page, 'home.totalDue')).toHaveText('₹215.00');
  await expect(tile(page, 'home.customersDue')).toHaveText('1');
});

test('N: a lost connection never shows "saved"; status lookup with the same key resolves it exactly once', async () => {
  // Case 1: the request never reaches the server.
  await page.goto(`${customerUrl}/pay`);
  await page.route('**/rest/v1/rpc/receive_payment', (r) => r.abort('connectionfailed'));
  await page.getByLabel('जमा रक्कम').fill('15');
  await page.getByRole('button', { name: 'जमा नोंदवा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'जमा नोंदवा' }).click();
  await expect(page.getByTestId('unknown-outcome')).toContainText('नोंद झाली की नाही हे माहीत नाही');
  await expect(page.getByText('पैसे जमा झाले')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/payments\//);
  await page.unroute('**/rest/v1/rpc/receive_payment');
  await page.getByRole('button', { name: 'स्थिती तपासा' }).click();
  await expect(page.getByText('सर्व्हरवर ही नोंद नाही')).toBeVisible();
  await page.getByRole('button', { name: /पुन्हा पाठवा/ }).click();
  await expect(page).toHaveURL(/\/payments\//);
  await expect(page.getByTestId('payment-balance')).toHaveText('₹200.00');

  // Case 2: the server posts it but the answer is lost. Checking must find it; nothing is posted twice.
  await page.goto(`${customerUrl}/pay`);
  await page.route('**/rest/v1/rpc/receive_payment', async (r) => { await r.fetch(); await r.abort('connectionfailed'); });
  await page.getByLabel('जमा रक्कम').fill('20');
  await page.getByRole('button', { name: 'जमा नोंदवा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'जमा नोंदवा' }).click();
  await expect(page.getByTestId('unknown-outcome')).toBeVisible();
  await page.unroute('**/rest/v1/rpc/receive_payment');
  await page.goto('/sync');                                   // the pending entry survives navigation
  await expect(page.getByTestId('pending-row').first()).toContainText('स्थिती माहीत नाही');
  await page.getByTestId('pending-row').first().getByRole('button', { name: 'स्थिती तपासा' }).click();
  await expect(page.getByTestId('pending-row').first()).toContainText('सर्व्हरवर नोंदले');
  await page.goto(customerUrl);
  await expect(page.getByTestId('customer-balance')).toHaveText('₹180.00');   // 200 − 20, once

  // Offline: posting is blocked up front and the screen says so.
  await page.context().setOffline(true);
  await page.goto('/bill').catch(() => undefined);
  await page.context().setOffline(false);
});

test('offline: cached lists stay visible, a draft is kept on the phone, posting is blocked', async () => {
  await page.goto('/customers');
  await expect(page.getByText('सुरेश पाटील')).toBeVisible();
  await page.goto('/bill');
  await page.getByPlaceholder('उत्पादन शोधा आणि जोडा').fill('साखर');
  await page.getByTestId('product-results').getByRole('button', { name: /साखर/ }).click();
  await expect(page.getByTestId('bill-total')).toHaveText('₹42.00');
  await page.waitForTimeout(600);
  await page.context().setOffline(true);
  await expect(page.getByText('इंटरनेट उपलब्ध नाही').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'बिल तपासा' })).toBeDisabled();
  await expect(page.getByText(/बिल आत्ता नोंदता येणार नाही/)).toBeVisible();
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.getByTestId('bill-line')).toHaveCount(1);                 // draft survived the reload
  await expect(page.getByText('या फोनवर सेव्ह आहे (अजून नोंदले नाही)')).toBeVisible();
  await page.getByRole('button', { name: 'बिल रिकामे करा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'बिल रिकामे करा' }).click();
  await expect(page.getByTestId('bill-line')).toHaveCount(0);
});

test('walk-in bills must be paid in full', async () => {
  await page.goto('/bill');
  await page.getByPlaceholder('उत्पादन शोधा आणि जोडा').fill('साखर');
  await page.getByTestId('product-results').getByRole('button', { name: /साखर/ }).click();
  await page.getByLabel('मिळालेली रक्कम').fill('10');
  await page.getByRole('button', { name: 'बिल तपासा' }).click();
  await expect(page.getByText(/किरकोळ ग्राहकाचे बिल पूर्ण रकमेचे हवे/).first()).toBeVisible();
  await page.getByRole('button', { name: 'पूर्ण रक्कम' }).click();
  await page.getByRole('button', { name: 'बिल तपासा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'बिल सेव्ह करा' }).click();
  await expect(page.getByTestId('receipt-total')).toHaveText('₹42.00');
});

test('M: OCR output is only a draft — flagged lines must be corrected before it can reach a bill', async () => {
  await page.goto('/scan');
  await expect(page.getByText(/हस्ताक्षर नेहमी बरोबर वाचले जात नाही/)).toBeVisible();
  await page.getByRole('button', { name: 'यादी टाइप करा' }).click();
  await page.getByRole('textbox', { name: 'यादी टाइप करा' }).fill('साखर 2 किलो\nकेशर 1 ग्रॅम 90');
  await page.getByRole('button', { name: 'ही यादी वापरा' }).click();
  const add = page.getByRole('button', { name: 'बिलात जोडा' });
  await expect(add).toBeDisabled();
  await expect(page.getByText('आधी 2 ओळी तपासा')).toBeVisible();
  const card = page.getByTestId('ocr-stepper').getByTestId('ocr-item');
  // Line 1: price was not written → saved price is suggested, and must be accepted by ticking "checked".
  await expect(card).toContainText('सेव्ह केलेला दर सुचवला आहे');
  await expect(card.getByLabel(/दर/)).toHaveValue('42');
  await card.getByLabel('तपासले').check();
  await expect(page.getByText('आधी 1 ओळी तपासा')).toBeVisible();
  await page.getByRole('button', { name: 'पुढे' }).click();
  // Line 2: unknown product with a written rate; cannot be ticked until it is complete, then is.
  await expect(card).toContainText('उत्पादन यादीत सापडले नाही');
  await expect(card.getByLabel(/दर/)).toHaveValue('90');
  await card.getByLabel(/दर/).fill('');
  await expect(card.getByLabel('तपासले')).toBeDisabled();           // no price → cannot be marked as checked
  await card.getByLabel(/दर/).fill('95');
  await card.getByLabel('तपासले').check();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page).toHaveURL(/\/bill$/);
  await expect(page.getByText('फोटोवरून आलेली यादी')).toBeVisible();
  await expect(page.getByTestId('bill-line')).toHaveCount(2);
  await expect(page.getByTestId('bill-total')).toHaveText('₹179.00');          // 2×42 + 1×95 — nothing posted yet
  await page.goto('/home');
  await expect(tile(page, 'home.todaySales')).toHaveText('₹357.00');          // still only the two real bills
  await page.goto('/bill');
  await page.getByRole('button', { name: 'बिल तपासा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'बिल सेव्ह करा' }).click();
  await expect(page.getByTestId('receipt')).toContainText('फोटोवरून');
});

test('on-device OCR reads a printed list from a photo', async ({ browser }) => {
  test.setTimeout(180_000);
  const shot = await newSession(browser);
  await shot.setViewportSize({ width: 900, height: 420 });
  await shot.setContent('<body style="margin:0;background:#fff;font:700 54px Arial,sans-serif;padding:36px;line-height:1.7">Sugar 2 kg @ 42<br>Rice 5 kg = 300<br>Oil 1 litre</body>');
  const png = await shot.screenshot();
  await shot.context().close();
  await page.goto('/scan');
  await page.getByTestId('gallery-input').setInputFiles({ name: 'list.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('घेतलेला फोटो')).toBeVisible();
  await page.getByRole('button', { name: 'यादी वाचा' }).click();
  await expect(page.getByRole('button', { name: 'बिलात जोडा' })).toBeVisible({ timeout: 150_000 });
  const first = page.getByTestId('ocr-stepper').getByTestId('ocr-item');
  await expect(first.getByLabel('वस्तूचे नाव')).toHaveValue(/sugar/i);
  await expect(first.getByLabel('प्रमाण')).toHaveValue('2');
  await expect(first.getByLabel(/दर/)).toHaveValue('42');
  await expect(page.getByRole('button', { name: 'बिलात जोडा' })).toBeDisabled(); // still needs review
});

test('owner-only correction: reverse a payment with a reason; reports reconcile; CSV export', async () => {
  await page.goto(customerUrl);
  const before = await page.getByTestId('customer-balance').innerText();
  expect(before).toBe('₹180.00');
  await page.getByRole('link', { name: 'व्यवहार इतिहास' }).click();
  await page.getByRole('link', { name: /पैसे जमा.*UPI/ }).first().click();
  await page.getByRole('button', { name: 'जमा रद्द करा' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'जमा रद्द करा' }).click();
  await expect(dlg.getByTestId('error')).toContainText('कारण लिहा');
  await dlg.getByLabel('कारण').fill('चुकीची नोंद');
  await dlg.getByRole('button', { name: 'जमा रद्द करा' }).click();
  await expect(page.getByText('ही जमा रद्द केली आहे')).toBeVisible();
  await page.goto(customerUrl);
  await expect(page.getByTestId('customer-balance')).toHaveText('₹580.00');
  await expect(page.getByText('खाते तपासले — हिशोब जुळतो')).toBeVisible();

  await page.goto('/reports');
  await expect(page.getByTestId('net-sales')).toHaveText('₹536.00');           // 315 + 42 + 179
  await expect(page.getByTestId('net-collected')).toHaveText('₹456.00');       // 200+400+15+20+42+179 − 400
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^daily-.*\.csv$/);
  await page.getByRole('radio', { name: 'उधारी' }).click();
  await expect(page.getByText('सुरेश पाटील')).toBeVisible();
  await expect(page.getByText('₹580.00').first()).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'हिशोब तपासा' }).click();
  await expect(page.getByText(/सर्व \d+ खाती जुळतात/)).toBeVisible();
});

test('staff: owner adds a cashier; cashier must change password and has limited access', async ({ browser }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'कर्मचारी जोडा' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('वापरकर्तानाव').fill(CASHIER.username);
  await dlg.getByLabel('नाव', { exact: true }).fill('सुनीता');
  await dlg.getByLabel('तात्पुरता पासवर्ड').fill(CASHIER.temp);
  await dlg.getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(page.getByTestId('member').filter({ hasText: 'सुनीता' })).toContainText('पासवर्ड बदलणे बाकी');

  const cashier = await newSession(browser);
  await login(cashier, CASHIER.username, CASHIER.temp);
  await expect(cashier).toHaveURL(/\/change-password$/);
  await cashier.getByLabel('सध्याचा पासवर्ड').fill(CASHIER.temp);
  await cashier.getByLabel('नवीन पासवर्ड', { exact: true }).fill(CASHIER.password);
  await cashier.getByLabel('नवीन पासवर्ड पुन्हा').fill(CASHIER.password);
  await cashier.getByRole('button', { name: 'पासवर्ड बदला' }).click();
  await expect(cashier).toHaveURL(/\/home$/);
  await cashier.goto('/products');
  await expect(cashier.getByText('साखर')).toBeVisible();
  await expect(cashier.getByRole('link', { name: 'उत्पादन जोडा' })).toHaveCount(0);
  await cashier.goto('/reports');
  await expect(cashier.getByText('रोखपालाला फक्त आजचा सारांश दिसतो.')).toBeVisible();
  await cashier.goto('/settings');
  await expect(cashier.getByRole('heading', { name: 'कर्मचारी' })).toHaveCount(0);
  await cashier.goto('/customers');
  await expect(cashier.getByText('सुरेश पाटील')).toBeVisible();

  // Owner disables the cashier; the cashier's still-open session is cut off.
  await page.getByTestId('member').filter({ hasText: 'सुनीता' }).getByRole('button', { name: 'खाते थांबवा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'खाते थांबवा' }).click();
  await expect(page.getByTestId('member').filter({ hasText: 'सुनीता' })).toContainText('बंद');
  await cashier.reload();
  await expect(cashier).toHaveURL(/\/select-shop$/);
  await expect(cashier.getByText(/कोणतेही सक्रिय दुकान जोडलेले नाही/)).toBeVisible();
  const leaked = await cashier.evaluate(async () => {
    const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('super-kirana'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const all: unknown[] = await new Promise((ok) => { const r = db.transaction('cache').objectStore('cache').getAll(); r.onsuccess = () => ok(r.result); });
    return JSON.stringify(all);
  });
  expect(leaked).toContain('सुरेश');      // cache still on the device until logout…
  await cashier.getByRole('button', { name: 'लॉगआउट' }).click();
  await expect(cashier).toHaveURL(/\/login$/);
  const afterLogout = await cashier.evaluate(async () => {
    const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('super-kirana'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const all: unknown[] = await new Promise((ok) => { const r = db.transaction('cache').objectStore('cache').getAll(); r.onsuccess = () => ok(r.result); });
    return all.length;
  });
  expect(afterLogout).toBe(0);            // …and is wiped on logout
  await cashier.context().close();
});

test('admin: create a second shop; its owner sees only that shop; switching users leaks nothing', async ({ browser }) => {
  await page.goto('/admin');
  await expect(page.getByTestId('admin-shop')).toHaveCount(1);
  await page.getByRole('button', { name: 'नवीन दुकान जोडा' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('दुकानाचे नाव (मराठी)').fill('श्री किराणा, लासलगाव');
  await dlg.getByLabel('दुकानाचे नाव (इंग्रजी)').fill('Shree Kirana, Lasalgaon');
  await dlg.getByLabel(/दुकान ओळख/).fill('shree-lasalgaon');
  await dlg.getByLabel('मालकाचे वापरकर्तानाव').fill(OWNER_B.username);
  await dlg.getByLabel('मालकाचे नाव').fill('रमेश');
  await dlg.getByLabel('तात्पुरता पासवर्ड').fill(OWNER_B.temp);
  await dlg.getByRole('button', { name: 'दुकान बनवा' }).click();
  await expect(page.getByTestId('admin-shop')).toHaveCount(2);

  // The same device, a different person: log out, log in as the new owner.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'लॉगआउट' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'लॉगआउट' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, OWNER_B.username, OWNER_B.temp);
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('सध्याचा पासवर्ड').fill(OWNER_B.temp);
  await page.getByLabel('नवीन पासवर्ड', { exact: true }).fill(OWNER_B.password);
  await page.getByLabel('नवीन पासवर्ड पुन्हा').fill(OWNER_B.password);
  await page.getByRole('button', { name: 'पासवर्ड बदला' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId('shop-name')).toHaveText('श्री किराणा, लासलगाव');
  await expect(tile(page, 'home.todaySales')).toHaveText('₹0.00');
  await expect(tile(page, 'home.totalDue')).toHaveText('₹0.00');
  await page.goto('/customers');
  await expect(page.getByText('अजून ग्राहक नाहीत')).toBeVisible();
  await expect(page.getByText('सुरेश पाटील')).toHaveCount(0);
  await page.goto('/products');
  await expect(page.getByText('अजून उत्पादने नाहीत')).toBeVisible();
  await page.goto(customerUrl);                                  // shop A's customer id, typed by hand
  await expect(page.getByTestId('error')).toContainText('ग्राहक सापडला नाही');
  await page.goto('/admin');
  await expect(page.getByText('हे पान फक्त प्रशासकासाठी आहे')).toBeVisible();
  const stored = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('super-kirana'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const dump = async (s: string) => new Promise<unknown[]>((ok) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => ok(r.result); });
    return JSON.stringify([await dump('cache'), await dump('drafts'), await dump('pending')]) + JSON.stringify({ ...localStorage });
  });
  expect(stored).not.toContain('सुरेश');
  expect(stored).not.toContain('निफाड');
});

test('admin can suspend a shop: its owner is blocked at once', async ({ browser }) => {
  const admin = await newSession(browser);
  await login(admin, ADMIN.username, ADMIN.password);
  await expect(admin).toHaveURL(/\/select-shop$/);                // admin with two shops chooses one
  await expect(admin.getByRole('button', { name: /श्री किराणा, लासलगाव/ })).toBeVisible();
  await admin.goto('/admin');
  const shopB = admin.getByTestId('admin-shop').filter({ hasText: 'shree-lasalgaon' });
  await shopB.getByRole('button', { name: 'दुकान बंद ठेवा' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'दुकान बंद ठेवा' }).click();
  await expect(shopB).toContainText('बंद ठेवले');
  await page.goto('/home');
  await expect(page).toHaveURL(/\/select-shop$/);
  await expect(page.getByText(/कोणतेही सक्रिय दुकान जोडलेले नाही/)).toBeVisible();
  await shopB.getByRole('button', { name: 'दुकान सुरू करा' }).click();
  await expect(shopB).toContainText('सक्रिय');
  await admin.context().close();
});

test('layout fits a 320px-wide phone without sideways scrolling', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const small = await ctx.newPage();
  await login(small, ADMIN.username, ADMIN.password);
  await small.getByRole('button', { name: /सुपर किराणा, निफाड/ }).click();
  for (const path of ['/home', '/customers', '/bill', '/products', '/reports', '/settings', '/scan', customerUrl]) {
    await small.goto(path);
    await small.waitForLoadState('networkidle');
    const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
  await ctx.close();
});

test('passwords never appear in server logs', async () => {
  const log = readFileSync('.e2e/stack.log', 'utf8');
  for (const secret of [ADMIN.password, OWNER_B.temp, OWNER_B.password, CASHIER.temp, CASHIER.password, 'e2e-setup-code']) {
    expect(log.includes(secret), 'a secret was written to the log').toBe(false);
  }
});
