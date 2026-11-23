# AutoFill

One HTML file that fills any document with your personal information and signature.
Your info lives in an encrypted vault (AES-256-GCM, key from your password via PBKDF2-SHA256, 600k rounds).
The page has no network access at all (Content-Security-Policy `default-src 'none'`), so nothing leaves the computer.

**Use it:** open `autofill.html` in Chrome, Safari, Edge or Firefox → create a vault → fill in *My information* and your signature → drop a document on *Fill a document* → check the blanks → *Download filled file*.

## What it fills

| File | How |
|---|---|
| PDF with fillable fields | fills the fields (finds the printed label next to boxes named "Text1") |
| PDF without fields | finds `____`, `……`, `Nume:` + gap, and blanks drawn as lines; writes on top, hides the dots |
| Scans / photos (jpg, png, heic…) | click on the page to place things; download PDF or PNG |
| Word `.docx` | `____` blanks, `{{placeholders}}`, table "label / empty cell", content controls, old form fields, signature as a picture |
| OpenDocument `.odt` | same as Word |
| Excel `.xlsx` | label cell → empty cell to the right/below, blanks inside cells |
| PowerPoint `.pptx` | blanks and placeholders in slides |
| HTML | form inputs (by label/name/placeholder) and text blanks |
| Text `.txt .md .csv .rtf` | blanks and placeholders |
| Pages | only the preview picture inside the file (page 1). Better: export to Word/PDF in Pages first |

Labels are understood in Romanian and English (`fields.js`). Ambiguous ones use context:
`nr.` after `seria` = ID number, after `str.` = street number; `data` near `eliberat` = issue date, else today's date.
Custom fields can have extra names ("Also called").

## Develop

```
npm install
node build.mjs              # src/ -> autofill.html (single file, ~3.6 MB)
node tests/make_pdfs.mjs    # + uv run --with python-docx --with openpyxl --with python-pptx --with pillow tests/make_fixtures.py
node tests/e2e.mjs chromium # or webkit; outputs in tests/out/
node tests/editor.mjs; node tests/vault.mjs
```

Code: `src/js/engine.js` finds blanks in text, `fields.js` maps labels to your info, `fmt-*.js` per file type, `vault.js` encryption, `app.js` the UI.
Libraries (bundled): pdf.js 3.11 (with eval disabled), pdf-lib, fontkit, JSZip, DejaVu Sans font.
