'use strict';
// PDF forms (fillable or flat), images/scans and Pages files (via their preview image).
// Everything becomes a PDF that you can see, with movable boxes on top.

let _fontBytes = null;
function fontBytes() { return _fontBytes || (_fontBytes = b64ToBytes(FONT_B64)); }
let _measure = null;
function textWidth(text, size) {
  if (!_measure) _measure = document.createElement('canvas').getContext('2d');
  _measure.font = `${size}px AFSans, sans-serif`;
  return _measure.measureText(text).width;
}

function pdfjsOpen(bytes) {
  return pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false, fontExtraProperties: true, disableAutoFetch: true, disableStream: true }).promise;
}

async function imageToPdf(bytes, type) {
  const bmp = await createImageBitmap(new Blob([bytes], { type }));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  const isJpg = /jpe?g/.test(type);
  const out = await new Promise((r) => c.toBlob(r, isJpg ? 'image/jpeg' : 'image/png', 0.92));
  const imgBytes = new Uint8Array(await out.arrayBuffer());
  const doc = await PDFLib.PDFDocument.create();
  const img = isJpg ? await doc.embedJpg(imgBytes) : await doc.embedPng(imgBytes);
  const W = 595.28, H = W * bmp.height / bmp.width;
  doc.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H });
  return { bytes: await doc.save(), px: { w: bmp.width, h: bmp.height } };
}

// Pages files are zip packages holding a preview picture of page 1
async function pagesPreview(bytes) {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('Could not open this Pages file. In Pages use File → Export To → Word, then drop the .docx here.'); }
  const cands = Object.values(zip.files).filter((f) => !f.dir && /(^|\/)(preview[^/]*|thumbnail[^/]*)\.(jpe?g|png)$/i.test(f.name));
  if (!cands.length) throw new Error('This Pages file has no preview inside. In Pages use File → Export To → Word or PDF, then drop that file here.');
  let best = null, bestSize = -1;
  for (const f of cands) { const b = await f.async('uint8array'); if (b.length > bestSize) { best = { b, name: f.name }; bestSize = b.length; } }
  return { bytes: best.b, type: /png$/i.test(best.name) ? 'image/png' : 'image/jpeg' };
}

// Where each character of a text run starts/ends: measure with a similar font, scale to the run width
let _edgeCtx = null;
function charEdges(str, width, family, widths) {
  if (!_edgeCtx) _edgeCtx = document.createElement('canvas').getContext('2d');
  _edgeCtx.font = `100px ${family || 'sans-serif'}`;
  const ws = [];
  let total = 0;
  for (let i = 0; i < str.length; i++) {
    const w = (widths && widths.get(str[i])) || _edgeCtx.measureText(str[i]).width * 10 || 500;
    ws.push(w); total += w;
  }
  const k = total ? width / total : 0;
  const edges = [0];
  for (const w of ws) edges.push(edges[edges.length - 1] + w * k);
  return edges;
}

// unicode char -> glyph width (1/1000 em), from the font inside the PDF
function fontWidths(pg, fontName, cache) {
  if (cache.has(fontName)) return cache.get(fontName);
  let map = null;
  try {
    const f = pg.commonObjs.get(fontName);
    if (f && f.widths) {
      map = new Map();
      const tu = f.toUnicode, wd = f.widths;
      const codes = Array.isArray(wd) ? wd.keys() : Object.keys(wd).map(Number);
      const tm = tu && (tu._map || tu.map);
      for (const code of codes) {
        const w = wd[code];
        if (!w) continue;
        const u = tm ? tm[code] : String.fromCharCode(code);
        if (typeof u === 'string' && u.length === 1 && !map.has(u)) map.set(u, w);
      }
      if (!map.size) map = null;
    }
  } catch { map = null; }
  cache.set(fontName, map);
  return map;
}

