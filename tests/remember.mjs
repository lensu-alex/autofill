// Answers you type are remembered: a new question becomes an extra field, a changed answer is kept for that wording
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const b = await chromium.launch();
const page = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + root + 'autofill.html');
await page.fill('#new-pw', 'test-password-1'); await page.fill('#new-pw2', 'test-password-1'); await page.press('#new-pw2', 'Enter');
await page.waitForSelector('#tab-info:not([hidden])');
await page.fill('[data-key="first_name"]', 'Ionuț'); await page.fill('[data-key="class_grade"]', 'II');
await page.click('#save-vault');
await page.click('.tabs button[data-tab="fill"]');
const open = async (name, text) => {
  await page.setInputFiles('#doc-file', { name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.waitForSelector('#work[data-ready]');
  return page.$$eval('#blank-list .row', (rs) => rs.map((r) => r.querySelector('.ctx').innerText.replace(/\s+/g, ' ').slice(-32) + ' => ' + (r.querySelector('.val-edit')?.value ?? '')));
};
console.log('first form:\n  ' + (await open('a.txt', 'Mărimea tricoului: ________\nAnul de studiu: ________\nNume: ________\n')).join('\n  '));
const boxes = page.locator('#blank-list .row .val-edit');
await boxes.nth(0).fill('M'); await boxes.nth(0).press('Enter');
await page.waitForTimeout(300);
await page.locator('#blank-list .row .val-edit').nth(1).fill('a II-a'); await page.locator('#blank-list .row .val-edit').nth(1).press('Enter');
await page.waitForTimeout(300);
await page.click('#close-doc');
console.log('second form (different wording):\n  ' + (await open('b.txt', 'Prenume: ________\nAnul de studii: ________\nMărimea tricourilor: ________\nT-shirt size: ________\n')).join('\n  '));
console.log('extra fields now:', await page.evaluate(() => JSON.stringify(App.vault.custom.map((c) => [c.label, c.value]))));
console.log('answers:', await page.evaluate(() => JSON.stringify(App.vault.answers)));
// survives locking
await page.click('#top-right button'); await page.waitForSelector('#unlock-card:not([hidden])');
await page.fill('#unlock-pw', 'test-password-1'); await page.press('#unlock-pw', 'Enter');
await page.waitForSelector('#view-app:not([hidden])');
console.log('after lock/unlock:', await page.evaluate(() => (App.vault.custom.length) + ' extra field(s), ' + App.vault.answers.length + ' answer(s)'));
console.log('errors:', errors.length ? errors : 'none');
await b.close();
