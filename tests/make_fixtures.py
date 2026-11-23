# Creates sample forms of every type in tests/fixtures.
# Run: uv run --with python-docx --with openpyxl --with python-pptx --with pillow tests/make_fixtures.py
import zipfile, io, os
from docx import Document
from docx.shared import Pt
from openpyxl import Workbook
from pptx import Presentation
from PIL import Image, ImageDraw, ImageFont

D = os.path.join(os.path.dirname(__file__), 'fixtures')
os.makedirs(D, exist_ok=True)

# --- Word: Romanian "cerere" with blanks, a split label, a table and a placeholder
doc = Document()
doc.add_heading('CERERE', 1)
p = doc.add_paragraph()
r = p.add_run('Subsemnatul(a) '); r.bold = True
p.add_run('______________________, CNP ______________, născut(ă) la data de __________, ')
p.add_run('domiciliat(ă) în ____________, str. ____________ nr. ____, telefon ______________, '
          'legitimat(ă) cu CI seria ____ nr. ________, vă rog să-mi aprobați cererea.')
doc.add_paragraph('Email: {{email}}')
doc.add_paragraph('Observații:')
t = doc.add_table(rows=3, cols=2)
t.style = 'Table Grid'
for i, lab in enumerate(['Nume', 'Prenume', 'IBAN']):
    t.cell(i, 0).text = lab
doc.add_paragraph('Data: ____________\t\tSemnătura: ____________')
doc.save(os.path.join(D, 'cerere.docx'))

# --- Excel
wb = Workbook(); ws = wb.active
ws['A1'] = 'Formular înscriere'
ws['A3'] = 'Nume și prenume'; ws['A4'] = 'CNP'; ws['A5'] = 'Telefon:'; ws['A6'] = 'Email'
ws['A8'] = 'Localitatea: ______________'
wb.save(os.path.join(D, 'inscriere.xlsx'))

# --- PowerPoint
pr = Presentation(); s = pr.slides.add_slide(pr.slide_layouts[1])
s.shapes.title.text = 'Prezentare {{full_name}}'
s.placeholders[1].text = 'Contact: ____________\nȘcoala: ____________'
pr.save(os.path.join(D, 'slides.pptx'))

# --- HTML form
open(os.path.join(D, 'form.html'), 'w').write('''<!doctype html><html><body>
<form><label for="fn">First name</label><input id="fn" name="firstName">
<label>Last name <input name="lname"></label>
<input name="email" type="email" placeholder="Email address">
<textarea name="address" aria-label="Home address"></textarea></form>
<p>I, ____________, born on __________, agree.</p><p>Signature: ____________</p>
</body></html>''')

# --- Text
open(os.path.join(D, 'declaratie.txt'), 'w').write(
    'DECLARAȚIE\n\nSubsemnatul ......................................., CNP .......................,\n'
    'cu domiciliul în ..............................................\nTelefon:\nData: ...............\n')

# --- Image of a form (scan-like) and a fake Pages file with a preview picture
img = Image.new('RGB', (1240, 1754), 'white'); g = ImageDraw.Draw(img)
try:
    f = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 34)
except Exception:
    f = ImageFont.load_default()
g.text((120, 150), 'Nume: ____________________', fill='black', font=f)
g.text((120, 250), 'Semnătura: _______________', fill='black', font=f)
img.save(os.path.join(D, 'scan.jpg'), quality=90)
buf = io.BytesIO(); img.resize((620, 877)).save(buf, 'JPEG')
with zipfile.ZipFile(os.path.join(D, 'note.pages'), 'w') as z:
    z.writestr('Index/Document.iwa', b'\x00')
    z.writestr('preview.jpg', buf.getvalue())
print('fixtures written')

# --- Word with content controls and a legacy FORMTEXT field
from docx.oxml import parse_xml
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
d = Document()
d.add_paragraph('Formular cu controale')
p = d.add_paragraph('Prenume: ')
p._p.append(parse_xml(f'<w:sdt {W}><w:sdtPr><w:alias w:val="Prenume"/><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Click or tap here to enter text.</w:t></w:r></w:sdtContent></w:sdt>'))
p = d.add_paragraph('Telefon: ')
p._p.append(parse_xml(f'<w:sdt {W}><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:t>Click or tap here to enter text.</w:t></w:r></w:sdtContent></w:sdt>'))
p = d.add_paragraph('CNP: ')
for x in [f'<w:r {W}><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Text1"/><w:enabled/><w:textInput/></w:ffData></w:fldChar></w:r>',
          f'<w:r {W}><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r>',
          f'<w:r {W}><w:fldChar w:fldCharType="separate"/></w:r>',
          f'<w:r {W}><w:t xml:space="preserve">     </w:t></w:r>',
          f'<w:r {W}><w:fldChar w:fldCharType="end"/></w:r>']:
    p._p.append(parse_xml(x))
d.add_paragraph('Semnătura:')
d.paragraphs[-1]._p.append(parse_xml(f'<w:sdt {W}><w:sdtPr><w:alias w:val="Semnătura"/><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:t>Semnați aici</w:t></w:r></w:sdtContent></w:sdt>'))
d.save(os.path.join(D, 'controls.docx'))
print('controls written')

# --- A realistic scan: 200 dpi, grey paper, noise, slightly tilted, dotted blanks
import random
random.seed(1)
W, H = 1654, 2339
im = Image.new('L', (W, H), 242)
g = ImageDraw.Draw(im)
fT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Times New Roman.ttf', 34)
fB = ImageFont.truetype('/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf', 40)
g.text((520, 200), 'DECLARAȚIE', fill=20, font=fB)
lines = [
    'Subsemnatul(a) ...................................................................., CNP ........................................,',
    'domiciliat(ă) în ......................................................., telefon ..........................................',
    'declar pe propria răspundere că datele de mai sus sunt corecte.',
]
y = 400
for ln in lines:
    g.text((150, y), ln, fill=25, font=fT); y += 70
g.text((150, 800), 'Data: ......................', fill=25, font=fT)
g.text((950, 800), 'Semnătura:', fill=25, font=fT)
g.line((1130, 835, 1480, 835), fill=30, width=3)
px = im.load()
for _ in range(60000):
    x, yy = random.randrange(W), random.randrange(H); px[x, yy] = max(0, px[x, yy] - random.randrange(40))
im = im.rotate(0.4, fillcolor=242, resample=Image.BICUBIC)
im.convert('RGB').save(os.path.join(D, 'scan2.jpg'), quality=70)
print('scan2 written')

# --- Multi-page TIFF (fax/scanner style) and a fake Numbers file
p1 = Image.new('L', (1240, 1754), 255); g1 = ImageDraw.Draw(p1)
fA = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 36)
g1.text((120, 200), 'Nume și prenume: ______________________', fill=0, font=fA)
p2 = Image.new('L', (1240, 1754), 255); g2 = ImageDraw.Draw(p2)
g2.text((120, 200), 'Telefon: ______________________', fill=0, font=fA)
p1.save(os.path.join(D, 'fax.tif'), save_all=True, append_images=[p2], compression='tiff_deflate')
with zipfile.ZipFile(os.path.join(D, 'sheet.numbers'), 'w') as z:
    z.writestr('Index/Document.iwa', b'\x00')
    z.writestr('preview.jpg', buf.getvalue())
print('tiff + numbers written')
