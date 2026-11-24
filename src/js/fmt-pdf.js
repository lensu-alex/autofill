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

// Pictures -> canvases (TIFF can have many pages; Chrome can't decode TIFF itself)
async function imageCanvases(bytes, type) {
  if (/tiff/.test(type) && typeof UTIF !== 'undefined') {
    try { return tiffCanvases(bytes); } catch { /* let the browser try */ }
  }
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type }));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    return [c];
  } catch (e) {
    if (/hei[cf]/.test(type) && typeof libheif !== 'undefined') {
      // iPhone photos: Chrome can't decode HEIC itself (libheif, WebAssembly)
      const lib = typeof libheif === 'function' ? libheif() : libheif;
      const imgs = new lib.HeifDecoder().decode(bytes);
      if (!imgs || !imgs.length) throw new Error('Could not read this HEIC photo');
      const out = [];
      for (const im of imgs.slice(0, 1)) {
        const w = im.get_width(), hh = im.get_height();
        const c = document.createElement('canvas');
        c.width = w; c.height = hh;
        const ctx = c.getContext('2d');
        const data = ctx.createImageData(w, hh);
        await new Promise((res, rej) => im.display(data, (d) => (d ? res() : rej(new Error('Could not read this HEIC photo')))));
        ctx.putImageData(data, 0, 0);
        out.push(c);
      }
      return out;
    }
    if (!/tiff/.test(type) || typeof UTIF === 'undefined') throw new Error('Could not read this picture');
    return tiffCanvases(bytes);
  }
}

function tiffCanvases(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const ifds = UTIF.decode(buf);
  const out = [];
  for (const ifd of ifds) {
    if (!ifd.width && !ifd.t256) continue;
    UTIF.decodeImage(buf, ifd, ifds);
    const rgba = UTIF.toRGBA8(ifd);
    const c = document.createElement('canvas');
    c.width = ifd.width; c.height = ifd.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), ifd.width, ifd.height), 0, 0);
    out.push(c);
  }
  if (!out.length) throw new Error('Could not read this TIFF');
  return out;
}

async function imageToPdf(bytes, type) {
  const canvases = await imageCanvases(bytes, type);
  const isJpg = /jpe?g/.test(type);
  const doc = await PDFLib.PDFDocument.create();
  for (const c of canvases) {
    const out = await new Promise((r) => c.toBlob(r, isJpg ? 'image/jpeg' : 'image/png', 0.92));
    const imgBytes = new Uint8Array(await out.arrayBuffer());
    const img = isJpg ? await doc.embedJpg(imgBytes) : await doc.embedPng(imgBytes);
    const W = 595.28, H = W * c.height / c.width;
    doc.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H });
  }
  return { bytes: await doc.save(), px: { w: canvases[0].width, h: canvases[0].height }, pages: canvases.length };
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
  const O = pdfjsLib.OPS, out = [], vert = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (x, y) => [x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]];
  const seg = (a, b) => {
    const [x0, y0] = ap(...a), [x1, y1] = ap(...b);
    if (Math.abs(y0 - y1) < 0.8 && Math.abs(x1 - x0) > 25) out.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y: (y0 + y1) / 2 });
    else if (Math.abs(x0 - x1) < 0.8 && Math.abs(y1 - y0) > 6) vert.push({ x: (x0 + x1) / 2, y0: Math.min(y0, y1), y1: Math.max(y0, y1) });
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
          const X0 = Math.min(ax, bx), X1 = Math.max(ax, bx), Y0 = Math.min(ay, by), Y1 = Math.max(ay, by);
          if (Y1 - Y0 < 2 && X1 - X0 > 25) out.push({ x0: X0, x1: X1, y: (Y0 + Y1) / 2 });
          else if (X1 - X0 < 2 && Y1 - Y0 > 6) vert.push({ x: (X0 + X1) / 2, y0: Y0, y1: Y1 });
          else if (X1 - X0 > 6 && Y1 - Y0 > 6) { // a box: its four sides
            out.push({ x0: X0, x1: X1, y: Y0 }, { x0: X0, x1: X1, y: Y1 });
            vert.push({ x: X0, y0: Y0, y1: Y1 }, { x: X1, y0: Y0, y1: Y1 });
          }
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
  vert.sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const vmerged = [];
  for (const l of vert) {
    const m = vmerged.find((x) => Math.abs(x.x - l.x) < 0.6 && l.y0 <= x.y1 + 1 && l.y1 >= x.y0 - 1);
    if (m) { m.y0 = Math.min(m.y0, l.y0); m.y1 = Math.max(m.y1, l.y1); } else vmerged.push({ ...l });
  }
  merged.vertical = vmerged;
  return merged;
}

function horizontal(t) { return Math.abs(t[1]) < 0.01 && Math.abs(t[2]) < 0.01; }

