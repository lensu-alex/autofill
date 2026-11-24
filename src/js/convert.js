'use strict';
// "Save as" another format, offline.
//  - documents (docx, odt, xlsx, pptx, rtf, html, txt) -> simple blocks -> laid out into a real PDF (selectable text)
//  - PDF -> PNG pictures, a Word file with one picture per page, or plain text

let _boldBytes = null;
function boldFontBytes() { return _boldBytes || (_boldBytes = b64ToBytes(FONT_BOLD_B64)); }

/* ---------- reading documents into blocks ----------
   block: {t:'p', runs:[{text, b, i, u, size} | {img:{bytes,type,w,h}}], align, size, before, after, indent}
          {t:'table', rows:[[{blocks:[...]}]], widths:[relative]}
          {t:'break'}                                                                          */

const EMU = 12700; // EMU per point

async function docxBlocks(blob) {
  const zip = await JSZip.loadAsync(blob);
  const W = NS.w;
  const doc = parseXml(await zip.file('word/document.xml').async('string'));
  const relsF = zip.file('word/_rels/document.xml.rels');
  const rels = {};
  if (relsF) for (const r of parseXml(await relsF.async('string')).getElementsByTagNameNS(NS.rel, 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  // default font size and heading styles
  let baseSize = 11;
  const styles = {};
  const stF = zip.file('word/styles.xml');
  if (stF) {
    const st = parseXml(await stF.async('string'));
    const def = st.getElementsByTagNameNS(W, 'rPrDefault')[0];
    const sz = def && def.getElementsByTagNameNS(W, 'sz')[0];
    if (sz) baseSize = +sz.getAttributeNS(W, 'val') / 2 || baseSize;
    for (const s of st.getElementsByTagNameNS(W, 'style')) {
      const id = s.getAttributeNS(W, 'styleId');
      const rpr = s.getElementsByTagNameNS(W, 'rPr')[0];
      const ssz = rpr && rpr.getElementsByTagNameNS(W, 'sz')[0];
      const jc = s.getElementsByTagNameNS(W, 'jc')[0];
      styles[id] = { size: ssz ? +ssz.getAttributeNS(W, 'val') / 2 : null, b: !!(rpr && rpr.getElementsByTagNameNS(W, 'b')[0]), align: jc && jc.getAttributeNS(W, 'val') };
    }
  }
  const imgOf = async (drawing) => {
    const blip = drawing.getElementsByTagNameNS(NS.a, 'blip')[0];
    const ext = drawing.getElementsByTagNameNS('*', 'extent')[0];
    if (!blip || !ext) return null;
    const rid = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
    const target = rels[rid];
    if (!target) return null;
    const f = zip.file('word/' + target.replace(/^\/?word\//, ''));
    if (!f) return null;
    const type = /\.png$/i.test(target) ? 'png' : /\.jpe?g$/i.test(target) ? 'jpg' : null;
    if (!type) return null;
    return { bytes: await f.async('uint8array'), type, w: +ext.getAttribute('cx') / EMU, h: +ext.getAttribute('cy') / EMU };
  };
  const onOff = (el) => el && !/^(0|false|none)$/.test(el.getAttributeNS(W, 'val') || '');
  const para = async (p) => {
    const ppr = kids(p, W, 'pPr')[0];
    const sid = ppr && (kids(ppr, W, 'pStyle')[0] || {}).getAttributeNS?.(W, 'val');
    const sty = styles[sid] || {};
    const heading = /heading|titl/i.test(sid || '');
    const jc = ppr && kids(ppr, W, 'jc')[0];
    const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[(jc && jc.getAttributeNS(W, 'val')) || sty.align] || 'left';
    const ind = ppr && kids(ppr, W, 'ind')[0];
    const indent = ind ? (+(ind.getAttributeNS(W, 'left') || ind.getAttributeNS(W, 'start') || 0)) / 20 : 0;
    const numbered = ppr && kids(ppr, W, 'numPr')[0];
    const runs = [];
    if (numbered) runs.push({ text: '•  ', size: baseSize });
    const walk = async (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === W && c.localName === 'r') {
          const rpr = kids(c, W, 'rPr')[0];
          const g = (name) => rpr && kids(rpr, W, name)[0];
          const sz = g('sz');
          const style = { b: onOff(g('b')) || sty.b || heading, i: onOff(g('i')), u: !!g('u') && (g('u').getAttributeNS(W, 'val') || 'single') !== 'none',
            size: sz ? +sz.getAttributeNS(W, 'val') / 2 : sty.size || (heading ? baseSize + 4 : baseSize) };
          for (const k of c.childNodes) {
            if (k.nodeType !== 1) continue;
            if (k.localName === 't') runs.push({ ...style, text: k.textContent });
            else if (k.localName === 'tab') runs.push({ ...style, text: '    ' });
            else if (k.localName === 'br') runs.push({ ...style, text: '\n' });
            else if (k.localName === 'drawing') { const im = await imgOf(k); if (im) runs.push({ img: im }); }
          }
        } else if (c.localName !== 'pPr' && c.localName !== 'Fallback' && !(c.namespaceURI === W && c.localName === 'p')) await walk(c);
      }
    };
    await walk(p);
    return { t: 'p', runs, align, indent, size: sty.size || baseSize, after: heading ? 6 : 4 };
  };
  const table = async (tbl) => {
    const grid = [...tbl.getElementsByTagNameNS(W, 'gridCol')].filter((g) => closestNS(g, W, 'tbl') === tbl).map((g) => +g.getAttributeNS(W, 'w') || 1);
    const rows = [];
    for (const tr of kids(tbl, W, 'tr')) {
      const row = [];
      for (const tc of kids(tr, W, 'tc')) {
        const span = +((tc.getElementsByTagNameNS(W, 'gridSpan')[0] || { getAttributeNS: () => 1 }).getAttributeNS(W, 'val')) || 1;
        row.push({ blocks: await body(tc), span });
      }
      rows.push(row);
    }
    return { t: 'table', rows, widths: grid };
  };
  const body = async (el) => {
    const out = [];
    for (const c of el.childNodes) {
      if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
      if (c.localName === 'p') out.push(await para(c));
      else if (c.localName === 'tbl') out.push(await table(c));
      else if (c.localName === 'sdt') { const sc = kids(c, W, 'sdtContent')[0]; if (sc) out.push(...await body(sc)); }
    }
    return out;
  };
  const bodyEl = doc.getElementsByTagNameNS(W, 'body')[0];
  // page size and margins (twentieths of a point)
  const sect = bodyEl.getElementsByTagNameNS(W, 'sectPr')[0];
  const pg = sect && sect.getElementsByTagNameNS(W, 'pgSz')[0], mar = sect && sect.getElementsByTagNameNS(W, 'pgMar')[0];
  const page = { w: pg ? +pg.getAttributeNS(W, 'w') / 20 : 595.3, h: pg ? +pg.getAttributeNS(W, 'h') / 20 : 841.9,
    m: mar ? [+mar.getAttributeNS(W, 'top'), +mar.getAttributeNS(W, 'right'), +mar.getAttributeNS(W, 'bottom'), +mar.getAttributeNS(W, 'left')].map((x) => (x || 1134) / 20) : [56, 56, 56, 56] };
  return { page, blocks: await body(bodyEl) };
}

async function odfBlocks(blob) {
  const zip = await JSZip.loadAsync(blob);
  const doc = parseXml(await zip.file('content.xml').async('string'));
  const T = NS.text, TB = NS.table;
  // pictures (e.g. the signature) referenced by draw:image
  const pics = {};
  for (const f of Object.values(zip.files)) if (/^Pictures\/.+\.(png|jpe?g)$/i.test(f.name)) pics[f.name] = { bytes: await f.async('uint8array'), type: /png$/i.test(f.name) ? 'png' : 'jpg' };
  const len = (v) => { const m = /([\d.]+)(cm|mm|in|pt)?/.exec(v || ''); if (!m) return 0; return +m[1] * ({ cm: 28.35, mm: 2.835, in: 72, pt: 1 }[m[2] || 'pt']); };
  const runsOf = (p, heading) => {
    const runs = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { runs.push({ text: c.data, b: heading, size: heading ? 14 : 11 }); continue; }
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === NS.draw && c.localName === 'frame') {
          const im = c.getElementsByTagNameNS(NS.draw, 'image')[0];
          const pic = im && pics[im.getAttributeNS(NS.xlink, 'href')];
          if (pic) runs.push({ img: { ...pic, w: len(c.getAttributeNS(NS.svg, 'width')) || 100, h: len(c.getAttributeNS(NS.svg, 'height')) || 40 } });
          continue;
        }
        if (c.localName === 's') runs.push({ text: ' '.repeat(+(c.getAttributeNS(T, 'c') || 1)), size: 11 });
        else if (c.localName === 'tab') runs.push({ text: '    ', size: 11 });
        else if (c.localName === 'line-break') runs.push({ text: '\n', size: 11 });
        else walk(c);
      }
    };
    walk(p);
    return runs.length ? runs : [{ text: '', size: 11 }];
  };
  const body = (el) => {
    const out = [];
    for (const c of el.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === T && (c.localName === 'p' || c.localName === 'h')) out.push({ t: 'p', runs: runsOf(c, c.localName === 'h'), align: 'left', size: 11, after: 4 });
      else if (c.namespaceURI === TB && c.localName === 'table') {
        const rows = [...c.getElementsByTagNameNS(TB, 'table-row')].filter((r) => closestNS(r, TB, 'table') === c).slice(0, 200)
          .map((r) => kids(r, TB, 'table-cell').slice(0, 30).map((cell) => ({ blocks: body(cell), span: 1 })))
          .filter((r) => r.some((cell) => cell.blocks.some((b) => b.runs && b.runs.some((x) => x.img || (x.text || '').trim()))));
        if (rows.length) out.push({ t: 'table', rows, widths: rows[0].map(() => 1) });
      } else if (['list', 'list-item', 'section', 'text', 'spreadsheet', 'presentation', 'page', 'frame', 'text-box'].includes(c.localName) || c.namespaceURI === NS.draw) out.push(...body(c));
    }
    return out;
  };
  const off = doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'body')[0];
  return { page: { w: 595.3, h: 841.9, m: [56, 56, 56, 56] }, blocks: body(off) };
}

