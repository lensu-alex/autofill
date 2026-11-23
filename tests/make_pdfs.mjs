// Two PDFs: a fillable form and a flat (printed) form with dotted/underscore blanks.
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, writeFileSync } from 'node:fs';

const font = readFileSync(new URL('../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf', import.meta.url));
const out = (n) => new URL('./fixtures/' + n, import.meta.url);

{ // fillable
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const f = await doc.embedFont(font, { subset: true });
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  const row = (label, name, y, w = 260) => {
    page.drawText(label, { x: 50, y: y + 5, size: 11, font: f });
    const tf = form.createTextField(name);
    tf.addToPage(page, { x: 200, y, width: w, height: 20 });
  };
  page.drawText('Formular de înscriere', { x: 50, y: 780, size: 18, font: f });
  row('Nume:', 'Nume', 700);
  row('Prenume:', 'Prenume', 670);
  row('CNP:', 'cnp_field', 640);
  row('Telefon:', 'Text1', 610); // generic name: must be found from the printed label
  row('Adresa de e-mail:', 'Text2', 580);
  row('Semnătura:', 'Semnatura', 520, 180);
  form.updateFieldAppearances(f);
  writeFileSync(out('fillable.pdf'), await doc.save());
}

{ // flat
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const f = await doc.embedFont(font, { subset: true });
  const page = doc.addPage([595, 842]);
  const t = (s, x, y, size = 11) => page.drawText(s, { x, y, size, font: f, color: rgb(0, 0, 0) });
  t('DECLARAȚIE PE PROPRIA RĂSPUNDERE', 150, 780, 14);
  t('Subsemnatul(a) ______________________________, CNP ______________________,', 50, 720);
  t('născut(ă) la data de ______________ în ____________________,', 50, 700);
  t('domiciliat(ă) în ____________________, str. ____________________ nr. ______,', 50, 680);
  t('posesor al CI seria ______ nr. ____________, eliberată de ____________________.', 50, 660);
  t('Telefon: .......................................    E-mail: .......................................', 50, 620);
  t('Data: ____________', 50, 520);
  t('Semnătura: ____________________', 330, 520);
  writeFileSync(out('flat.pdf'), await doc.save());
}
console.log('pdfs written');

{ // blanks drawn as lines, and a signature line with the caption under it
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const f = await doc.embedFont(font, { subset: true });
  const page = doc.addPage([595, 842]);
  const t = (s, x, y, size = 11) => page.drawText(s, { x, y, size, font: f });
  const line = (x0, x1, y) => page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 0.7 });
  t('Cerere de înscriere', 50, 780, 16);
  t('Nume și prenume', 50, 720); line(160, 450, 718);
  t('Data nașterii', 50, 690); line(160, 300, 688);
  t('E-mail', 50, 660); line(160, 450, 658);
  t('Observații', 50, 630); line(160, 450, 628);
  line(350, 520, 540); t('(semnătura)', 405, 528, 9);
  line(20, 575, 500); // page-wide decoration
  writeFileSync(out('lines.pdf'), await doc.save());
}

{ // tick boxes, radio buttons, a dropdown, CNP in 13 one-letter boxes
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const f = await doc.embedFont(font, { subset: true });
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  const t = (s, x, y, size = 11) => page.drawText(s, { x, y, size, font: f });
  t('Fișă de înscriere', 50, 780, 16);
  t('Sex:', 50, 720);
  const m = form.createCheckBox('cb1'); m.addToPage(page, { x: 100, y: 717, width: 12, height: 12 }); t('M', 116, 720);
  const fe = form.createCheckBox('cb2'); fe.addToPage(page, { x: 150, y: 717, width: 12, height: 12 }); t('F', 166, 720);
  t('Județul:', 50, 680);
  const dd = form.createDropdown('judet'); dd.addOptions(['Alba', 'Brașov', 'București', 'Cluj', 'Iași']); dd.addToPage(page, { x: 120, y: 675, width: 150, height: 18 });
  t('CNP:', 50, 640);
  for (let i = 0; i < 13; i++) { const c = form.createTextField('c' + i); c.setMaxLength(1); c.addToPage(page, { x: 100 + i * 18, y: 636, width: 16, height: 18 }); }
  t('Cetățenie:', 50, 600);
  const rg = form.createRadioGroup('cetatenie');
  rg.addOptionToPage('Română', page, { x: 130, y: 597, width: 12, height: 12 }); t('Română', 146, 600);
  rg.addOptionToPage('Alta', page, { x: 210, y: 597, width: 12, height: 12 }); t('Alta', 226, 600);
  t('Sunt de acord cu prelucrarea datelor', 70, 560);
  const ok = form.createCheckBox('acord'); ok.addToPage(page, { x: 50, y: 557, width: 12, height: 12 });
  form.updateFieldAppearances(f);
  writeFileSync(out('choices.pdf'), await doc.save());
}
