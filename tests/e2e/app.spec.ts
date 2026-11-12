// End-to-end tests: the real UI in a phone-sized browser, against the real SQL functions and the
// real edge functions (see tests/harness). One serial story, like a shopkeeper's first day.
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
async function changePassword(page: Page, from: string, to: string) {
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('सध्याचा पासवर्ड').fill(from);
  await page.getByLabel('नवीन पासवर्ड', { exact: true }).fill(to);
  await page.getByLabel('नवीन पासवर्ड पुन्हा').fill(to);
  await page.getByRole('button', { name: 'पासवर्ड बदला' }).click();
}
async function newSession(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}
async function idbDump(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('super-kirana'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const dump = async (s: string) => new Promise<unknown[]>((ok) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => ok(r.result); });
    return JSON.stringify([await dump('cache'), await dump('drafts'), await dump('pending')]);
  });
}
const pendingRow = (page: Page, name: string) => page.getByTestId('pending-list').getByRole('link', { name: new RegExp(name) });
let page: Page;
let customerUrl = '';

test.beforeAll(async ({ browser }) => { page = await newSession(browser); });

test('login screen is Marathi on first visit; language choice persists; errors are generic', async () => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'लॉगिन' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'पासवर्ड विसरलात?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('mr');
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Username')).toBeVisible();
  await page.getByRole('radio', { name: 'मराठी' }).click();
  await login(page, 'no-such-user', 'whatever123');
  await expect(page.getByTestId('error')).toHaveText('वापरकर्तानाव किंवा पासवर्ड चुकीचा आहे.');
});

test('first-run setup creates the admin as owner of the seeded shop; home has just two actions', async () => {
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
  await expect(page.getByTestId('shop-name')).toHaveText('सुपर किराणा, निफाड');
  await expect(page.getByRole('link', { name: /उधारी नोंदवा/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /फोटोवरून बिल/ })).toBeVisible();
  await expect(page.getByText('बाकी असलेले ग्राहक')).toBeVisible();
  await expect(page.getByText('कोणाकडेही बाकी नाही')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);           // no extra menus
  await page.goto('/setup');
  await expect(page.getByText('सेटअप आधीच पूर्ण झाला आहे')).toBeVisible();
});

test('A+B: new customer with ₹500 old dues; ₹315 bill with ₹200 paid → ₹615 total; receipt from server', async () => {
  await page.goto('/home');
  await page.getByRole('link', { name: /उधारी नोंदवा/ }).click();
  await page.getByRole('button', { name: 'नवीन ग्राहक' }).click();
  await page.getByLabel('ग्राहकाचे नाव').fill('सुरेश पाटील');
  await page.getByLabel(/मोबाईल नंबर/).fill('9876543210');
  await page.getByLabel(/सुरुवातीची बाकी/).fill('500');
  await page.getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(page.getByTestId('ud-customer')).toContainText('सुरेश पाटील');
  await page.getByRole('button', { name: 'उधारी सेव्ह करा' }).click();
  await expect(page.getByText('बिलाची रक्कम लिहा')).toBeVisible();          // amount is required
  await page.getByLabel('बिलाची रक्कम').fill('315');
  await page.getByLabel(/काय घेतले/).fill('किराणा');
  await page.getByLabel('आत्ता दिलेले पैसे').fill('200');
  await expect(page.getByTestId('ud-total')).toHaveText('₹615.00');
  await page.getByRole('button', { name: 'उधारी सेव्ह करा' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('₹500.00');
  await expect(dlg).toContainText('₹615.00');
  await dlg.getByRole('button', { name: 'उधारी सेव्ह करा' }).click();
  await expect(page).toHaveURL(/\/bills\//);
  const receipt = page.getByTestId('receipt');
  await expect(receipt).toContainText('सुपर किराणा, निफाड');
  await expect(receipt).toContainText('किराणा');
  await expect(page.getByTestId('receipt-total')).toHaveText('₹315.00');
  await expect(page.getByTestId('receipt-balance')).toHaveText('₹615.00');

  // L: switching language changes words, never amounts.
  const amountsMr = (await receipt.innerText()).match(/₹[\d,]+\.\d{2}/g);
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'English' }).click();
  await page.goBack();
  await expect(page.getByTestId('receipt')).toContainText('Super Kirana, Niphad');
  expect((await page.getByTestId('receipt').innerText()).match(/₹[\d,]+\.\d{2}/g)).toEqual(amountsMr);
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'मराठी' }).click();
  await page.goto('/home');
  await expect(pendingRow(page, 'सुरेश पाटील')).toContainText('₹615.00');
  await pendingRow(page, 'सुरेश पाटील').click();
  await expect(page.getByTestId('customer-balance')).toHaveText('₹615.00');
  customerUrl = new URL(page.url()).pathname;
});