async function xlsxBlocks(blob) {
  // reuse the filler's reader for cell texts: render each sheet's used cells as a table
  const zip = await JSZip.loadAsync(blob);
  const S = NS.s;
  const strings = [];
  const ssF = zip.file('xl/sharedStrings.xml');
  if (ssF) for (const si of parseXml(await ssF.async('string')).getElementsByTagNameNS(S, 'si')) strings.push([...si.getElementsByTagNameNS(S, 't')].map((t) => t.textContent).join(''));
  const blocks = [];
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()) {
    const d = parseXml(await zip.file(name).async('string'));
    const grid = [];
    let maxC = 0;
    for (const c of d.getElementsByTagNameNS(S, 'c')) {
      const p = splitRef(c.getAttribute('r'));
      if (!p) continue;
      const t = c.getAttribute('t'), v = kids(c, S, 'v')[0];
      const text = t === 's' ? strings[+(v && v.textContent)] || '' : t === 'inlineStr' ? [...c.getElementsByTagNameNS(S, 't')].map((x) => x.textContent).join('') : v ? v.textContent : '';
      if (!text) continue;
      (grid[p.r - 1] = grid[p.r - 1] || [])[p.c - 1] = text;
      maxC = Math.max(maxC, p.c);
    }
    const rows = grid.filter(Boolean).slice(0, 300).map((r) => Array.from({ length: Math.min(maxC, 20) }, (_, i) => ({ blocks: [{ t: 'p', runs: [{ text: r[i] || '', size: 10 }], size: 10, after: 0 }], span: 1 })));
    if (blocks.length) blocks.push({ t: 'break' });
    if (rows.length) blocks.push({ t: 'table', rows, widths: rows[0].map(() => 1) });
  }
  return { page: { w: 841.9, h: 595.3, m: [36, 36, 36, 36] }, blocks };
}

