// Backup file -> fresh browser -> unlock from file; change password.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const b = await chromium.launch();
const errors = [];
async function fresh() {
  const p = await (await b.newContext({ acceptDownloads: true })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('file://' + root + 'autofill.html');
  return p;
}
let p = await fresh();
await p.fill('#new-pw', 'first-pass-1'); await p.fill('#new-pw2', 'first-pass-1'); await p.press('#new-pw2', 'Enter');
await p.waitForSelector('#tab-info:not([hidden])');
await p.fill('[data-key="cnp"]', '5010203123456');
await p.click('#add-custom');
const ci = p.locator('#custom-list input');
await ci.nth(0).fill('Car plate'); await ci.nth(1).fill('B 123 ABC'); await ci.nth(2).fill('nr auto, numar inmatriculare');
await p.click('#save-vault');
await p.click('.tabs button[data-tab="settings"]');
await p.fill('#pw-cur', 'first-pass-1'); await p.fill('#pw-new', 'second-pass-2'); await p.fill('#pw-new2', 'second-pass-2');
await p.click('#pw-form button');
await p.waitForTimeout(1500);
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backup')]);
await dl.saveAs(root + 'tests/out/my-info.vault');
const raw = await (await import('node:fs')).promises.readFile(root + 'tests/out/my-info.vault', 'utf8');
console.log('vault file has plain CNP?', raw.includes('5010203123456'), '| has "Car plate"?', raw.includes('Car plate'));
// New browser with no stored vault: open the file
p = await fresh();
await p.click('#pick-vault2');
await p.setInputFiles('#vault-file', root + 'tests/out/my-info.vault');
await p.fill('#unlock-pw', 'first-pass-1'); await p.press('#unlock-pw', 'Enter');
await p.waitForSelector('.toast.bad'); console.log('old password rejected:', await p.locator('.toast.bad').first().innerText());
await p.fill('#unlock-pw', 'second-pass-2'); await p.press('#unlock-pw', 'Enter');
await p.waitForSelector('#view-app:not([hidden])');
console.log('restored:', await p.evaluate(() => JSON.stringify(App.values)));
// custom field is used for matching
await p.setInputFiles('#doc-file', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('Nr. auto: ________\nCNP: ____________\n') });
await p.waitForSelector('#work[data-ready]');
console.log('custom match:', await p.$$eval('#blank-list select', (s) => s.map((x) => x.value).join(', ')));
// Teach it: "Motivul cererii" -> occupation, then a new document with the same words gets it automatically
await p.click('#close-doc');
await p.setInputFiles('#doc-file', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('Motivul cererii: ____________\n') });
await p.waitForSelector('#work[data-ready]');
await p.fill('[data-key]', '').catch(() => {});
await p.selectOption('#blank-list select', 'cnp');
await p.click('#close-doc');
await p.setInputFiles('#doc-file', { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('Ceva\nMotivul cererii: ______\n') });
await p.waitForSelector('#work[data-ready]');
console.log('learned:', await p.$$eval('#blank-list select', (s) => s.map((x) => x.value).join(', ')), await p.evaluate(() => JSON.stringify(App.vault.learned)));
console.log('errors:', errors.length ? errors : 'none');
await b.close();
