# Handoff

**State (2026-11-24):** working. `autofill.html` is built from `src/` (`node build.mjs`) and committed.

**Last change:** Word files whose whole form is one pasted EMF picture (e.g. "declaratie pe propria raspundere")
are turned back into paragraphs (`emfParagraphs` / `wordEmfToText` in `src/js/fmt-office.js`), so blanks are
found. Dates written as `_ _/_ _/_ _ _ _`, `__.__.____`, `../../....` are now one blank (`DATE_FILL_RE` in `engine.js`).

**Next:** old-style WMF pictures are not read yet (only EMF). The output .docx holds editable text instead of
the picture (fonts and spacing simplified).

**Tests:** `node tests/e2e.mjs chromium <folder|file>`. Real forms live only on the Mac, gitignored:
`tests/real`, `real2`, `real3`, `real4` (the EMF declaration), `real-scans`.