async function pptxBlocks(blob) {
  const zip = await JSZip.loadAsync(blob);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const blocks = [];
  for (const [i, n] of names.entries()) {
    if (i) blocks.push({ t: 'break' });
    const d = parseXml(await zip.file(n).async('string'));
    for (const p of d.getElementsByTagNameNS(NS.a, 'p')) {
      const text = [...p.getElementsByTagNameNS(NS.a, 't')].map((t) => t.textContent).join('');
      if (text.trim()) blocks.push({ t: 'p', runs: [{ text, size: 18 }], size: 18, after: 8 });
    }
  }
  return { page: { w: 841.9, h: 595.3, m: [48, 56, 48, 56] }, blocks };
}

function textBlocks(text) {
  return { page: { w: 595.3, h: 841.9, m: [56, 56, 56, 56] }, blocks: text.split(/\r?\n/).map((l) => ({ t: 'p', runs: [{ text: l || ' ', size: 11 }], size: 11, after: 2 })) };
}

async function htmlBlocks(blob) {
  const doc = new DOMParser().parseFromString(await blob.text(), 'text/html');
  const blocks = [];
  const walk = (el) => {
    for (const c of el.children) {
      const tag = c.tagName;
      if (/^(SCRIPT|STYLE|HEAD)$/.test(tag)) continue;
      if (tag === 'TABLE') {
        const rows = [...c.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => ({ blocks: [{ t: 'p', runs: [{ text: td.textContent.trim(), size: 10, b: td.tagName === 'TH' }], size: 10, after: 0 }], span: +td.colSpan || 1 })));
        if (rows.length) blocks.push({ t: 'table', rows, widths: rows[0].map(() => 1) });
      } else if (/^(P|H[1-6]|LI|LABEL|PRE|BLOCKQUOTE|DT|DD)$/.test(tag) || (tag === 'DIV' && !c.querySelector('p,div,table,h1,h2,h3,li'))) {
        const h = /^H([1-6])$/.exec(tag);
        const text = (tag === 'LI' ? '•  ' : '') + c.textContent.replace(/\s+/g, ' ').trim()
          + [...c.querySelectorAll('input,textarea')].map((i) => ' ' + (i.value || i.getAttribute('value') || i.textContent || '')).join('');
        if (text.trim()) blocks.push({ t: 'p', runs: [{ text, b: !!h, size: h ? 22 - +h[1] * 2 : 11 }], size: 11, after: h ? 8 : 4 });
      } else walk(c);
    }
  };
  walk(doc.body || doc.documentElement);
  return { page: { w: 595.3, h: 841.9, m: [56, 56, 56, 56] }, blocks };
}

