// Drives autofill.html in a real browser: makes a vault, fills every fixture, saves the outputs.
// Run: node tests/e2e.mjs [chromium|webkit|firefox]
import { chromium, webkit, firefox } from 'playwright';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const engine = { chromium, webkit, firefox }[process.argv[2] || 'chromium'];
const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = root + 'tests/out/';
mkdirSync(OUT, { recursive: true });

const browser = await engine.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept('typed by hand'));
const click = (sel) => (process.argv[2] === 'webkit' ? page.locator(sel).first().dispatchEvent('click') : page.click(sel));
await page.goto('file://' + root + 'autofill.html');

// Create the vault
await page.fill('#new-pw', 'test-password-1');
await page.fill('#new-pw2', 'test-password-1');
await page.press('#new-pw2', 'Enter');
await page.waitForSelector('#tab-info:not([hidden])');
const info = {
  first_name: 'Ionuț', last_name: 'Popescu', cnp: '5010203123456', birth_date: '03.02.2001', birth_place: 'Brașov',
  street: 'Str. Florilor', street_number: '12', city: 'București', sector: '3', phone: '0722 123 456',
  email: 'ionut@example.ro', id_series: 'RT', id_number: '123456', id_issued_by: 'SPCLEP Sector 3',
  iban: 'RO49AAAA1B31007593840000', school: 'Universitatea din București',
  gender: 'M', county: 'Brașov', citizenship: 'română', id_issue_date: '10.05.2021', id_expiry_date: '03.02.2031',
};
for (const [k, v] of Object.entries(info)) await page.fill(`[data-key="${k}"]`, v);
// Draw a signature
await page.locator('#sigpad').scrollIntoViewIfNeeded();
const box = await page.locator('#sigpad').boundingBox();
await page.mouse.move(box.x + 40, box.y + 120); await page.mouse.down();
for (let i = 0; i <= 30; i++) await page.mouse.move(box.x + 40 + i * 12, box.y + 100 + Math.sin(i / 3) * 40);
await page.mouse.up();
if (process.argv[2] === 'webkit') await page.setInputFiles('#sig-file', root + 'tests/assets/signature-photo.jpg');
else await click('#sig-use');
await page.waitForFunction(() => App.vault.signature, null, { timeout: 5000 }).catch(async () => console.log('SIG FAIL', await page.locator('#toasts').innerText(), errors));
await click('#save-vault');
await click('.tabs button[data-tab="fill"]');

// argv[3]: a fixture name, or a folder (e.g. tests/real) to run every file in it
const arg = process.argv[3];
const dir = arg && statSync(arg, { throwIfNoEntry: false })?.isDirectory() ? arg.replace(/\/?$/, '/') : root + 'tests/fixtures/';
const files = arg && dir.endsWith('fixtures/') ? [arg] : readdirSync(dir).filter((f) => !f.startsWith('.') && !f.endsWith('.py'));
for (const f of files) {
  await page.setInputFiles('#doc-file', dir + f);
  try { await page.waitForSelector('#work[data-ready]', { timeout: 120000 }); }
  catch { console.log(`\n### ${f}: did not open`, await page.locator('#toasts').innerText()); continue; }
  const summary = await page.locator('#doc-summary').innerText();
  const rows = await page.$$eval('#blank-list .row', (rs) => rs.map((r) => {
    const s = r.querySelector('select');
    return `${r.className.replace('row ', '').padEnd(8)} ${r.querySelector('.ctx').innerText.replace(/\s+/g, ' ').slice(0, 70).padEnd(70)} => ${s.value || '-'} | ${r.querySelector('.val').innerText}`;
  }));
  console.log(`\n### ${f}  (${summary})`);
  rows.forEach((r) => console.log('  ' + r));
  if (await page.locator('#editor .pg').count()) await page.locator('#editor').screenshot({ path: OUT + f + '.png' });
  const [dl] = await Promise.all([page.waitForEvent('download'), click('#save-doc')]);
  await dl.saveAs(OUT + dl.suggestedFilename());
  console.log('  saved', dl.suggestedFilename());
  await click('#close-doc');
}

// Lock + unlock round trip
await click('#top-right button');
await page.waitForSelector('#unlock-card:not([hidden])');
await page.fill('#unlock-pw', 'wrong');
await page.press('#unlock-pw', 'Enter');
await page.waitForSelector('.toast.bad');
await page.fill('#unlock-pw', 'test-password-1');
await page.press('#unlock-pw', 'Enter');
await page.waitForSelector('#view-app:not([hidden])');
const back = await page.evaluate(() => App.values.first_name + ' / sig:' + !!App.vault.signature);
console.log('\nunlock round trip:', back);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