test('usability: English letters find Marathi names, duplicates are caught, amounts shown in words, WhatsApp reminder', async () => {
  await page.goto('/home');
  await page.getByPlaceholder('ग्राहक शोधा').fill('suresh');
  await expect(pendingRow(page, 'सुरेश पाटील')).toBeVisible();
  await expect(pendingRow(page, 'सुरेश पाटील')).toContainText('शेवटचा व्यवहार: आज');
  await page.getByPlaceholder('ग्राहक शोधा').fill('98765 43210');
  await expect(pendingRow(page, 'सुरेश पाटील')).toBeVisible();

  await page.goto('/udhari');
  await page.getByRole('button', { name: 'नवीन ग्राहक' }).click();
  await page.getByLabel('ग्राहकाचे नाव').fill('Suresh Patil');
  await page.getByLabel(/मोबाईल नंबर/).fill('98765 43210');
  await page.getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(page.getByText(/या मोबाईल नंबरचा ग्राहक आधीच आहे: सुरेश पाटील/)).toBeVisible();
  await page.getByLabel(/मोबाईल नंबर/).fill('');
  await page.getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(page.getByText(/"सुरेश पाटील" नावाचा ग्राहक आधीच आहे/)).toBeVisible();
  await page.getByRole('button', { name: /तोच ग्राहक वापरा/ }).click();
  await expect(page.getByTestId('ud-customer')).toContainText('सुरेश पाटील');
  await page.getByLabel('बिलाची रक्कम').fill('1250');
  await expect(page.getByTestId('amount-words').first()).toHaveText('एक हजार दोनशे पन्नास रुपये');
  await page.getByRole('button', { name: 'पूर्ण पैसे दिले' }).click();
  await expect(page.getByLabel('आत्ता दिलेले पैसे')).toHaveValue('1250');
  await expect(page.getByTestId('ud-total')).toHaveText('₹615.00');
  await page.getByRole('button', { name: 'काहीच दिले नाही' }).click();
  await expect(page.getByTestId('ud-total')).toHaveText('₹1,865.00');

  await page.goto(customerUrl);
  const remind = page.getByTestId('remind');
  await expect(remind).toHaveText(/WhatsApp वर आठवण पाठवा/);
  const href = decodeURIComponent((await remind.getAttribute('href')) ?? '');
  expect(href).toContain('https://wa.me/919876543210?text=');
  expect(href).toContain('₹615.00');
  expect(href).toContain('सुपर किराणा, निफाड');
});

test('E: collecting old dues lowers the balance and does not add to sales; overpayment is refused', async () => {
  await page.goto(customerUrl);
  await page.getByRole('link', { name: 'पैसे जमा करा' }).click();
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
  await page.goto('/reports');                                         // owner report, by URL
  await expect(page.getByTestId('net-sales')).toHaveText('₹315.00');
  await expect(page.getByTestId('net-collected')).toHaveText('₹600.00');
  await page.goto('/home');
  await expect(pendingRow(page, 'सुरेश पाटील')).toContainText('₹215.00');
});