async function blocksFor(blob, ext) {
  if (/^(docx|docm|dotx)$/.test(ext)) return docxBlocks(blob);
  if (/^(odt|ott|ods|ots|odp|otp|odg)$/.test(ext)) return odfBlocks(blob);
  if (/^(xlsx|xlsm)$/.test(ext)) return xlsxBlocks(blob);
  if (ext === 'pptx') return pptxBlocks(blob);
  if (/^html?$/.test(ext)) return htmlBlocks(blob);
  if (ext === 'rtf') return textBlocks(rtfParse(new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()))).map((p) => p.text).join('\n'));
  return textBlocks(decodeText(new Uint8Array(await blob.arrayBuffer())));
}

/* ---------- laying blocks out on PDF pages ---------- */

async function blocksToPdf(model) {
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(fontBytes(), { subset: true });
  const bold = await doc.embedFont(boldFontBytes(), { subset: true });
  const { w: PW, h: PH, m } = model.page;
  const [mt, mr, mb, ml] = m;
  const ink = PDFLib.rgb(0.07, 0.07, 0.1);
  let page = doc.addPage([PW, PH]);
  let y = PH - mt;
  const newPage = () => { page = doc.addPage([PW, PH]); y = PH - mt; };
  const fontOf = (r) => (r.b ? bold : reg);
  const imgCache = new Map();
  const embed = async (im) => {
    if (!imgCache.has(im.bytes)) imgCache.set(im.bytes, im.type === 'png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes));
    return imgCache.get(im.bytes);
  };

  // split a paragraph into lines of styled pieces that fit width
  const layoutPara = (blk, width) => {
    const pieces = [];
    for (const r of blk.runs) {
      if (r.img) { const sc = Math.min(1, width / r.img.w); pieces.push({ img: r.img, w: r.img.w * sc, h: r.img.h * sc }); continue; }
      const size = r.size || blk.size || 11;
      for (const part of String(r.text).split(/(\n| +)/)) {
        if (!part) continue;
        if (part === '\n') { pieces.push({ br: true }); continue; }
        const safe = part.replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
        let wdt;
        try { wdt = fontOf(r).widthOfTextAtSize(safe, size); } catch { continue; }
        pieces.push({ text: safe, space: /^ +$/.test(part), w: wdt, size, r });
      }
    }
    const lines = [];
    let cur = [], cw = 0;
    const flush = (last) => { while (cur.length && cur[cur.length - 1].space) cur.pop(); lines.push({ items: cur, w: cur.reduce((a, p) => a + p.w, 0), last }); cur = []; cw = 0; };
    for (const p of pieces) {
      if (p.br) { flush(true); continue; }
      if (p.space && !cur.length) continue;
      if (cw + p.w > width && cur.length) flush(false);
      if (p.space && !cur.length) continue;
      cur.push(p); cw += p.w;
    }
    flush(true);
    for (const l of lines) l.h = Math.max(blk.size || 11, ...l.items.map((p) => (p.img ? p.h : p.size))) * (l.items.some((p) => p.img) ? 1.05 : 1.3);
    return lines;
  };
  const drawLines = async (lines, blk, x, width, pg, top) => {
    let yy = top;
    for (const l of lines) {
      const base = yy - l.h * (l.items.some((p) => p.img) ? 1 : 0.8);
      const gaps = l.items.filter((p) => p.space).length;
      const extra = blk.align === 'justify' && !l.last && gaps ? (width - l.w) / gaps : 0;
      let xx = x + (blk.align === 'center' ? (width - l.w) / 2 : blk.align === 'right' ? width - l.w : 0);
      for (const p of l.items) {
        if (p.img) { pg.drawImage(await embed(p.img), { x: xx, y: yy - p.h, width: p.w, height: p.h }); xx += p.w; continue; }
        if (!p.space) {
          pg.drawText(p.text, { x: xx, y: base, size: p.size, font: fontOf(p.r), color: ink });
          if (p.r.u) pg.drawLine({ start: { x: xx, y: base - 1.5 }, end: { x: xx + p.w, y: base - 1.5 }, thickness: 0.5, color: ink });
        }
        xx += p.w + (p.space ? extra : 0);
      }
      yy -= l.h;
    }
    return yy;
  };
  const measureBlocks = (blocks, width) => blocks.reduce((hgt, b) => hgt + (b.t === 'p' ? layoutPara(b, width - (b.indent || 0)).reduce((a, l) => a + l.h, 0) + (b.after ?? 4) : b.t === 'table' ? measureTable(b, width) : 0), 0);
  const colWidths = (tb, width) => {
    const n = Math.max(...tb.rows.map((r) => r.reduce((a, c) => a + (c.span || 1), 0)));
    let ws = (tb.widths || []).slice(0, n);
    while (ws.length < n) ws.push(ws.length ? ws[ws.length - 1] : 1);
    const sum = ws.reduce((a, b) => a + b, 0);
    return ws.map((x) => (x / sum) * width);
  };
  const cellW = (cols, ci, span) => cols.slice(ci, ci + span).reduce((a, b) => a + b, 0);
  const rowHeight = (row, cols) => {
    let ci = 0, hmax = 14;
    for (const c of row) { const wv = cellW(cols, ci, c.span || 1); hmax = Math.max(hmax, measureBlocks(c.blocks, wv - 6) + 6); ci += c.span || 1; }
    return hmax;
  };
  const measureTable = (tb, width) => { const cols = colWidths(tb, width); return tb.rows.reduce((a, r) => a + rowHeight(r, cols), 0) + 6; };

  const drawBlocks = async (blocks, x, width, inCell, pg, top) => {
    let yy = top;
    for (const b of blocks) {
      if (b.t === 'break') { if (!inCell) { newPage(); yy = y; } continue; }
      if (b.t === 'p') {
        const lines = layoutPara(b, width - (b.indent || 0));
        if (!inCell) {
          // keep lines together page by page
          for (const l of lines) {
            if (y - l.h < mb) newPage();
            y = await drawLines([l], b, x + (b.indent || 0), width - (b.indent || 0), page, y);
          }
          y -= b.after ?? 4;
          yy = y;
        } else yy = (await drawLines(lines, b, x + (b.indent || 0), width - (b.indent || 0), pg, yy)) - (b.after ?? 2);
        continue;
      }
      if (b.t === 'table') {
        const cols = colWidths(b, width);
        for (const row of b.rows) {
          const rh = rowHeight(row, cols);
          if (!inCell && y - rh < mb) newPage();
          const tp = inCell ? yy : y;
          const pgx = inCell ? pg : page;
          let cx = x, ci = 0;
          for (const c of row) {
            const wv = cellW(cols, ci, c.span || 1);
            pgx.drawRectangle({ x: cx, y: tp - rh, width: wv, height: rh, borderColor: PDFLib.rgb(0.35, 0.35, 0.4), borderWidth: 0.5 });
            await drawBlocks(c.blocks, cx + 3, wv - 6, true, pgx, tp - 3);
            cx += wv; ci += c.span || 1;
          }
          if (inCell) yy -= rh; else { y -= rh; yy = y; }
        }
        if (!inCell) { y -= 6; yy = y; } else yy -= 4;
      }
    }
    return yy;
  };
  await drawBlocks(model.blocks, ml, PW - ml - mr, false, page, y);
  return doc.save();
}

/* ---------- PDF to other things ---------- */

async function pdfPagesToPng(pdfBytes, scale = 2) {
  const js = await pdfjsOpen(pdfBytes);
  const out = [];
  for (let i = 1; i <= js.numPages; i++) {
    const pg = await js.getPage(i);
    const vp = pg.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push({ blob: await new Promise((r) => c.toBlob(r, 'image/png')), w: vp.width / scale, h: vp.height / scale });
  }
  return out;
}

async function pdfToText(pdfBytes) {
  const js = await pdfjsOpen(pdfBytes);
  const pages = [];
  for (let i = 1; i <= js.numPages; i++) {
    const tc = await (await js.getPage(i)).getTextContent();
    const items = tc.items.filter((it) => it.str).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.abs(it.transform[3]) || 10 }));
    pages.push(buildLines(items).map((l) => l.str.replace(/\t/g, '   ')).join('\n'));
  }
  return pages.join('\n\n\f\n');
}

