// Fill documents and save them as other formats
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = root + 'tests/out/convert/';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const page = await (await b.newContext({ acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + root + 'autofill.html');
await page.fill('#new-pw', 'test-password-1'); await page.fill('#new-pw2', 'test-password-1'); await page.press('#new-pw2', 'Enter');
await page.waitForSelector('#tab-info:not([hidden])');
for (const [k, v] of Object.entries({ first_name: 'Ionuț', last_name: 'Popescu', cnp: '5010203123456', phone: '0722 123 456', email: 'ionut@example.ro', city: 'București', iban: 'RO49AAAA1B31007593840000' })) await page.fill(`[data-key="${k}"]`, v);
await page.setInputFiles('#sig-file', root + 'tests/assets/signature-photo.jpg');
await page.waitForFunction(() => App.vault.signature);
await page.click('#save-vault');
await page.click('.tabs button[data-tab="fill"]');
const files = process.argv[2] ? process.argv.slice(2) : ['cerere.docx', 'cerere.odt', 'inscriere.xlsx', 'slides.pptx', 'declaratie.txt', 'form.html', 'cerere.rtf', 'flat.pdf', 'scan2.jpg', 'english-application.docx'];
for (const f of files) {
  await page.setInputFiles('#doc-file', root + 'tests/fixtures/' + f);
  await page.waitForSelector('#work[data-ready]', { timeout: 120000 });
  const got = [];
  for (const t of ['pdf', 'docx', 'png', 'txt']) {
    if (await page.locator(`#save-as option[value="${t}"]`).evaluate((o) => o.hidden)) continue;
    await page.selectOption('#save-as', t);
    try {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#save-doc')]);
      await dl.saveAs(OUT + dl.suggestedFilename());
      got.push(dl.suggestedFilename() + ' ' + Math.round(fs.statSync(OUT + dl.suggestedFilename()).size / 1024) + 'KB');
    } catch (e) { got.push(t + ' FAILED: ' + (await page.locator('.toast.bad').last().innerText().catch(() => e.message))); }
  }
  console.log(f.padEnd(26), got.join(' | '));
  await page.click('#close-doc');
}
console.log('errors:', errors.length ? errors : 'none');
await b.close();