// Horizontal lines drawn on the page (blanks made with lines instead of "____")
function drawnLines(opl) {
  const O = pdfjsLib.OPS, out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (x, y) => [x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]];
  const seg = (a, b) => {
    const [x0, y0] = ap(...a), [x1, y1] = ap(...b);
    if (Math.abs(y0 - y1) < 0.8 && Math.abs(x1 - x0) > 25) out.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y: (y0 + y1) / 2 });
  };
  for (let i = 0; i < opl.fnArray.length; i++) {
    const fn = opl.fnArray[i], args = opl.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || ctm;
    else if (fn === O.transform) ctm = mul(ctm, args);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (args[0]) ctm = mul(ctm, args[0]); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === O.constructPath) {
      const [ops, c] = args;
      let j = 0, cur = null;
      for (const op of ops) {
        if (op === O.moveTo) { cur = [c[j], c[j + 1]]; j += 2; }
        else if (op === O.lineTo) { const p = [c[j], c[j + 1]]; j += 2; if (cur) seg(cur, p); cur = p; }
        else if (op === O.rectangle) {
          const [x, y, w, hh] = c.slice(j, j + 4); j += 4;
          const [ax, ay] = ap(x, y), [bx, by] = ap(x + w, y + hh);
          if (Math.abs(by - ay) < 2 && Math.abs(bx - ax) > 25) out.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y: (ay + by) / 2 });
        }
        else if (op === O.curveTo) j += 6;
        else if (op === O.curveTo2 || op === O.curveTo3) j += 4;
      }
    }
  }
  // merge pieces of the same line (table grids draw them cell by cell)
  out.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const merged = [];
  for (const l of out) {
    const m = merged.find((x) => Math.abs(x.y - l.y) < 0.6 && l.x0 <= x.x1 + 1 && l.x1 >= x.x0 - 1);
    if (m) { m.x0 = Math.min(m.x0, l.x0); m.x1 = Math.max(m.x1, l.x1); } else merged.push({ ...l });
  }
  return merged;
}

function horizontal(t) { return Math.abs(t[1]) < 0.01 && Math.abs(t[2]) < 0.01; }

function buildLines(items) {
  const lines = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const L = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(1.5, 0.35 * Math.min(l.size, it.size)));
    if (L) L.items.push(it); else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let str = '', prevEnd = null;
    const chars = [];
    const size = l.size;
    for (const it of l.items) {
      if (prevEnd != null) {
        const gap = it.x - prevEnd;
        if (gap > 2.2 * size) { str += '\t'; chars.push({ x0: prevEnd, x1: it.x }); }
        else if (gap > 0.15 * size && !/\s$/.test(str) && !/^\s/.test(it.str)) { str += ' '; chars.push({ x0: prevEnd, x1: it.x }); }
      }
      const e = charEdges(it.str, it.w, it.family, it.widths);
      for (let k = 0; k < it.str.length; k++) chars.push({ x0: it.x + e[k], x1: it.x + e[k + 1] });
      str += it.str;
      prevEnd = Math.max(prevEnd ?? -1e9, it.x + it.w);
    }
    l.str = str; l.chars = chars; l.x0 = l.items[0].x;
  }
  return lines.sort((a, b) => b.y - a.y);
}

function splitFieldName(n) {
  const last = String(n).split('.').pop().replace(/\[\d+\]/g, '');
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-\d]+/g, ' ');
}

// Does a tick-box / list option mean this value? ("M" = "Masculin", "Română" = "romana")
const GENDER = { m: ['m', 'masculin', 'male', 'man', 'barbat', 'barbatesc', 'b'], f: ['f', 'feminin', 'female', 'woman', 'femeie', 'femeiesc'] };
function canonGender(s) { for (const [g, list] of Object.entries(GENDER)) if (list.includes(s)) return g; return null; }
function optionMatches(option, value, key) {
  const a = norm(option), b = norm(value);
  if (!a || !b) return false;
  if (key === 'gender' || canonGender(a) && canonGender(b)) return !!canonGender(a) && canonGender(a) === canonGender(b);
  return a.length >= 3 && a === b;
}
function bestOption(options, value, key) {
  if (!value) return null;
  const b = norm(value);
  return options.find((o) => optionMatches(o, value, key))
    || options.find((o) => norm(o) === b)
    || options.find((o) => norm(o).startsWith(b) || (norm(o).length >= 3 && b.startsWith(norm(o))))
    || null;
}

// What a form field gets, given the text value of its key
function fieldValue(b, text) {
  if (b.fieldType === 'check') return text != null && (b.key === '__tick' || optionMatches(b.option, text, b.key)) ? { check: true, text: '✓' } : null;
  if (b.fieldType === 'radio' || b.fieldType === 'choice') {
    const o = bestOption(b.options || [], text, b.key);
    return o ? { choice: o, text: o } : null;
  }
  if (b.charIndex != null) {
    const ch = String(text).replace(/[\s.\-/]/g, '')[b.charIndex];
    return ch ? { text: ch } : null;
  }
  return { text };
}

