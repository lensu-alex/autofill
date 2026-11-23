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
