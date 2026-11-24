# AutoFill

Fills any document with your personal information and signature, from an encrypted vault that never leaves your computer.

- **`autofill.html`**: open it in Chrome, Safari, Edge or Firefox. One file, works offline, no internet access at all (Content-Security-Policy).
- **`autofill-smart.js`** (optional, ~106 MB): put it next to the HTML to turn on *smart matching*, a small multilingual AI model that runs on your computer.
- **`dist/AutoFill.app`** (optional): the same thing as a Mac app, which can also ask Pages, Numbers and Keynote to convert their files.

## How to use

1. Open `autofill.html` → create a vault with a password (there is no reset, so keep a backup: Settings → Download my-info.vault).
2. *My information*: fill in what you want, draw or upload your signature, Save.
3. *Fill a document*: drop a file (or several at once → one zip). Check the list on the right, change anything, drag things on the page, click the page to add more.
4. *Download filled file*. The original is never changed.

## What it can fill

| File | How |
|---|---|
| PDF with fillable fields | text boxes, tick boxes (☐ M ☐ F), option buttons, dropdowns, CNP in 13 one-letter boxes, dates in 3 boxes; Adobe XFA leftovers removed |
| PDF without fields | `____`, `……`, `Nume:` + gap, blanks drawn as lines, `|__|__|` character boxes, drawn tables (label cell → empty cell) |
| Scans and photos (jpg, png, heic, tiff, webp, avif…) | read offline with OCR (Romanian + English); dotted and solid lines found in the picture; multi-page TIFF |
| Word `.docx` and old `.doc` | blanks, `{{placeholders}}`, tables, content controls, old form fields, signature as a picture (`.doc` is converted, layout simplified) |
| OpenDocument `.odt` `.ods` `.odp` | same as Word; spreadsheet cells |
| Excel `.xlsx`, PowerPoint `.pptx` | label cell → empty cell; blanks in cells and slides |
| HTML, text, Markdown, CSV, RTF | form inputs and text blanks; old encodings (ISO-8859-2, Windows-1250) |
| Pages, Numbers, Keynote | browser: preview picture of page 1. Mac app: converted by the Apple app, filled, converted back |

## How it decides what goes where

1. **Rules**: Romanian and English wording (`src/js/fields.js`), with context. `nr.` after `seria` is the ID number, after `str.` the street number; `ziua/luna/anul` after `născut` are birth date parts; "(cu majuscule)" gives CAPITALS; sections like "DATE PRIVIND COPIII MINORI" or "Requester's name" are about someone else and are left empty.
2. **Similarity** (`similarity.js`): letter-trigram TF-IDF against many phrasings (RO/EN/FR/DE/IT/ES) for typos, scan misreads and word endings.
3. **Smart matching** (optional, `smart.js` + `autofill-smart.js`): paraphrase-multilingual-MiniLM-L12-v2 embeddings for question-style labels ("Where do you live?"). Only trusted when one field clearly wins.
4. **What you teach it**: when you correct a blank, the words before it are remembered (encrypted, in the vault).

Guesses are marked "≈ please check" in the list.

Also derived: full name (choose the order), full address from its parts, age, birth date and sex from the CNP, today's date (choose the format).

## Security

Vault = AES-256-GCM, key from your password with PBKDF2-SHA256 (600,000 rounds), WebCrypto. The page cannot make network requests. Auto-lock after inactivity (Settings). pdf.js runs with eval disabled.

## Develop

```
npm install
node build.mjs                 # src/ -> autofill.html (~15 MB, OCR engine and languages inside)
node build-smart.mjs           # optional: model files in smart/download -> autofill-smart.js
./app/build-app.sh             # optional: dist/AutoFill.app
```

Model files for the add-on (free, from Hugging Face `Xenova/paraphrase-multilingual-MiniLM-L12-v2`): `config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`, `onnx/model_quantized.onnx` into `smart/download/`.

Tests (Playwright):
```
node tests/make_pdfs.mjs
uv run --with python-docx --with openpyxl --with python-pptx --with pillow tests/make_fixtures.py
node tests/e2e.mjs chromium     # or webkit; every file in tests/fixtures, outputs in tests/out
node tests/e2e.mjs chromium tests/real   # any folder of real forms
node tests/editor.mjs; node tests/vault.mjs
```

Code map: `engine.js` finds blanks in text; `fields.js` field list, rules, derived values; `fmt-pdf.js` PDF/images/editor; `ocr.js` scans; `fmt-office.js` docx/odt/xlsx/pptx; `fmt-doc.js` old .doc; `fmt-text.js` text/HTML; `vault.js` encryption; `app.js` screens. Libraries: pdf.js, pdf-lib, fontkit, JSZip, Tesseract.js, UTIF, pako, libheif, transformers.js (add-on), DejaVu Sans font.