async function processPdf(bytes, env, meta = {}) {
  let lib;
  try { lib = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) {
    if (/encrypt/i.test(e.message)) throw new Error('This PDF is locked with a password. Open it in Preview, export a copy without the password, then drop that here.');
    throw e;
  }
  const js = await pdfjsOpen(bytes);
  const pages = [];
  for (let i = 0; i < js.numPages; i++) {
    const pg = await js.getPage(i + 1);
    const tc = await pg.getTextContent();
    let opl = null;
    try { opl = await pg.getOperatorList(); } catch { /* only needed for letter widths and drawn lines */ }
    const wcache = new Map();
    let items = tc.items
      .filter((it) => it.str && horizontal(it.transform))
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.abs(it.transform[3]) || it.height || 10, family: tc.styles[it.fontName]?.fontFamily, widths: fontWidths(pg, it.fontName, wcache) }));
    let rules = [];
    try { rules = opl ? drawnLines(opl) : []; } catch { rules = []; }
    let ocr = false;
    // A page without real text is a picture: read it with OCR
    if (items.filter((it) => it.str.trim()).length < 3 && env.ocr !== false && typeof ocrAvailable === 'function' && ocrAvailable()) {
      try {
        env.progress && env.progress(`Reading page ${i + 1} of ${js.numPages}…`);
        const r = await ocrPage(pg, (st, p) => env.progress && env.progress(`Reading page ${i + 1} of ${js.numPages}: ${st}${p ? ' ' + Math.round(p * 100) + '%' : ''}`));
        items = r.items; rules = rules.concat(r.rules); ocr = true;
      } catch (e) { console.warn('OCR failed', e); }
    }
    pages.push({ pg, view: pg.view, items, lines: buildLines(items), rules, ocr });
  }
  const allText = pages.map((p) => p.items.map((i) => i.str).join(' ')).join(' ');
  const opts = { docHasPrenume: /prenume/.test(norm(allText)) };
  const sig = env.vault?.sigSize || { w: 3, h: 1 };
  const blanks = [];

  // 1) Fillable form fields
  const pageIdx = new Map(lib.getPages().map((p, i) => [p.ref.toString(), i]));
  const findPage = (w) => {
    const P = w.P();
    if (P && pageIdx.has(P.toString())) return pageIdx.get(P.toString());
    const ref = lib.context.getObjectRef(w.dict);
    if (!ref) return 0;
    const pg = lib.getPages().findIndex((p) => { const a = p.node.Annots(); return a && a.asArray().some((x) => x.toString() === ref.toString()); });
    return Math.max(0, pg);
  };
  let fields = [];
  try { fields = lib.getForm().getFields(); } catch { fields = []; }
  const values = env.values || {};
  const widgetRects = pages.map(() => []);
  const near = (page, rect) => {
    const items = pages[page].items;
    const sameRow = (it) => it.y < rect.y + rect.height + 2 && it.y + it.size * 0.8 > rect.y - 2;
    const left = items.filter((it) => sameRow(it) && it.x + it.w <= rect.x + 3 && rect.x - (it.x + it.w) < 220)
      .sort((a, b) => (b.x + b.w) - (a.x + a.w))[0];
    const right = items.filter((it) => sameRow(it) && it.x >= rect.x + rect.width - 3 && it.x - (rect.x + rect.width) < 90)
      .sort((a, b) => a.x - b.x)[0];
    const above = items.filter((it) => it.y >= rect.y + rect.height - 2 && it.y - (rect.y + rect.height) < 2.5 * it.size && it.x < rect.x + rect.width && it.x + it.w > rect.x)
      .sort((a, b) => a.y - b.y)[0];
    return { left, right, above };
  };
  const cls = (t) => t && classify(t, env.compiled, { ...opts, maxTail: 20 });
  for (const f of fields) {
    const type = f instanceof PDFLib.PDFTextField ? 'text' : f instanceof PDFLib.PDFSignature ? 'sig'
      : f instanceof PDFLib.PDFCheckBox ? 'check' : f instanceof PDFLib.PDFRadioGroup ? 'radio'
      : (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) ? 'choice' : null;
    if (!type) continue;
    const ws = f.acroField.getWidgets();
    if (!ws.length) continue;
    ws.forEach((w) => { const r = w.getRectangle(); widgetRects[findPage(w)].push(r); });
    let readOnly = false;
    try { readOnly = f.isReadOnly(); } catch { readOnly = false; }
    if (readOnly) continue;
    const w = ws[0], rect = w.getRectangle(), page = findPage(w);
    const { left, right, above } = near(page, rect);
    const name = splitFieldName(f.getName());
    const base = {
      kind: 'field', fieldType: type, fieldName: f.getName(), sigField: type === 'sig', page,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, where: 'page ' + (page + 1) + ' · field', after: '',
    };
    if (type === 'check') {
      // "☐ Masculin ☐ Feminin": the word next to the box says what ticking it means
      const option = (right?.str || left?.str || name || '').trim();
      let key = canonGender(norm(option)) ? 'gender' : null;
      if (!key) for (const [k, v] of Object.entries(values)) if (optionMatches(option, v, k)) { key = k; break; }
      let checked = false;
      try { checked = f.isChecked(); } catch { checked = false; }
      blanks.push({ ...base, option, key: checked ? null : key, before: '☐ ' + option.slice(0, 40), canImage: false });
      continue;
    }
    if (type === 'radio' || type === 'choice') {
      let options = [];
      try { options = f.getOptions(); } catch { options = []; }
      const key = cls(name) || cls(left?.str) || cls(above?.str);
      const optRects = type === 'radio' ? ws.map((x) => { const r = x.getRectangle(); return { x: r.x, y: r.y, w: r.width, h: r.height, page: findPage(x) }; }) : null;
      blanks.push({ ...base, options, optRects, key, before: (left?.str || above?.str || name).trim().slice(-40) + ' (' + options.slice(0, 4).join(' / ') + ')', canImage: false });
      continue;
    }
    let key = type === 'sig' ? 'signature' : (cls(name) || cls(left?.str) || cls(above?.str));
    let existing = '';
    if (type === 'text') { try { existing = f.getText() || ''; } catch { existing = ''; } }
    if (existing.trim()) key = null;
    blanks.push({
      ...base, maxLen: type === 'text' ? f.getMaxLength() : undefined,
      key, before: (left?.str || above?.str || name).trim().slice(-48), after: existing ? `(already: ${existing.slice(0, 20)})` : '',
      canImage: true,
    });
  }
  // A row of one-letter boxes (CNP in 13 boxes, a date in 8): each box gets one character
  const singles = blanks.filter((b) => b.fieldType === 'text' && b.maxLen && b.maxLen <= 2)
    .sort((a, b) => a.page - b.page || b.rect.y - a.rect.y || a.rect.x - b.rect.x);
  let run = [];
  const flush = () => {
    if (run.length >= 3) {
      const key = run.find((b) => b.key)?.key;
      const label = run[0].before || '';
      run.forEach((b, i) => { b.key = key || null; b.charIndex = i; b.before = label + ` [box ${i + 1}/${run.length}]`; });
    }
    run = [];
  };
  for (const b of singles) {
    const prev = run[run.length - 1];
    if (prev && prev.page === b.page && Math.abs(prev.rect.y - b.rect.y) < 3 && b.rect.x - (prev.rect.x + prev.rect.w) < prev.rect.w * 1.5) run.push(b);
    else { flush(); run.push(b); }
  }
  flush();

  // 2) Printed blanks: "Nume: ________", "Subsemnatul ………", "Semnătura:"
  const inWidget = (p, x0, y0, x1, y1) => widgetRects[p].some((r) => x0 < r.x + r.width + 4 && x1 > r.x - 4 && y0 < r.y + r.height + 2 && y1 > r.y - 2);
  pages.forEach((P, pi) => {
    const right = P.view[2] - 24;
    P.lines.forEach((l, li) => {
      const found = findBlanks(l.str, { prevText: P.lines[li - 1]?.str || '', nextText: P.lines[li + 1]?.str || '' });
      for (const b of found) {
        const key = assignBlank(b, env.compiled, opts);
        if (b.kind === 'insert' && !key) continue;
        const size = clamp(l.size, 7, 12);
        let x, maxW, cover = null;
        if (b.kind === 'insert') {
          x = l.chars[b.start - 1].x1 + 0.35 * size;
          let j = b.start;
          while (j < l.str.length && /\s/.test(l.str[j]) && l.str[j] !== '\t') j++;
          const nextX = j < l.str.length ? (l.str[j] === '\t' ? l.chars[j].x1 : l.chars[j].x0) : right;
          maxW = nextX - x - 4;
        } else {
          const x0 = l.chars[b.start].x0, x1 = l.chars[b.end - 1].x1;
          x = x0 + 1; maxW = x1 - x0 + 6;
          cover = { x: x0 - 0.5, y: l.y - 0.32 * l.size, w: x1 - x0 + 1, h: l.size * 1.15 };
        }
        if (inWidget(pi, x, l.y - 2, x + Math.max(20, Math.min(maxW, 160)), l.y + size)) continue;
        const it = { kind: 'text', page: pi, key, x, y: l.y + (cover ? 0 : 0.1 * size), size, maxW, cover,
          ...contextSnippet(b), where: 'page ' + (pi + 1), canImage: true };
        if (key === 'signature') sigPlacement(it, l, b);
        blanks.push(it);
      }
    });
  });

  // 3) Drawn lines with a label: "Nume" followed by a line, or a line with "(semnătura)" under it
  pages.forEach((P, pi) => {
    for (const r of P.rules) {
      if (r.x1 - r.x0 > (P.view[2] - P.view[0]) * 0.8) continue; // page-wide rules are decoration
      const taken = blanks.some((b) => b.page === pi && b.kind !== 'field' && Math.abs(b.y - r.y) < 14 && b.x >= r.x0 - 40 && b.x <= r.x1);
      if (taken || inWidget(pi, r.x0, r.y, r.x1, r.y + 10)) continue;
      const filled = P.items.some((it) => { const cx = it.x + it.w / 2; return cx > r.x0 + 3 && cx < r.x1 - 3 && it.y >= r.y - 2 && it.y - r.y < 12 && it.str.trim(); });
      if (filled) continue;
      let key = null, label = '', size = 10, place = 'on';
      const l = P.lines.find((l) => l.y >= r.y - 1 && l.y - r.y < 14 && l.x0 < r.x0);
      if (l) {
        let k = 0;
        while (k < l.chars.length && l.chars[k].x1 <= r.x0 + 2) k++;
        label = l.str.slice(0, k);
        const gap = k ? r.x0 - l.chars[k - 1].x1 : 1e9;
        const tail = label.split(/\t|_{3,}|\.{4,}/).pop();
        if (gap < 150 && tail.trim()) { key = classify(tail, env.compiled, { ...opts, window: label }); size = l.size; }
      }
      if (!key) {
        const below = P.lines.find((l) => r.y - l.y > 0 && r.y - l.y < 16 && l.x0 >= r.x0 - 10 && l.x0 < r.x1);
        const m = below && /^\s*\(([^)]{2,50})\)/.exec(below.str);
        if (m) { key = classify(m[1], env.compiled, { ...opts, maxTail: 30 }); label = '(' + m[1] + ')'; size = below.size; place = 'over'; }
      }
      if (!key) continue;
      size = clamp(size, 7, 12);
      const it = { kind: 'text', page: pi, key, x: r.x0 + 2, y: r.y + 2, size, maxW: r.x1 - r.x0 - 4, cover: null,
        before: label.replace(/\s+/g, ' ').trim().slice(-48), after: place === 'over' ? '(line)' : '', where: 'page ' + (pi + 1), canImage: true };
      if (key === 'signature') { it.kind = 'image'; it.h = clamp(size * 2.8, 22, 44); it.w = Math.min(it.h * sig.w / sig.h, r.x1 - r.x0); it.h = it.w * sig.h / sig.w; it.y = r.y - 2; }
      blanks.push(it);
    }
  });

  function sigPlacement(it, l, b) {
    it.kind = 'image';
    it.h = clamp(l.size * 2.8, 22, 44);
    it.w = it.h * sig.w / sig.h;
    it.y = l.y - 0.3 * l.size;
    if (b.kind === 'insert' && it.maxW < it.w * 0.6) { it.x = l.x0; it.y = l.y - it.h - 3; }
  }

  const scanned = pages.every((p) => p.items.length === 0);
  const ocrUsed = pages.some((p) => p.ocr);
  let xfa = false;
  try { const af = lib.catalog.lookup(PDFLib.PDFName.of('AcroForm')); xfa = !!(af && af.lookup(PDFLib.PDFName.of('XFA'))) && !fields.length; } catch { xfa = false; }
  return { blanks, js, pages, scanned, ocrUsed, xfa, meta };
}