function buildLines(items) {
  const lines = [];
  const gy = (it) => it.gy ?? it.y; // straightened height for tilted scans
  for (const it of [...items].sort((a, b) => gy(b) - gy(a) || a.x - b.x)) {
    const L = lines.find((l) => Math.abs(l.gy - gy(it)) <= Math.max(1.5, 0.35 * Math.min(l.size, it.size)));
    if (L) L.items.push(it); else lines.push({ y: it.y, gy: gy(it), size: it.size, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let str = '', prevEnd = null;
    const chars = [];
    const size = l.size;
    for (const it of l.items) {
      if (prevEnd != null) {
        const gap = it.x - prevEnd;
        if (gap > 2.2 * size) { str += '\t'; chars.push({ x0: prevEnd, x1: it.x, y: it.y }); }
        else if (gap > 0.15 * size && !/\s$/.test(str) && !/^\s/.test(it.str)) { str += ' '; chars.push({ x0: prevEnd, x1: it.x, y: it.y }); }
      }
      const e = charEdges(it.str, it.w, it.family, it.widths);
      for (let k = 0; k < it.str.length; k++) chars.push({ x0: it.x + e[k], x1: it.x + e[k + 1], y: it.y });
      str += it.str;
      prevEnd = Math.max(prevEnd ?? -1e9, it.x + it.w);
    }
    l.str = str; l.chars = chars; l.x0 = l.items[0].x;
  }
  return lines.sort((a, b) => b.gy - a.gy);
}

// Height of a text line near x (lines in tilted scans are not level)
function lineYAt(l, x) {
  let best = l.y, d = 1e9;
  for (const c of l.chars) { const dd = Math.abs((c.x0 + c.x1) / 2 - x); if (dd < d && c.y != null) { d = dd; best = c.y; } }
  return best;
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
  if (b.datePart) {
    const d = parseDate(text);
    if (!d) return { text };
    return { text: b.datePart === 'y' ? String(d.y) : String(b.datePart === 'd' ? d.d : d.m).padStart(2, '0') };
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
    throw new Error('This PDF looks damaged (' + e.message + '). Try opening it in Preview and choosing File → Export as PDF, then drop the new file here.');
  }
  let js;
  try { js = await pdfjsOpen(bytes); }
  catch (e) { throw new Error('This PDF looks damaged (' + (e.message || e) + '). Try opening it in Preview and choosing File → Export as PDF, then drop the new file here.'); }
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
        const vert = (rules.vertical || []).concat(r.vrules || []);
        items = r.items; rules = rules.concat(r.rules); rules.vertical = vert; rules.gridV = r.gridV || []; ocr = true;
      } catch (e) { console.warn('OCR failed', e); }
    }
    pages.push({ pg, view: pg.view, items, lines: buildLines(items), rules, vrules: rules.vertical || [], gridV: (rules.vertical || []).concat(rules.gridV || []), ocr });
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
  // The printed words next to a box: the rest of the text line to its left, the line above it,
  // or the word right after it (tick boxes)
  const near = (page, rect) => {
    const P = pages[page];
    const top = rect.y + rect.height, mid = rect.y + rect.height / 2;
    const textOf = (l, x0, x1) => l.str.split('').filter((_, i) => l.chars[i] && l.chars[i].x0 >= x0 - 1 && l.chars[i].x1 <= x1 + 1).join('');
    let left = null, above = null, right = null;
    const rowLine = P.lines.filter((l) => l.y > rect.y - l.size * 0.5 && l.y < top && Math.abs(l.y + l.size * 0.3 - mid) < Math.max(rect.height, l.size))
      .sort((a, b) => Math.abs(a.y - mid) - Math.abs(b.y - mid))[0];
    if (rowLine) {
      const before = textOf(rowLine, -1e9, rect.x + 2);
      const lastCut = before.split(/\t|_{3,}|\.{4,}|\u2026/).pop();
      if (lastCut.trim()) left = { str: lastCut.trim() };
      // up to the next box on the same row
      const nextBox = allRects[page].filter((r) => r.x > rect.x + rect.width - 1 && Math.abs(r.y - rect.y) < rect.height).map((r) => r.x).sort((a, b) => a - b)[0];
      const after = textOf(rowLine, rect.x + rect.width - 2, Math.min(nextBox ?? 1e9, rect.x + rect.width + 220)).split(/\t/)[0];
      if (after.trim()) right = { str: after.trim() };
    }
    const aboveLine = P.lines.filter((l) => l.y >= top - 2 && l.y - top < 2.6 * l.size && l.chars.some((c) => c.x1 > rect.x && c.x0 < rect.x + rect.width))
      .sort((a, b) => a.y - b.y)[0];
    if (aboveLine) { const t = textOf(aboveLine, rect.x - 6, rect.x + rect.width).trim(); if (t) above = { str: t }; }
    return { left, right, above };
  };
  const allRects = pages.map(() => []);
  for (const f of fields) { try { for (const w of f.acroField.getWidgets()) { const r = w.getRectangle(); allRects[findPage(w)].push(r); } } catch { /* skip */ } }
  // printed labels lose their explanations: "5 Address (number, street…). See instructions." -> "5 Address"
  const cls = (t, fuzzy = true) => {
    if (!t) return null;
    // a field *name* (fuzzy=false) that reads like a sentence is an instruction, not a label
    if (!fuzzy && t.trim().split(/\s+/).length > 5) return null;
    const core = t.replace(/\([^)]*\)?/g, ' ').split(/\.\s/)[0];
    return classify(core, env.compiled, { ...opts, maxTail: 20, fuzzy, stem: fuzzy, window: t });
  };
  const isGeneric = (n) => /^(text|field|fill|group|choice|check ?box|button|untitled|camp|undefined)?\s*\d*$/i.test(n.trim());
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
      const generic = isGeneric(name) || (options.length && options.every((o) => isGeneric(o)));
      const key = generic ? null : (cls(name, false) || cls(left?.str) || cls(above?.str));
      const optRects = type === 'radio' ? ws.map((x) => { const r = x.getRectangle(); return { x: r.x, y: r.y, w: r.width, h: r.height, page: findPage(x) }; }) : null;
      blanks.push({ ...base, options, optRects, key, before: (left?.str || above?.str || name).trim().slice(-40) + ' (' + options.slice(0, 4).join(' / ') + ')', canImage: false });
      continue;
    }
    let key = type === 'sig' ? 'signature' : ((!isGeneric(name) && cls(name, false)) || cls(left?.str) || cls(above?.str));
    let existing = '';
    if (type === 'text') { try { existing = f.getText() || ''; } catch { existing = ''; } }
    if (existing.trim()) key = null;
    blanks.push({
      ...base, maxLen: type === 'text' ? f.getMaxLength() : undefined,
      key, before: (left?.str || above?.str || name).trim().slice(-48), labelText: left?.str || above?.str || name, after: existing ? `(already: ${existing.slice(0, 20)})` : '',
      canImage: true,
    });
  }
  // A row of one-letter boxes (CNP in 13 boxes, a date in 8): each box gets one character
  const singles = blanks.filter((b) => b.fieldType === 'text' && b.maxLen === 1)
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
  // A date split into boxes on one row ("Data nașterii: [zz] [ll] [aaaa]")
  const DATE_KEYS = { birth_date: 1, today: 1, id_issue_date: 1, id_expiry_date: 1 };
  const texts = blanks.filter((b) => b.fieldType === 'text' && DATE_KEYS[b.key] && b.charIndex == null)
    .sort((a, b) => a.page - b.page || b.rect.y - a.rect.y || a.rect.x - b.rect.x);
  for (let i = 0; i < texts.length;) {
    let j = i + 1;
    while (j < texts.length && texts[j].key === texts[i].key && texts[j].page === texts[i].page && Math.abs(texts[j].rect.y - texts[i].rect.y) < 4) j++;
    const grp = texts.slice(i, j);
    if (grp.length === 3) {
      const yearFirst = grp[0].maxLen === 4;
      grp.forEach((b, k) => { b.datePart = (yearFirst ? 'ymd' : 'dmy')[k]; b.before += ' [' + { d: 'day', m: 'month', y: 'year' }[b.datePart] + ']'; });
    }
    i = j;
  }

  // 2) Printed blanks: "Nume: ________", "Subsemnatul ………", "Semnătura:"
  const inWidget = (p, x0, y0, x1, y1) => widgetRects[p].some((r) => x0 < r.x + r.width + 4 && x1 > r.x - 4 && y0 < r.y + r.height + 2 && y1 > r.y - 2);
  const lineSections = sectionsOf(pages.flatMap((P) => P.lines.map((l) => l.str)));
  let lineNo = 0;
  pages.forEach((P, pi) => {
    const right = P.view[2] - 24;
    P.lines.forEach((l, li) => {
      const section = lineSections[lineNo++];
      // in PDFs a wide gap is usually layout (columns, tables), not a blank
      const found = findBlanks(l.str, { prevText: P.lines[li - 1]?.str || '', nextText: P.lines[li + 1]?.str || '', noGap: true });
      for (const b of found) {
        const key = assignBlank(b, env.compiled, opts);
        const optional = b.kind === 'insert' && !key;
        const size = clamp(l.size, 7, 12);
        const ly = (l.chars[b.kind === 'insert' ? b.start - 1 : b.start] || {}).y ?? l.y;
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
          cover = { x: x0 - 0.5, y: ly - 0.32 * l.size, w: x1 - x0 + 1, h: l.size * 1.15 };
        }
        if (b.kind === 'boxes') { cover = null; x = l.chars[b.start].x0; }
        if (inWidget(pi, x, ly - 2, x + Math.max(20, Math.min(maxW, 160)), ly + size)) continue;
        const it = { kind: 'text', optional, section, page: pi, key, x, y: ly + (cover ? 0 : 0.1 * size), size, maxW, cover,
          ...contextSnippet(b), where: 'page ' + (pi + 1), canImage: true };
        if (b.kind === 'boxes') { it.boxes = b.cells.map(([a, z]) => ({ x0: l.chars[a].x0, x1: l.chars[Math.max(a, z - 1)].x1 })); it.maxW = 0; }
        if (key === 'signature') sigPlacement(it, l, b);
        blanks.push(it);
      }
    });
  });

  // 3) Drawn lines with a label: "Nume" followed by a line, or a line with "(semnătura)" under it
  pages.forEach((P, pi) => {
    for (const r of P.rules) {
      if (r.x1 - r.x0 > (P.view[2] - P.view[0]) * 0.8) continue; // page-wide rules are decoration
      // exact box positions from the picture beat the ones guessed from recognised "| | |" text
      if (r.cells) {
        const same = blanks.find((b) => b.page === pi && b.boxes && Math.abs(b.y - r.y) < 14 && b.x < r.x1 && b.x + 20 > r.x0 - 30);
        if (same) { same.boxes = r.cells.map(([a, z]) => ({ x0: a, x1: z })); same.x = r.x0; same.y = r.y + 2; continue; }
      }
      // already found as a printed blank on this same line (lines can be only ~14pt apart)
      const taken = blanks.some((b) => b.page === pi && b.kind !== 'field' && Math.abs(b.y - r.y) < Math.min(8, (b.size || 10) * 0.7) && b.x >= r.x0 - 25 && b.x <= r.x1);
      if (taken || inWidget(pi, r.x0, r.y, r.x1, r.y + 10)) continue;
      // the bottom of a tick box (sides going up from both ends) is not a line to write on
      const side = (x) => P.gridV.some((v) => Math.abs(v.x - x) < 2.5 && Math.abs(v.y0 - r.y) < 3 && v.y1 - r.y > 5);
      const lid = P.rules.some((q) => q !== r && Math.abs(q.x0 - r.x0) < 1.5 && Math.abs(q.x1 - r.x1) < 1.5 && q.y - r.y > (r.x1 - r.x0) * 0.6 && q.y - r.y < (r.x1 - r.x0) * 1.5);
      if (r.x1 - r.x0 < 30 && side(r.x0) && side(r.x1) && lid) continue;
      // already written on? (scans read box bars as "I", "l", "|": not writing)
      const filled = P.items.some((it) => { const cx = it.x + it.w / 2; return cx > r.x0 + 3 && cx < r.x1 - 3 && it.y >= r.y - 2 && it.y - r.y < 12 && /[\p{L}\p{N}]/u.test(it.str) && !/^[|Il1L_\[\]()!:;.,\s]+$/.test(it.str); });
      if (filled) continue;
      let key = null, label = '', size = 10, place = 'on';
      // the text line this blank sits on: the closest one, not just the first that is near
      const l = P.lines.filter((l) => { const y = lineYAt(l, r.x0); return y >= r.y - 1 && y - r.y < 14 && l.x0 < r.x0; })
        .sort((a, b) => Math.abs(lineYAt(a, r.x0) - r.y - 2) - Math.abs(lineYAt(b, r.x0) - r.y - 2))[0];
      let tailText = '';
      if (l) {
        let k = 0;
        while (k < l.chars.length && l.chars[k].x1 <= r.x0 + 2) k++;
        label = l.str.slice(0, k);
        const gap = k ? r.x0 - l.chars[k - 1].x1 : 1e9;
        const tail = label.split(/\t|_{3,}|\.{4,}/).pop();
        if (gap < 150 && tail.trim()) { tailText = tail; key = classify(tail, env.compiled, { ...opts, window: label }); size = l.size; }
      }
      // dots at the start of a line: the label ends the line above ("domiciliat în localitatea" / "........")
      if (!key && !tailText.replace(/[\s.,;:_-]/g, '')) {
        const above = P.lines.filter((q) => { const y = lineYAt(q, r.x1); return y - r.y > 4 && y - r.y < 30; })
          .sort((a, b) => lineYAt(a, r.x1) - lineYAt(b, r.x1))[0];
        // only if that line really ends with the label, at the right margin (not "seria ....," mid-line)
        const margin = Math.max(...P.lines.map((q) => (q.chars[q.chars.length - 1] || { x1: 0 }).x1));
        const lastX = above && (above.chars.filter((c, i) => /\S/.test(above.str[i])).pop() || { x1: 0 }).x1;
        if (above && lastX >= margin - 45) {
          const t = above.str.split(/\t|_{3,}|\.{4,}|\u2026/).pop().replace(/[\s,;]+$/, '');
          const k2 = t && classify(t, env.compiled, { ...opts, window: above.str, maxTail: 3 });
          if (k2) { key = k2; label = t; size = above.size; }
        }
      }
      if (!key) {
        const below = P.lines.find((l) => { const y = lineYAt(l, (r.x0 + r.x1) / 2); return r.y - y > 0 && r.y - y < 16 && l.x0 >= r.x0 - 10 && l.x0 < r.x1; });
        const m = below && /^\s*\(([^)]{2,50})\)/.exec(below.str);
        if (m) { key = classify(m[1], env.compiled, { ...opts, maxTail: 30 }); label = '(' + m[1] + ')'; size = below.size; place = 'over'; }
      }
      // a long line of dots at the start of a line with no readable label: offer it to choose
      const leftMargin = Math.min(...P.lines.map((q) => q.x0));
      const lineAbove = P.lines.some((q) => { const y = lineYAt(q, r.x0); return y - r.y > 4 && y - r.y < 25; });
      const offerAnyway = P.ocr && lineAbove && !key && !tailText.replace(/[\s.,;:_-]/g, '') && r.x1 - r.x0 > 60 && !r.cells && Math.abs(r.x0 - leftMargin) < 15;
      if (!key && !offerAnyway) continue;
      size = clamp(size, 7, 12);
      const it = { kind: 'text', page: pi, key, x: r.x0 + 2, y: r.y + 2 + (P.ocr ? 0.12 * size : 0), size, maxW: r.cells ? 0 : r.x1 - r.x0 - 4, cover: null, dateBoxes: !!r.date,
        boxes: r.cells ? r.cells.map(([a, z]) => ({ x0: a, x1: z })) : undefined,
        before: label.replace(/\s+/g, ' ').trim().slice(-48), after: place === 'over' ? '(line)' : '', where: 'page ' + (pi + 1), canImage: true };
      if (key === 'signature') { it.kind = 'image'; it.h = clamp(size * 2.8, 22, 44); it.w = Math.min(it.h * sig.w / sig.h, r.x1 - r.x0); it.h = it.w * sig.h / sig.w; it.y = r.y - 2; }
      blanks.push(it);
    }
  });

  // 4) Drawn tables: a label cell with an empty cell to its right (or below it)
  pages.forEach((P, pi) => {
    const V = P.vrules, H = P.rules;
    if (!V.length || !H.length) return;
    const vAt = (y) => V.filter((v) => v.y0 - 1 <= y && v.y1 + 1 >= y).map((v) => v.x).sort((a, b) => a - b);
    const hAt = (x) => H.filter((r) => r.x0 - 1 <= x && r.x1 + 1 >= x).map((r) => r.y).sort((a, b) => a - b);
    const emptyRect = (x0, y0, x1, y1) => !P.items.some((it) => { const cx = it.x + it.w / 2, cy = it.y + it.size * 0.3; return it.str.trim() && cx > x0 && cx < x1 && cy > y0 && cy < y1; });
    for (const l of P.lines) {
      const xs = vAt(l.y + l.size * 0.3);
      if (xs.length < 2) continue;
      for (let c = 0; c < xs.length - 1; c++) {
        const left = xs[c], right = xs[c + 1];
        if (right - left < 15) continue;
        const text = l.str.split('').filter((_, i) => l.chars[i] && (l.chars[i].x0 + l.chars[i].x1) / 2 > left && (l.chars[i].x0 + l.chars[i].x1) / 2 < right).join('').trim();
        if (!text || text.length > 60 || findBlanks(text).some((b) => b.kind !== 'insert')) continue;
        const key = classify(text, env.compiled, { ...opts, maxTail: 14, fuzzyMin: 0.75 });
        if (!key) continue;
        const ys = hAt((left + right) / 2);
        const top = ys.find((y) => y > l.y + l.size * 0.5), bottom = [...ys].reverse().find((y) => y < l.y + 1);
        if (top == null || bottom == null) continue;
        // a label cell holds one short line, not a paragraph
        const linesInCell = P.lines.filter((q) => q.y > bottom && q.y < top && q.chars.some((ch, i) => /\S/.test(q.str[i]) && ch.x0 > left && ch.x1 < right)).length;
        if (linesInCell > 2) continue;
        let cell = null;
        const right2 = vAt((top + bottom) / 2).find((x) => x > right + 8);
        if (right2 != null && emptyRect(right + 1, bottom + 1, right2 - 1, top - 1)) cell = { x0: right, x1: right2, y0: bottom, y1: top };
        if (!cell) {
          const bottom2 = [...hAt((left + right) / 2)].reverse().find((y) => y < bottom - 6);
          if (bottom2 != null && emptyRect(left + 1, bottom2 + 1, right - 1, bottom - 1)) cell = { x0: left, x1: right, y0: bottom2, y1: bottom };
        }
        if (!cell) continue;
        if (cell.x1 - cell.x0 < 18 && cell.x1 > P.view[2] - 25) continue; // a thin strip at the page edge is a margin, not somewhere to write
        if (blanks.some((b) => b.page === pi && b.x >= cell.x0 - 2 && b.x <= cell.x1 && b.y >= cell.y0 - 2 && b.y <= cell.y1)) continue;
        if (inWidget(pi, cell.x0 + 2, cell.y0 + 2, cell.x1 - 2, cell.y1 - 2)) continue;
        // the form already has a fillable box for this label
        if (blanks.some((b) => b.kind === 'field' && b.page === pi && b.key === key && Math.abs(b.rect.y + b.rect.h / 2 - (cell.y0 + cell.y1) / 2) < 30)) continue;
        const size = clamp(Math.max(l.size, 10), 7, Math.max(7, Math.min(12, (cell.y1 - cell.y0) * 0.6)));
        const it = { kind: 'text', page: pi, key, x: cell.x0 + 3, y: cell.y0 + (cell.y1 - cell.y0) / 2 - size * 0.35, size, maxW: cell.x1 - cell.x0 - 6,
          cover: null, before: text, labelText: text, after: '', where: 'page ' + (pi + 1) + ' · table', canImage: true, cell };
        if (key === 'signature') {
          it.kind = 'image';
          it.h = clamp((cell.y1 - cell.y0) - 4, 14, 44); it.w = Math.min(it.h * sig.w / sig.h, cell.x1 - cell.x0 - 6); it.h = it.w * sig.h / sig.w;
          it.y = cell.y0 + ((cell.y1 - cell.y0) - it.h) / 2;
        }
        blanks.push(it);
      }
    }
  });

  // 5) Character grids: rows of boxes, one letter per box, label above the row (UK/EU and ANAF forms)
  // capitals only if the form asks for them (not "you do not have to … in capital letters")
  const capsMatch = /(.{0,40})(block capitals|block letters|in capital letters|cu majuscule|cu litere mari|litere de tipar)/i.exec(allText);
  const wantsCaps = !!capsMatch && !/\b(not|don.t|nu|fără)\b/i.test(capsMatch[1]);
  pages.forEach((P, pi) => {
    const V = P.gridV || P.vrules, H = [...P.rules].sort((a, b) => b.y - a.y);
    if (V.length < 5 || H.length < 2) return;
    const rows = [];
    // rules at the same height form one band (a row of boxes can be drawn as separate pieces)
    const bands = [];
    for (const h of H) {
      const b = bands.find((q) => Math.abs(q.y - h.y) <= 1.5);
      if (b) b.segs.push(h); else bands.push({ y: h.y, segs: [h] });
    }
    for (let i = 0; i < bands.length; i++) {
      for (let j = i + 1; j < bands.length; j++) {
        const top = bands[i], bot = bands[j];
        const hgt = top.y - bot.y;
        if (hgt < 9) continue;
        if (hgt > 30) break;
        // stretches where both the top and the bottom rule are drawn
        const spans = [];
        for (const a of top.segs) for (const c of bot.segs) {
          const s0 = Math.max(a.x0, c.x0), s1 = Math.min(a.x1, c.x1);
          if (s1 - s0 >= 12) spans.push([s0, s1]);
        }
        if (spans.reduce((t, [a, c]) => t + c - a, 0) < 24) continue;
        const covered = (x) => spans.some(([a, c]) => x >= a - 1 && x <= c + 1);
        // dividers spanning the row, plus the ends of each stretch
        const xs = V.filter((v) => v.y0 <= bot.y + 2 && v.y1 >= top.y - 2 && covered(v.x)).map((v) => v.x).concat(spans.flat()).sort((a, b) => a - b)
          .filter((x, k, arr) => k === 0 || x - arr[k - 1] > 3);
        // split into runs of evenly spaced boxes
        let run = [xs[0]];
        const groups = [];
        const flushRun = () => {
          const steps = run.slice(1).map((x, k) => x - run[k]);
          const pitch = steps.slice().sort((a, b) => a - b)[steps.length >> 1];
          if (run.length >= 2 && pitch >= 7 && pitch <= 28) groups.push({ cells: run.slice(1).map((x, k) => ({ x0: run[k], x1: x })), pitch });
        };
        for (let k = 1; k < xs.length; k++) {
          const step = xs[k] - xs[k - 1];
          const prev = run.length > 1 ? run[run.length - 1] - run[run.length - 2] : step;
          if (step >= 7 && step <= 28 && Math.abs(step - prev) <= Math.max(2, prev * 0.25) && covered((xs[k] + xs[k - 1]) / 2)) run.push(xs[k]);
          else { flushRun(); run = [xs[k]]; }
        }
        flushRun();
        // dates as separate groups of boxes: 2-2-4 (dd mm yyyy) or 2-2-2
        for (let g = 0; g < groups.length; g++) {
          const trio = groups.slice(g, g + 3);
          const sizes = trio.map((q) => q.cells.length).join('-');
          if (trio.length === 3 && (sizes === '2-2-4' || sizes === '2-2-2') && trio[2].cells[0].x0 - trio[0].cells[0].x0 < trio[0].pitch * 14) {
            rows.push({ page: pi, top: top.y, bottom: bot.y, cells: trio.flatMap((q) => q.cells), pitch: trio[0].pitch, date: true });
            g += 2;
          } else if (groups[g].cells.length >= 5) rows.push({ page: pi, top: top.y, bottom: bot.y, cells: groups[g].cells, pitch: groups[g].pitch });
        }
        break; // the nearest line below is this row's bottom
      }
    }
    if (!rows.length) return;
    rows.sort((a, b) => b.top - a.top || a.cells[0].x0 - b.cells[0].x0);
    const textAbove = (r) => {
      const x0 = r.cells[0].x0 - 4, x1 = r.cells[r.cells.length - 1].x1;
      // the nearest line above with words over the boxes (a sidebar at the same height doesn't count)
      const inRange = (l) => l.str.split('').filter((_, i) => l.chars[i] && l.chars[i].x0 >= x0 - 2 && l.chars[i].x1 <= x1 + 2).join('').trim();
      const l = P.lines.filter((q) => { const y = lineYAt(q, x0 + 10); return y > r.top - 2 && y - r.top < 16 && inRange(q); }).sort((a, b) => lineYAt(a, x0) - lineYAt(b, x0))[0];
      return l ? inRange(l) : '';
    };
    const textLeft = (r) => {
      const mid = (r.top + r.bottom) / 2, x0 = r.cells[0].x0;
      const l = P.lines.find((q) => { const y = lineYAt(q, x0 - 20); return y > r.bottom - 2 && y < r.top; });
      if (!l) return '';
      const idx = l.str.split('').map((_, i) => i).filter((i) => l.chars[i] && l.chars[i].x1 <= x0 + 1 && l.chars[i].x0 >= x0 - 120);
      const lastInk = idx.filter((i) => /\S/.test(l.str[i])).pop();
      if (lastInk == null || x0 - l.chars[lastInk].x1 > 12) return ''; // words far to the left belong to something else
      return idx.map((i) => l.str[i]).join('').split(/\t/).pop().trim();
    };
    let prevRow = null, about = null;
    for (const r of rows) {
      const x0 = r.cells[0].x0, x1 = r.cells[r.cells.length - 1].x1;
      let frameLabel = '';
      // anything found earlier inside this row of boxes was a misreading: the grid wins
      for (let k = blanks.length - 1; k >= 0; k--) {
        const b = blanks[k];
        if (b.page !== pi || b.kind === 'field') continue;
        const inside = b.y >= r.bottom - 3 && b.y <= r.top + 3 && b.x >= x0 - 8 && b.x <= x1;
        // a table cell that holds this row of boxes was only the frame around it
        const frame = b.cell && b.cell.y0 <= r.bottom + 3 && b.cell.y1 >= r.top - 3 && b.cell.x0 < x1 && b.cell.x1 > x0;
        if (frame && !frameLabel && b.key) frameLabel = b.labelText || '';
        if (inside || frame) blanks.splice(k, 1);
      }
      // a label just left of the boxes ("CNP |_|_|…") beats the line above; a table cell holding the boxes gives its label too
      const above = textAbove(r), left = textLeft(r);
      const label = left || above || frameLabel;
      // rows under "Father's or Parent 1's full name" are about that parent, until the next block of the form
      if (prevRow && prevRow.bottom - r.top > 40) about = null;
      if (/\b(father|mother|parent [12]|tat[aă]l|mama)/i.test(label)) about = label;
      let key = label ? classify(label, env.compiled, { ...opts, maxTail: 30, window: label }) : null;
      const size = clamp(Math.min((r.top - r.bottom) * 0.62, r.pitch * 0.95), 6, 12);
      const it = { kind: 'text', page: pi, key, x: x0 + 1, y: r.bottom + (r.top - r.bottom - size * 0.72) / 2, size, maxW: 0, cover: null,
        boxes: r.cells, grid: true, caps: wantsCaps && !/mail/i.test(label), dateBoxes: !!r.date, before: label.slice(-48), labelText: label, after: '', where: 'page ' + (pi + 1) + ' · boxes', canImage: false, section: about || undefined };
      // a row right under another, with no label of its own, carries on the same answer (address line 2, 3…)
      if (!label && prevRow && prevRow.item.page === pi && prevRow.bottom - r.top < 14 && Math.abs(prevRow.cells[0].x0 - x0) < 4) {
        it.continues = prevRow.item;
        it.key = prevRow.item.key; it.optional = true;
        prevRow.item.next = it;
      } else if (!label) it.optional = true;
      blanks.push(it);
      prevRow = { ...r, item: it };
    }
  });

  // 6) Drawn tick boxes next to a choice word ("Male ▢  Female ▢"): an X goes in the one that matches
  pages.forEach((P, pi) => {
    const V = P.gridV || P.vrules;
    const H = P.rules.filter((r) => r.x1 - r.x0 >= 6 && r.x1 - r.x0 <= 16);
    for (const top of H) {
      const w = top.x1 - top.x0;
      const bot = H.find((r) => r !== top && top.y - r.y > w * 0.6 && top.y - r.y < w * 1.5 && Math.abs(r.x0 - top.x0) < 1.5 && Math.abs(r.x1 - top.x1) < 1.5);
      if (!bot) continue;
      const side = (x) => V.some((v) => Math.abs(v.x - x) < 2 && v.y0 <= bot.y + 2 && v.y1 >= top.y - 2 && v.y1 - v.y0 < (top.y - bot.y) * 1.6);
      if (!side(top.x0) || !side(top.x1)) continue;
      const box = { x0: top.x0, x1: top.x1, y0: bot.y, y1: top.y };
      // part of a row of letter boxes, not a lone tick box
      if (blanks.some((b) => b.page === pi && b.grid && b.boxes.some((c) => Math.abs(c.x0 - box.x0) < 2) && Math.abs(b.y - box.y0) < 6)) continue;
      // the word right after the box, or right before it
      const mid = (box.y0 + box.y1) / 2;
      let word = '';
      for (const l of P.lines) {
        if (Math.abs(lineYAt(l, box.x1) + l.size * 0.3 - mid) > Math.max(4, (box.y1 - box.y0) * 0.6)) continue;
        // whichever word is closer: "Male ▢ Female ▢" has the words before, "▢ Da ▢ Nu" after
        const after = l.chars.findIndex((c, i) => /\S/.test(l.str[i]) && c.x0 > box.x1 - 1 && c.x0 < box.x1 + 12);
        let before = -1;
        l.chars.forEach((c, i) => { if (/\S/.test(l.str[i]) && c.x1 < box.x0 + 1 && c.x1 > box.x0 - 12) before = i; });
        if (after < 0 && before < 0) continue;
        const dA = after >= 0 ? l.chars[after].x0 - box.x1 : 1e9, dB = before >= 0 ? box.x0 - l.chars[before].x1 : 1e9;
        word = dA < dB ? /^\S+/.exec(l.str.slice(after))[0] : /\S+$/.exec(l.str.slice(0, before + 1))[0];
        break;
      }
      word = word.replace(/[^\p{L}\p{N}]+$/u, '').replace(/^[^\p{L}\p{N}]+/u, '');
      if (!canonGender(norm(word))) continue;
      for (let k = blanks.length - 1; k >= 0; k--) {
        const b = blanks[k];
        if (b.page === pi && b.kind !== 'field' && !b.grid && b.x >= box.x0 - 3 && b.x <= box.x1 + 3 && b.y >= box.y0 - 3 && b.y <= box.y1 + 3) blanks.splice(k, 1);
      }
      const size = clamp((box.y1 - box.y0) * 0.8, 6, 12);
      blanks.push({ kind: 'text', page: pi, key: 'gender', option: word, mark: true, x: box.x0 + (box.x1 - box.x0 - size * 0.62) / 2, y: box.y0 + (box.y1 - box.y0 - size * 0.72) / 2,
        size, maxW: 0, cover: null, before: '☐ ' + word, labelText: word, after: '', where: 'page ' + (pi + 1) + ' · tick box', canImage: false });
    }
  });

  function sigPlacement(it, l, b) {
    it.kind = 'image';
    it.h = clamp(l.size * 2.8, 22, 44);
    it.w = it.h * sig.w / sig.h;
    it.y = l.y - 0.3 * l.size;
    if (b.kind === 'insert' && it.maxW < it.w * 0.6) { it.x = l.x0; it.y = l.y - it.h - 3; }
  }

  // reading order (top to bottom, left to right), so neighbouring blanks can inform each other
  const rowOf = (b) => -Math.round((b.kind === 'field' ? b.rect.y + b.rect.h / 2 : b.y) / 6);
  const xOf = (b) => (b.kind === 'field' ? b.rect.x : b.x);
  blanks.sort((a, b) => a.page - b.page || rowOf(a) - rowOf(b) || xOf(a) - xOf(b));
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

