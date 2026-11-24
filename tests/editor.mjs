// Clicks on a scanned picture to place info, drags it, exports PNG + PDF.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const b = await chromium.launch();
const page = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept('Clasa a XII-a B'));
await page.goto('file://' + root + 'autofill.html');
await page.fill('#new-pw', 'test-password-1'); await page.fill('#new-pw2', 'test-password-1'); await page.press('#new-pw2', 'Enter');
await page.waitForSelector('#tab-info:not([hidden])');
await page.fill('[data-key="first_name"]', 'Ionuț'); await page.fill('[data-key="last_name"]', 'Popescu');
await page.setInputFiles('#sig-file', root + 'tests/assets/signature-photo.jpg');
await page.waitForFunction(() => App.vault.signature);
await page.click('.tabs button[data-tab="fill"]');
await page.setInputFiles('#doc-file', root + 'tests/fixtures/scan.jpg');
await page.waitForSelector('#work[data-ready]');
console.log('notice:', await page.locator('#notice').innerText());
const layer = page.locator('.pg .layer').first();
const bb = await layer.boundingBox();
const sx = bb.width / 1240; // picture px -> screen px
// "Nume: ____" is at x=120..,y=150 in the picture; put the name after it
await page.mouse.click(bb.x + 300 * sx, bb.y + 700 * sx);
await page.selectOption('.addmenu select', 'full_name');
// Signature after "Semnătura:"
await page.mouse.click(bb.x + 600 * sx, bb.y + 900 * sx);
await page.selectOption('.addmenu select', 'signature');
// Custom text somewhere
await page.mouse.click(bb.x + 200 * sx, bb.y + 1100 * sx);
await page.selectOption('.addmenu select', '__text');
// Drag the added name 30px right, then nudge it with the keyboard and delete the custom text
const name = page.locator('.ov.text', { hasText: 'Ionuț Popescu' }).last();
const nb = await name.boundingBox();
await page.mouse.move(nb.x + 5, nb.y + 5); await page.mouse.down();
await page.mouse.move(nb.x + 35, nb.y + 5, { steps: 5 }); await page.mouse.up();
await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowUp');
const before = await page.evaluate(() => App.sess.blanks.length);
await page.locator('.ov.text', { hasText: 'Clasa' }).click();
await page.keyboard.press('Delete');
console.log('delete key removed:', before - (await page.evaluate(() => App.sess.blanks.length)));
console.log('items:', await page.evaluate(() => App.sess.blanks.map((b) => `${b.key}@${Math.round(b.x)},${Math.round(b.y)}`).join('  ')));
console.log('summary:', await page.locator('#doc-summary').innerText());
await page.locator('#editor').screenshot({ path: root + 'tests/out/editor-scan.png' });
const [png] = await Promise.all([page.waitForEvent('download'), page.click('#save-png')]);
await png.saveAs(root + 'tests/out/' + png.suggestedFilename());
const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('#save-doc')]);
await pdf.saveAs(root + 'tests/out/' + pdf.suggestedFilename());
console.log('saved', png.suggestedFilename(), pdf.suggestedFilename());
// Pages file
await page.click('#close-doc');
await page.setInputFiles('#doc-file', root + 'tests/fixtures/note.pages');
await page.waitForSelector('#work[data-ready]');
console.log('pages notice:', (await page.locator('#notice').innerText()).slice(0, 80));
console.log('errors:', errors.length ? errors : 'none');
await b.close();