// Makes a blank an image (signature) or text, keeping its spot
function setBlankKind(b, key, vault) {
  if (b.kind === 'field') return;
  const sig = vault?.sigSize || { w: 3, h: 1 };
  if (key === 'signature' && b.kind !== 'image') {
    b.kind = 'image'; b.h = clamp((b.size || 10) * 2.8, 22, 44); b.w = b.h * sig.w / sig.h; b.y -= 0.3 * (b.size || 10);
  } else if (key !== 'signature' && b.kind === 'image') {
    b.kind = 'text'; b.size = b.size || 10; b.y += 0.3 * b.size;
  }
}

function fitSize(b, text) {
  let size = b.size;
  if (b.maxW && b.maxW > 10) {
    const w = textWidth(text, size);
    if (w > b.maxW) size = Math.max(size * 0.72, size * b.maxW / w);
  }
  return size;
}

async function buildPdf(sess, valueOf, opts) {
  const doc = await PDFLib.PDFDocument.load(sess.bytes, { updateMetadata: false });
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes(), { subset: true });
  const pages = doc.getPages();
  const ink = opts.ink === 'blue' ? PDFLib.rgb(0.05, 0.15, 0.55) : PDFLib.rgb(0.05, 0.05, 0.08);
  let sigImg = null;
  const sigImage = async (img) => sigImg || (sigImg = await doc.embedPng(img.bytes));
  let formTouched = false;
  const form = sess.blanks.some((b) => b.kind === 'field') ? doc.getForm() : null;

  for (const b of sess.blanks) {
    const val = valueOf(b);
    if (!val) continue;
    const page = pages[b.page];
    if (b.kind === 'field') {
      const r = b.rect;
      if (val.image) {
        const im = await sigImage(val.image);
        const s = Math.min(r.w / val.image.w, r.h / val.image.h);
        page.drawImage(im, { x: r.x + (r.w - val.image.w * s) / 2, y: r.y + (r.h - val.image.h * s) / 2, width: val.image.w * s, height: val.image.h * s });
        // the empty box would be drawn on top of the signature, so it goes
        try { form.removeField(form.getField(b.fieldName)); } catch { /* keep the box */ }
        continue;
      }
      if (b.sigField) {
        page.drawText(val.text, { x: r.x + 2, y: r.y + r.h * 0.3, size: Math.min(11, r.h * 0.6), font, color: ink });
        continue;
      }
      try {
        if (val.check) { form.getCheckBox(b.fieldName).check(); continue; }
        if (val.choice != null) {
          const f = form.getField(b.fieldName);
          f.select(val.choice);
          formTouched = true;
          continue;
        }
      } catch (e) { console.warn('could not set', b.fieldName, e); continue; }
      if (b.fieldType !== 'text') continue;
      const f = form.getTextField(b.fieldName);
      let t = val.text;
      if (b.maxLen && t.length > b.maxLen) t = t.slice(0, b.maxLen);
      f.setText(t);
      formTouched = true;
      continue;
    }
    if (val.image) {
      const im = await sigImage(val.image);
      page.drawImage(im, { x: b.x, y: b.y, width: b.w, height: b.h });
      continue;
    }
    if (b.cover && opts.cover) page.drawRectangle({ x: b.cover.x, y: b.cover.y, width: b.cover.w, height: b.cover.h, color: PDFLib.rgb(1, 1, 1) });
    page.drawText(val.text, { x: b.x, y: b.y, size: fitSize(b, val.text), font, color: ink });
  }
  if (form) { try { form.deleteXFA(); } catch { /* not an XFA form */ } } // so every viewer shows the normal fields
  if (formTouched) form.updateFieldAppearances(font);
  return doc.save({ updateFieldAppearances: false });
}