// one picture per page in a Word file (looks the same, text is not editable)
async function imagesToDocx(images) {
  const W = NS.w;
  const zip = new JSZip();
  const body = [];
  const rels = [];
  images.forEach((im, i) => {
    const rid = 'rIdP' + (i + 1);
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page${i + 1}.png"/>`);
    zip.file(`word/media/page${i + 1}.png`, im.blob);
    const maxW = 6.3 * 914400, cx = Math.round(Math.min(maxW, im.w * EMU)), cy = Math.round(cx * im.h / im.w);
    body.push(`<w:p>${i ? '<w:r><w:br w:type="page"/></w:r>' : ''}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${i + 1}" name="Page ${i + 1}"/><a:graphic xmlns:a="${NS.a}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${i + 1}" name="page${i + 1}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
  });
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="567" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// Turns a filled result into the format you asked for. ext = the result's own type.
async function convertResult(blob, ext, target, base) {
  if (target === 'same' || target === ext) return { blob, name: base + '.' + ext };
  const pdfBytes = async () => (ext === 'pdf' ? new Uint8Array(await blob.arrayBuffer()) : blocksToPdf(await blocksFor(blob, ext)));
  if (target === 'pdf') return { blob: new Blob([await pdfBytes()], { type: 'application/pdf' }), name: base + '.pdf' };
  if (target === 'txt') {
    let text;
    if (ext === 'pdf') text = await pdfToText(new Uint8Array(await blob.arrayBuffer()));
    else {
      const m = await blocksFor(blob, ext);
      const flat = (bs) => bs.map((b) => (b.t === 'p' ? b.runs.map((r) => r.text || '').join('') : b.t === 'table' ? b.rows.map((r) => r.map((c) => flat(c.blocks).replace(/\n/g, ' ')).join('\t')).join('\n') : '')).join('\n');
      text = flat(m.blocks);
    }
    return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), name: base + '.txt' };
  }
  if (target === 'png') {
    const imgs = await pdfPagesToPng(await pdfBytes());
    if (imgs.length === 1) return { blob: imgs[0].blob, name: base + '.png' };
    const zip = new JSZip();
    imgs.forEach((im, i) => zip.file(`${base}-page${i + 1}.png`, im.blob));
    return { blob: await zip.generateAsync({ type: 'blob' }), name: base + '-pages.zip' };
  }
  if (target === 'docx') return { blob: await imagesToDocx(await pdfPagesToPng(await pdfBytes())), name: base + '.docx' };
  throw new Error('Unknown format');
}
