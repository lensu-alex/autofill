// Extra fields written in English match Romanian forms (and the other way round); typing in the list changes the value
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const root = fileURLToPath(new URL('..', import.meta.url));
const b = await chromium.launch();
const page = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1100 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + root + 'autofill.html');
await page.fill('#new-pw', 'test-password-1'); await page.fill('#new-pw2', 'test-password-1'); await page.press('#new-pw2', 'Enter');
await page.waitForSelector('#tab-info:not([hidden])');
await page.fill('[data-key="first_name"]', 'Ionuț');
const add = async (label, value, aliases = '') => {
  await page.click('#add-custom');
  const rows = page.locator('#custom-list .customrow');
  const r = rows.nth((await rows.count()) - 1);
  await r.locator('input').nth(0).fill(label); await r.locator('input').nth(1).fill(value); await r.locator('input').nth(2).fill(aliases);
};
await add('Scholarship type', 'Performanță');
await add('Coordinator teacher', 'Prof. Ana Ionescu');
await add('T-shirt size', 'M', 'mărimea tricoului');
await page.click('#save-vault');
await page.click('.tabs button[data-tab="fill"]');
await page.setInputFiles('#doc-file', root + 'tests/fixtures/custom-translate.txt');
await page.waitForSelector('#work[data-ready]');
const rows = await page.$$eval('#blank-list .row', (rs) => rs.map((r) => r.querySelector('.ctx').innerText.replace(/\s+/g, ' ').slice(-35) + ' => ' + r.querySelector('.val-edit').value));
console.log(rows.join('\n'));
// type a different value in the last row, then download and check the file
const box = page.locator('#blank-list .row .val-edit').nth(2);
await box.fill('L');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save-doc')]);
await dl.saveAs('/tmp/custom-out.txt');
console.log('--- file ---\n' + fs.readFileSync('/tmp/custom-out.txt', 'utf8'));
await page.locator('#blank-list .row .reset').nth(0).isVisible().then((v) => console.log('reset button shown after edit:', v));
await page.screenshot({ path: '/tmp/af-list.png', clip: { x: 0, y: 0, width: 1400, height: 700 } });
console.log('errors:', errors.length ? errors : 'none');
await b.close();