async function pdfPageToPng(pdfBytes, px) {
  const js = await pdfjsOpen(pdfBytes);
  const pg = await js.getPage(1);
  const vp1 = pg.getViewport({ scale: 1 });
  const vp = pg.getViewport({ scale: px.w / vp1.width });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

/* ---------------- Visual editor ---------------- */

class PdfEditor {
  constructor(host, sess, app) {
    this.host = host; this.sess = sess; this.app = app;
    this.sel = null;
    this.els = new Map();
  }

  async render() {
    this.host.textContent = '';
    const width = Math.max(320, this.host.clientWidth - 2);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const [i, P] of this.sess.pages.entries()) {
      const vp1 = P.pg.getViewport({ scale: 1 });
      const scale = Math.min(1.6, width / vp1.width);
      const vp = P.pg.getViewport({ scale });
      const canvas = h('canvas', { width: Math.floor(vp.width * dpr), height: Math.floor(vp.height * dpr) });
      canvas.style.width = vp.width + 'px'; canvas.style.height = vp.height + 'px';
      const layer = h('div', { class: 'layer' });
      const wrap = h('div', { class: 'pg', 'data-page': i + 1 }, canvas, layer);
      wrap.style.width = vp.width + 'px'; wrap.style.height = vp.height + 'px';
      this.host.append(wrap);
      P.vp = vp; P.scale = scale; P.layer = layer;
      layer.addEventListener('pointerdown', (e) => { if (e.target === layer) this.openAdd(i, e); });
      await P.pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    }
    this.drawAll();
  }

  drawAll() {
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    $$('.cover', this.host).forEach((e) => e.remove());
    this.sess.blanks.forEach((b) => this.draw(b));
  }

  draw(b) {
    const old = this.els.get(b);
    if (old) old.remove();
    old?._cover?.remove();
    const P = this.sess.pages[b.page];
    if (!P || !P.vp) return;
    const s = P.scale;
    const val = this.app.valueOf(b);
    const pt = (x, y) => P.vp.convertToViewportPoint(x, y);
    let el;
    if (b.kind === 'field') {
      const [x0, y0] = pt(b.rect.x, b.rect.y + b.rect.h);
      el = h('div', { class: 'ov field' + (b.key ? '' : ' unknown') });
      Object.assign(el.style, { left: x0 + 'px', top: y0 + 'px', width: b.rect.w * s + 'px', height: b.rect.h * s + 'px' });
      if (val?.image) el.append(h('img', { src: val.image.dataUrl, draggable: false }));
      else el.append(h('span', { text: val ? val.text : b.key && b.fieldType === 'text' ? '⚠ ' + fieldLabel(b.key, this.app.vault) : '' }));
      el.firstChild.style.fontSize = Math.min(11, b.rect.h * 0.8) * s + 'px';
      if (b.fieldType === 'check') el.classList.add('check');
    } else if (!b.key) {
      const [x, y] = pt(b.x, b.y);
      el = h('div', { class: 'ov unknown dot', title: 'Unknown blank: click to choose what goes here', text: '?' });
      Object.assign(el.style, { left: x + 'px', top: y - 14 + 'px' });
    } else if (b.kind === 'image') {
      const [x, y] = pt(b.x, b.y);
      el = h('div', { class: 'ov img' });
      Object.assign(el.style, { left: x + 'px', top: y - b.h * s + 'px', width: b.w * s + 'px', height: b.h * s + 'px' });
      if (val?.image) el.append(h('img', { src: val.image.dataUrl, draggable: false }));
      else el.append(h('span', { class: 'missing', text: 'no signature saved' }));
      const grip = h('div', { class: 'grip' });
      el.append(grip);
      grip.addEventListener('pointerdown', (e) => this.startResize(e, b));
    } else {
      const text = val ? val.text : '⚠ ' + fieldLabel(b.key, this.app.vault) + ' (empty)';
      const size = val ? fitSize(b, text) : b.size;
      const [x, y] = pt(b.x, b.y);
      el = h('div', { class: 'ov text' + (val ? '' : ' missing'), text });
      const ink = this.app.settings().ink === 'blue' ? '#0d2a8c' : '#111';
      Object.assign(el.style, { left: x + 'px', top: y - 0.846 * size * s + 'px', fontSize: size * s + 'px', color: val ? ink : '' });
      if (val && b.cover && this.app.cover()) {
        const [cx, cy] = pt(b.cover.x, b.cover.y + b.cover.h);
        const c = h('div', { class: 'cover' });
        Object.assign(c.style, { left: cx + 'px', top: cy + 'px', width: b.cover.w * s + 'px', height: b.cover.h * s + 'px' });
        P.layer.append(c);
        el._cover = c;
      }
    }
    if (this.sel === b) el.classList.add('sel');
    el.addEventListener('pointerdown', (e) => this.startDrag(e, b));
    P.layer.append(el);
    this.els.set(b, el);
  }

  select(b, scroll) {
    this.sel = b;
    $$('.ov.sel', this.host).forEach((e) => e.classList.remove('sel'));
    $('.toolbar', this.host)?.remove();
    if (!b) return;
    const el = this.els.get(b);
    if (!el) return;
    el.classList.add('sel');
    if (scroll) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const tb = h('div', { class: 'toolbar' },
      this.app.fieldSelect(b, (k, text) => this.app.setKey(b, k, text)),
      b.kind === 'text' ? h('button', { class: 'mini', title: 'Smaller', onclick: () => { b.size = Math.max(5, b.size - 1); this.draw(b); this.select(b); } }, 'A−') : null,
      b.kind === 'text' ? h('button', { class: 'mini', title: 'Bigger', onclick: () => { b.size = Math.min(40, b.size + 1); this.draw(b); this.select(b); } }, 'A+') : null,
      b.kind !== 'field' ? h('button', { class: 'mini danger', title: 'Remove', onclick: () => this.app.removeBlank(b) }, '✕') : null,
    );
    const P = this.sess.pages[b.page];
    tb.style.left = Math.max(0, Math.min(parseFloat(el.style.left), P.vp.width - 300)) + 'px';
    tb.style.top = Math.max(0, parseFloat(el.style.top) - 40) + 'px';
    tb.addEventListener('pointerdown', (e) => e.stopPropagation());
    P.layer.append(tb);
    this.app.highlightRow(b);
  }

  startDrag(e, b) {
    e.stopPropagation();
    this.closeAdd();
    if (this.sel !== b) this.select(b);
    if (b.kind === 'field' || !b.key) return;
    const P = this.sess.pages[b.page];
    const el = this.els.get(b);
    const sx = e.clientX, sy = e.clientY;
    const l0 = parseFloat(el.style.left), t0 = parseFloat(el.style.top);
    const [vx, vy] = P.vp.convertToViewportPoint(b.x, b.y);
    el.setPointerCapture(e.pointerId);
    let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      if (!moved) return;
      $('.toolbar', this.host)?.remove();
      el.style.left = l0 + dx + 'px';
      el.style.top = t0 + dy + 'px';
      [b.x, b.y] = P.vp.convertToPdfPoint(vx + dx, vy + dy);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (moved) { this.draw(b); this.select(b); }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  startResize(e, b) {
    e.stopPropagation();
    const P = this.sess.pages[b.page];
    const el = this.els.get(b);
    const grip = e.target;
    grip.setPointerCapture(e.pointerId);
    const sx = e.clientX, w0 = b.w, h0 = b.h, top = b.y + b.h;
    const move = (ev) => {
      b.w = Math.max(15, w0 + (ev.clientX - sx) / P.scale);
      b.h = h0 * b.w / w0;
      b.y = top - b.h;
      el.style.width = b.w * P.scale + 'px';
      el.style.height = b.h * P.scale + 'px';
    };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); this.draw(b); this.select(b); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  }

  closeAdd() { $('.addmenu', this.host)?.remove(); }

  openAdd(pageIndex, e) {
    this.select(null);
    this.closeAdd();
    const P = this.sess.pages[pageIndex];
    const r = P.layer.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const [x, y] = P.vp.convertToPdfPoint(px, py);
    const sel = this.app.fieldSelect({ key: null }, (key, text) => {
      if (!key) return;
      const b = { kind: 'text', page: pageIndex, key, text, x, y: y - 4, size: 10, maxW: 0, cover: null,
        before: '(added by you)', after: '', where: 'page ' + (pageIndex + 1), canImage: true, manual: true };
      if (key === 'signature') setBlankKind(b, key, this.app.vault);
      if (b.kind === 'image') { b.x = x - b.w / 2; b.y = y - b.h / 2; }
      this.closeAdd();
      this.app.addBlank(b);
      this.select(b);
    }, 'Put here…');
    const menu = h('div', { class: 'addmenu' }, sel, h('button', { class: 'mini', onclick: () => this.closeAdd() }, '✕'));
    menu.style.left = Math.min(px, P.vp.width - 260) + 'px';
    menu.style.top = py + 'px';
    menu.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    P.layer.append(menu);
    sel.focus();
  }
}