function boxChars(t) { return String(t).replace(/[\s.\-/]/g, ''); }
// what goes in each box of a row; long answers carry on into the rows below (it.next)
function cellChars(b, text) {
  if (!b.grid) return boxChars(text);
  let t = String(text);
  if (/^(birth_date|today|id_issue_date|id_expiry_date|cnp|phone|postal_code|iban|id_number)$/.test(b.key || '')) t = t.replace(/[\s.\-/]/g, '');
  if (b.caps) t = t.toLocaleUpperCase('ro');
  let skip = 0;
  for (let p = b.continues; p; p = p.continues) skip += p.boxes.length;
  return Array.from(t).slice(skip, skip + b.boxes.length).join('');
}

function fitSize(b, text) {
  let size = b.size;
  if (b.maxW && b.maxW > 10) {
    const w = textWidth(text, size);
    if (w > b.maxW) size = Math.max(size * 0.62, size * b.maxW / w);
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
  const touched = [];
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
        if (val.check) { const cb = form.getCheckBox(b.fieldName); cb.check(); touched.push(cb); continue; }
        if (val.choice != null) {
          const f = form.getField(b.fieldName);
          f.select(val.choice);
          formTouched = true; touched.push(f);
          continue;
        }
      } catch (e) { console.warn('could not set', b.fieldName, e); continue; }
      if (b.fieldType !== 'text') continue;
      const f = form.getTextField(b.fieldName);
      let t = val.text;
      if (b.maxLen && t.length > b.maxLen) t = t.slice(0, b.maxLen);
      try { f.setText(t); } catch (e) { console.warn('could not set', b.fieldName, e); continue; }
      formTouched = true; touched.push(f);
      continue;
    }
    if (val.image) {
      const im = await sigImage(val.image);
      page.drawImage(im, { x: b.x, y: b.y, width: b.w, height: b.h });
      continue;
    }
    if (b.boxes) {
      const chars = Array.from(cellChars(b, val.text));
      b.boxes.forEach((bx, i) => {
        if (!chars[i]) return;
        const w = font.widthOfTextAtSize(chars[i], b.size);
        page.drawText(chars[i], { x: (bx.x0 + bx.x1) / 2 - w / 2, y: b.y + (b.y0shift || 0), size: b.size, font, color: ink });
      });
      continue;
    }
    if (b.cover && opts.cover) page.drawRectangle({ x: b.cover.x, y: b.cover.y, width: b.cover.w, height: b.cover.h, color: PDFLib.rgb(1, 1, 1) });
    page.drawText(val.text, { x: b.x, y: b.y, size: fitSize(b, val.text), font, color: ink });
  }
  if (form) { try { form.deleteXFA(); } catch { /* not an XFA form */ } } // so every viewer shows the normal fields
  if (formTouched || touched.length) {
    // redraw only the fields we changed; a broken field elsewhere must not stop the save
    let failed = false;
    for (const f of touched) {
      try {
        if (f instanceof PDFLib.PDFTextField || f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) f.updateAppearances(font);
        else if (f.updateAppearances) f.updateAppearances();
      } catch (e) { failed = true; console.warn('appearance', e); }
    }
    // if some could not be drawn, ask the PDF viewer to draw the fields itself
    if (failed) { try { form.acroForm.dict.set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.True); } catch { /* ignore */ } }
  }
  if (form && opts.flatten) { try { form.flatten({ updateFieldAppearances: false }); } catch (e) { console.warn('flatten failed', e); } }
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
    if (!P || !P.vp || (b.optional && !b.key)) return;
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
      el = h('div', { class: 'ov text' + (val ? '' : ' missing'), text: b.boxes && val ? '' : text });
      if (b.boxes && val) {
        // one character in the middle of each box
        const chars = Array.from(cellChars(b, val.text));
        el.style.width = (b.boxes[b.boxes.length - 1].x1 - b.boxes[0].x0) * s + 'px';
        el.style.height = size * s + 'px';
        b.boxes.forEach((bx, i) => {
          if (!chars[i]) return;
          const c = h('span', { text: chars[i] });
          Object.assign(c.style, { position: 'absolute', left: ((bx.x0 + bx.x1) / 2 - b.boxes[0].x0) * s + 'px', transform: 'translateX(-50%)' });
          el.append(c);
        });
      }
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
      b.kind !== 'image' && !['check', 'radio', 'choice', 'sig'].includes(b.fieldType) ? this.app.valueEditor(b, () => { this.app.refreshRow(b); this.app.syncRowValue(b); }) : null,
      b.kind === 'text' ? h('button', { class: 'mini', title: 'Smaller', onclick: () => { b.size = Math.max(5, b.size - 1); this.draw(b); this.select(b); } }, 'A−') : null,
      b.kind === 'text' ? h('button', { class: 'mini', title: 'Bigger', onclick: () => { b.size = Math.min(40, b.size + 1); this.draw(b); this.select(b); } }, 'A+') : null,
      b.kind !== 'field' ? h('button', { class: 'mini danger', title: 'Remove', onclick: () => this.app.removeBlank(b) }, '✕') : null,
    );
    const P = this.sess.pages[b.page];
    tb.style.left = Math.max(0, Math.min(parseFloat(el.style.left), P.vp.width - 470)) + 'px';
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