test('N: a lost connection never shows "saved"; status lookup with the same key resolves it exactly once', async () => {
  await page.goto(`${customerUrl}/pay`);
  await page.route('**/rest/v1/rpc/receive_payment', (r) => r.abort('connectionfailed'));
  await page.getByLabel('जमा रक्कम').fill('15');
  await page.getByRole('button', { name: 'जमा नोंदवा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'जमा नोंदवा' }).click();
  await expect(page.getByTestId('unknown-outcome')).toContainText('नोंद झाली की नाही हे माहीत नाही');
  await expect(page.getByText('पैसे जमा झाले')).toHaveCount(0);
  await page.unroute('**/rest/v1/rpc/receive_payment');
  await page.getByRole('button', { name: 'स्थिती तपासा' }).click();
  await expect(page.getByText('सर्व्हरवर ही नोंद नाही')).toBeVisible();
  await page.getByRole('button', { name: /पुन्हा पाठवा/ }).click();
  await expect(page.getByTestId('payment-balance')).toHaveText('₹200.00');

  // Posted on the server but the answer was lost: checking finds it; nothing is posted twice.
  await page.goto(`${customerUrl}/pay`);
  await page.route('**/rest/v1/rpc/receive_payment', async (r) => { await r.fetch(); await r.abort('connectionfailed'); });
  await page.getByLabel('जमा रक्कम').fill('20');
  await page.getByRole('button', { name: 'जमा नोंदवा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'जमा नोंदवा' }).click();
  await expect(page.getByTestId('unknown-outcome')).toBeVisible();
  await page.unroute('**/rest/v1/rpc/receive_payment');
  await page.goto('/sync');
  await expect(page.getByTestId('pending-row').first()).toContainText('स्थिती माहीत नाही');
  await page.getByTestId('pending-row').first().getByRole('button', { name: 'स्थिती तपासा' }).click();
  await expect(page.getByTestId('pending-row').first()).toContainText('सर्व्हरवर नोंदले');
  await page.goto(customerUrl);
  await expect(page.getByTestId('customer-balance')).toHaveText('₹180.00');
});

test('the same credit bill submitted after a lost answer is saved once', async () => {
  await page.goto(`/udhari?customer=${customerUrl.split('/').pop()}`);
  await page.getByLabel('बिलाची रक्कम').fill('50');
  await page.route('**/rest/v1/rpc/create_invoice', async (r) => { await r.fetch(); await r.abort('connectionfailed'); });
  await page.getByRole('button', { name: 'उधारी सेव्ह करा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'उधारी सेव्ह करा' }).click();
  await expect(page.getByTestId('unknown-outcome')).toBeVisible();
  await page.unroute('**/rest/v1/rpc/create_invoice');
  await page.getByRole('button', { name: 'स्थिती तपासा' }).click();
  await expect(page).toHaveURL(/\/bills\//);
  await expect(page.getByTestId('receipt-balance')).toHaveText('₹230.00');
  await page.goto(customerUrl);
  await expect(page.getByTestId('customer-balance')).toHaveText('₹230.00');
});

test('offline: the pending list stays visible and saving is blocked', async () => {
  await page.goto('/home');
  await expect(pendingRow(page, 'सुरेश पाटील')).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.getByText('इंटरनेट उपलब्ध नाही').first()).toBeVisible();
  await page.getByRole('link', { name: /उधारी नोंदवा/ }).click();
  await page.getByRole('button', { name: /सुरेश पाटील/ }).click();
  await page.getByLabel('बिलाची रक्कम').fill('10');
  await expect(page.getByRole('button', { name: 'उधारी सेव्ह करा' })).toBeDisabled();
  await expect(page.getByText(/बिल आत्ता नोंदता येणार नाही/)).toBeVisible();
  await page.context().setOffline(false);
});

test('photo → OCR.space (stand-in) → every line reviewed → bill draft → saved bill', async () => {
  // A product in the catalogue lets OCR suggest its saved price.
  await page.goto('/products/new');
  await page.getByLabel('उत्पादनाचे नाव').fill('साखर');
  await page.getByLabel('माप').selectOption('kg');
  await page.getByLabel(/दर प्रति/).fill('42');
  await page.getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(page).toHaveURL(/\/products$/);

  const shot = await newSession(page.context().browser()!);
  await shot.setViewportSize({ width: 600, height: 300 });
  await shot.setContent('<body style="margin:0;background:#fff;font:32px sans-serif;padding:24px">a photo of a handwritten list</body>');
  const png = await shot.screenshot();
  await shot.context().close();

  await page.goto('/home');
  await page.getByRole('link', { name: /फोटोवरून बिल/ }).click();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'list.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'यादी वाचा' }).click();
  const add = page.getByRole('button', { name: 'बिलात जोडा' });
  await expect(add).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('क्लाउड वाचन (हस्ताक्षरासाठी)')).toBeVisible();
  await expect(add).toBeDisabled();
  await expect(page.getByText('आधी 3 ओळी तपासा')).toBeVisible();
  const card = page.getByTestId('ocr-stepper').getByTestId('ocr-item');
  // 1: no price written → saved catalogue price suggested; must be accepted.
  await expect(card.getByLabel('वस्तूचे नाव')).toHaveValue('साखर');
  await expect(card).toContainText('सेव्ह केलेला दर सुचवला आहे');
  await expect(card.getByLabel(/दर/)).toHaveValue('42');
  await card.getByLabel('तपासले').check();
  // 2: price written on the list.
  await page.getByRole('button', { name: 'पुढे' }).click();
  await expect(card.getByLabel('वस्तूचे नाव')).toHaveValue('तेल');
  await expect(card.getByLabel(/दर/)).toHaveValue('140');
  await card.getByLabel('तपासले').check();
  // 3: no price anywhere → cannot be ticked until the shopkeeper types it.
  await page.getByRole('button', { name: 'पुढे' }).click();
  await expect(card.getByLabel('वस्तूचे नाव')).toHaveValue('बिस्किट');
  await expect(card.getByLabel('तपासले')).toBeDisabled();
  await card.getByLabel(/दर/).fill('10');
  await card.getByLabel('तपासले').check();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page).toHaveURL(/\/bill$/);
  await expect(page.getByTestId('bill-line')).toHaveCount(3);
  await expect(page.getByTestId('bill-total')).toHaveText('₹254.00');        // 2×42 + 1×140 + 3×10
  await page.getByTestId('pick-customer').click();
  await page.getByRole('dialog').getByRole('button', { name: /सुरेश पाटील/ }).click();
  await page.getByRole('button', { name: 'उधार (₹0)' }).click();
  await page.getByRole('button', { name: 'बिल तपासा' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'बिल सेव्ह करा' }).click();
  await expect(page.getByTestId('receipt')).toContainText('फोटोवरून');
  await expect(page.getByTestId('receipt-balance')).toHaveText('₹484.00');
});

test('if cloud OCR is unreachable, the on-device reader is used for printed text', async ({ browser }) => {
  test.setTimeout(180_000);
  const shot = await newSession(browser);
  await shot.setViewportSize({ width: 900, height: 420 });
  await shot.setContent('<body style="margin:0;background:#fff;font:700 54px Arial,sans-serif;padding:36px;line-height:1.7">Sugar 2 kg @ 42<br>Rice 5 kg = 300</body>');
  const png = await shot.screenshot();
  await shot.context().close();
  await page.route('**/functions/v1/ocr', (r) => r.abort('connectionfailed'));
  await page.goto('/scan');
  await page.getByTestId('gallery-input').setInputFiles({ name: 'list.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'यादी वाचा' }).click();
  await expect(page.getByRole('button', { name: 'बिलात जोडा' })).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText('फोनवर वाचन (छापील मजकुरासाठी)')).toBeVisible();
  const first = page.getByTestId('ocr-stepper').getByTestId('ocr-item');
  await expect(first.getByLabel('वस्तूचे नाव')).toHaveValue(/sugar/i);
  await expect(first.getByLabel(/दर/)).toHaveValue('42');
  await page.unroute('**/functions/v1/ocr');
});

test('owner correction: reversing a payment restores the balance and the ledger still agrees', async () => {
  await page.goto(`${customerUrl}/ledger`);
  await page.getByRole('link', { name: /पैसे जमा.*UPI/ }).first().click();
  await page.getByRole('button', { name: 'जमा रद्द करा' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'जमा रद्द करा' }).click();
  await expect(dlg.getByTestId('error')).toContainText('कारण लिहा');
  await dlg.getByLabel('कारण').fill('चुकीची नोंद');
  await dlg.getByRole('button', { name: 'जमा रद्द करा' }).click();
  await expect(page.getByText('ही जमा रद्द केली आहे')).toBeVisible();
  await page.goto(customerUrl);
  await expect(page.getByTestId('customer-balance')).toHaveText('₹884.00');
  await expect(page.getByText('खाते तपासले — हिशोब जुळतो')).toBeVisible();
});

test('admin adds a cashier to a shop; cashier changes password, can record credit, is cut off when disabled', async ({ browser }) => {
  await page.goto('/settings');
  await page.getByRole('link', { name: /प्रशासन/ }).click();
  await expect(page.getByText(/कोणत्याही दुकानाचे बिल किंवा पैसे प्रशासकाला दिसत नाहीत/)).toBeVisible();
  const shopA = page.getByTestId('admin-shop').filter({ hasText: 'superkirana-niphad' });
  await shopA.getByRole('button', { name: /मालक \/ कर्मचारी जोडा/ }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('radio', { name: 'रोखपाल' }).click();
  await dlg.getByLabel('वापरकर्तानाव').fill(CASHIER.username);
  await dlg.getByLabel('नाव', { exact: true }).fill('सुनीता');
  await dlg.getByLabel('तात्पुरता पासवर्ड').fill(CASHIER.temp);
  await dlg.getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(shopA.getByTestId('admin-member').filter({ hasText: 'सुनीता' })).toContainText('पासवर्ड बदलणे बाकी');

  const cashier = await newSession(browser);
  await login(cashier, CASHIER.username, CASHIER.temp);
  await changePassword(cashier, CASHIER.temp, CASHIER.password);
  await expect(cashier).toHaveURL(/\/home$/);
  await expect(pendingRow(cashier, 'सुरेश पाटील')).toBeVisible();
  await cashier.getByRole('link', { name: /उधारी नोंदवा/ }).click();
  await cashier.getByRole('button', { name: /सुरेश पाटील/ }).click();
  await cashier.getByLabel('बिलाची रक्कम').fill('16');
  await cashier.getByRole('button', { name: 'उधारी सेव्ह करा' }).click();
  await cashier.getByRole('dialog').getByRole('button', { name: 'उधारी सेव्ह करा' }).click();
  await expect(cashier.getByTestId('receipt-balance')).toHaveText('₹900.00');
  await expect(cashier.getByRole('button', { name: 'बिल रद्द करा' })).toHaveCount(0);   // cashiers cannot reverse

  // Admin disables the cashier; the cashier's open session is cut off.
  await shopA.getByTestId('admin-member').filter({ hasText: 'सुनीता' }).click();
  await page.getByRole('dialog').getByLabel('खाते सुरू आहे').uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(shopA.getByTestId('admin-member').filter({ hasText: 'सुनीता' })).toContainText('बंद');
  await cashier.reload();
  await expect(cashier).toHaveURL(/\/select-shop$/);
  await expect(cashier.getByText(/कोणतेही सक्रिय दुकान जोडलेले नाही/)).toBeVisible();
  await cashier.getByRole('button', { name: 'लॉगआउट' }).click();
  await expect(cashier).toHaveURL(/\/login$/);
  expect(await idbDump(cashier)).toBe('[[],[],[]]');                // device data wiped on logout
  await cashier.context().close();
});

test('admin creates a second shop and updates its owner; that owner sees only their own shop', async () => {
  await page.goto('/admin');
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
  const shopB = page.getByTestId('admin-shop').filter({ hasText: 'shree-lasalgaon' });
  await expect(shopB.getByRole('link')).toHaveCount(0);              // no way into another shop's money
  await shopB.getByTestId('admin-member').filter({ hasText: 'रमेश' }).click();
  await page.getByRole('dialog').getByLabel('नाव', { exact: true }).fill('रमेश जाधव');
  await page.getByRole('dialog').getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(shopB.getByTestId('admin-member')).toContainText('रमेश जाधव');

  await page.goto('/settings');
  await page.getByRole('button', { name: 'लॉगआउट' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'लॉगआउट' }).click();
  await login(page, OWNER_B.username, OWNER_B.temp);
  await changePassword(page, OWNER_B.temp, OWNER_B.password);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId('shop-name')).toHaveText('श्री किराणा, लासलगाव');
  await expect(page.getByText('कोणाकडेही बाकी नाही')).toBeVisible();
  await expect(page.getByText('सुरेश पाटील')).toHaveCount(0);
  await page.goto(customerUrl);                                        // shop A's customer id, typed by hand
  await expect(page.getByTestId('error')).toContainText('ग्राहक सापडला नाही');
  await page.goto('/admin');
  await expect(page.getByText('हे पान फक्त प्रशासकासाठी आहे')).toBeVisible();
  const stored = (await idbDump(page)) + JSON.stringify(await page.evaluate(() => ({ ...localStorage })));
  expect(stored).not.toContain('सुरेश');
  expect(stored).not.toContain('निफाड');
});

test('admin can switch a shop off and on: its owner is blocked at once', async ({ browser }) => {
  const admin = await newSession(browser);
  await login(admin, ADMIN.username, ADMIN.password);
  await expect(admin).toHaveURL(/\/home$/);                            // admin is a member of one shop only
  await admin.goto('/admin');
  const shopB = admin.getByTestId('admin-shop').filter({ hasText: 'shree-lasalgaon' });
  await shopB.getByRole('button', { name: 'माहिती बदला' }).click();
  await admin.getByRole('dialog').getByLabel('दुकान सुरू आहे').uncheck();
  await admin.getByRole('dialog').getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(shopB).toContainText('बंद ठेवले');
  await page.goto('/home');
  await expect(page).toHaveURL(/\/select-shop$/);
  await expect(page.getByText(/कोणतेही सक्रिय दुकान जोडलेले नाही/)).toBeVisible();
  await shopB.getByRole('button', { name: 'माहिती बदला' }).click();
  await admin.getByRole('dialog').getByLabel('दुकान सुरू आहे').check();
  await admin.getByRole('dialog').getByRole('button', { name: 'सेव्ह करा' }).click();
  await expect(shopB).toContainText('सक्रिय');
  await admin.context().close();
});

test('layout fits a 320px-wide phone without sideways scrolling', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const small = await ctx.newPage();
  await login(small, ADMIN.username, ADMIN.password);
  await expect(small).toHaveURL(/\/home$/);
  for (const path of ['/home', '/udhari', `/udhari?customer=${customerUrl.split('/').pop()}`, '/scan', '/bill', '/settings', customerUrl, `${customerUrl}/pay`, '/admin']) {
    await small.goto(path);
    await small.waitForLoadState('networkidle');
    const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
  await ctx.close();
});

test('passwords and the OCR key never appear in server logs', async () => {
  const log = readFileSync('.e2e/stack.log', 'utf8');
  for (const secret of [ADMIN.password, OWNER_B.temp, OWNER_B.password, CASHIER.temp, CASHIER.password, 'e2e-setup-code', 'test-ocr-key']) {
    expect(log.includes(secret), 'a secret was written to the log').toBe(false);
  }
});
