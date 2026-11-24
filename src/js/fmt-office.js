'use strict';
// Word (.docx), OpenDocument (.odt), PowerPoint (.pptx) and Excel (.xlsx).
// Every process*() call reads the file fresh and returns the blanks it found;
// each blank has apply(value) that edits the document, then finish() packs the file.
// value is {text} or {image: {bytes, w, h}}.

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  s: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
};
const SIG_NAME = 'autofill_signature.png';

function kids(el, ns, name) { return [...el.childNodes].filter((c) => c.nodeType === 1 && c.namespaceURI === ns && c.localName === name); }
function closestNS(el, ns, name) {
  for (let n = el.parentNode; n && n.nodeType === 1; n = n.parentNode) if (n.namespaceURI === ns && n.localName === name) return n;
  return null;
}
function preserve(t) { t.setAttributeNS(XML_NS, 'xml:space', 'preserve'); }

// Shared paragraph pass: finds blanks in every paragraph and wires apply()
function paragraphBlanks(paras, segsOf, env, opts, where, insertImage, skipInsert) {
  const out = [];
  const texts = paras.map((p) => textOfSegs(segsOf(p)));
  const sections = sectionsOf(texts);
  paras.forEach((p, i) => {
    if (!texts[i].trim()) return;
    const segs = segsOf(p);
    const text = texts[i];
    for (const b of findBlanks(text, neighbours(texts, i))) {
      if (b.kind === 'insert' && skipInsert && skipInsert(p)) continue;
      const key = assignBlank(b, env.compiled, opts);
      const optional = b.kind === 'insert' && !key; // "Note:" etc. — hidden unless smart matching knows it
      out.push({
        key, optional, ...contextSnippet(b), where, kind: b.kind, section: sections[i], canImage: !!insertImage,
        apply(val) {
          if (val.image) {
            if (!insertImage) return;
            const pos = editSegments(segs, b.start, b.end, b.kind === 'insert' ? ' ' : '');
            insertImage(p, pos, val.image);
          } else {
            const pos = editSegments(segs, b.start, b.end, fillValue(text, b, val.text));
            if (pos && pos.seg.t) preserve(pos.seg.t);
          }
        },
      });
    }
  });
  return out;
}

/* ---------------- Word .docx ---------------- */

function wSegs(p, skip) {
  const W = NS.w, segs = [];
  let pos = 0;
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (skip && skip.has(c)) { segs.push({ start: pos, end: pos + 1, el: null, text: '\uFFFC' }); pos++; continue; } // a form control
      const ln = c.localName;
      if (c.namespaceURI === W) {
        if (ln === 't') {
          if (c.childNodes.length > 1) c.textContent = c.textContent;
          if (!c.firstChild) continue;
          const len = c.firstChild.data.length;
          segs.push({ start: pos, end: pos + len, node: c.firstChild, t: c });
          pos += len;
          continue;
        }
        if (ln === 'tab' && c.parentNode.localName === 'r') { segs.push({ start: pos, end: pos + 1, el: c, text: '\t' }); pos++; continue; }
        if (ln === 'br' || ln === 'cr') { segs.push({ start: pos, end: pos + 1, el: c, text: '\n' }); pos++; continue; }
        if (['p', 'pPr', 'rPr', 'del', 'delText', 'instrText', 'txbxContent', 'tbl'].includes(ln)) continue;
      }
      if (ln === 'Fallback' || ln === 'txbxContent') continue;
      walk(c);
    }
  };
  walk(p);
  return segs;
}

function wCellText(tc) {
  return [...tc.getElementsByTagNameNS(NS.w, 't')].map((t) => t.textContent).join('');
}

function wMakeRun(doc, text, rPr) {
  const r = doc.createElementNS(NS.w, 'w:r');
  if (rPr) r.appendChild(rPr.cloneNode(true));
  const t = doc.createElementNS(NS.w, 'w:t');
  preserve(t);
  t.textContent = text;
  r.appendChild(t);
  return r;
}

// Split the run holding text node t at offset; returns where to insert between the halves
function wSplitRun(t, offset) {
  const r = t.parentNode;
  if (!r || r.localName !== 'r') return null;
  const text = t.textContent;
  const r2 = r.cloneNode(true);
  const k1 = [...r.childNodes], k2 = [...r2.childNodes];
  const idx = k1.indexOf(t);
  k1.forEach((k, i) => { if (i > idx) r.removeChild(k); });
  k2.forEach((k, i) => { if (i < idx && k.localName !== 'rPr') r2.removeChild(k); });
  t.firstChild.data = text.slice(0, offset); preserve(t); // keep the same node: other edits still point at it
  k2[idx].textContent = text.slice(offset); preserve(k2[idx]);
  r.parentNode.insertBefore(r2, r.nextSibling);
  return { parent: r.parentNode, before: r2 };
}

let docPrId = 7300;
function wDrawingRun(doc, rid, img) {
  const cy = 468000; // 1.3 cm
  const cx = Math.round(cy * img.w / img.h);
  const id = ++docPrId;
  const xml = `<w:r xmlns:w="${NS.w}"><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Signature ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${NS.a}" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="${NS.a}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="signature.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  return doc.importNode(parseXml(xml).documentElement, true);
}

function wVal(el, name) {
  const e = el && el.getElementsByTagNameNS(NS.w, name)[0];
  return e ? e.getAttributeNS(NS.w, 'val') || e.getAttribute('w:val') || '' : '';
}

// Text of the paragraph before node (the label of a control)
function wTextBefore(node) {
  const p = closestNS(node, NS.w, 'p');
  if (!p) return '';
  let out = '';
  for (const t of p.getElementsByTagNameNS(NS.w, 't')) {
    if (node.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING && !node.contains(t)) out += t.textContent;
  }
  return out;
}

function wordControls(doc, env, opts, where, imageAt, skip) {
  const out = [];
  // Content controls
  for (const sdt of [...doc.getElementsByTagNameNS(NS.w, 'sdt')]) {
    const pr = kids(sdt, NS.w, 'sdtPr')[0];
    const content = kids(sdt, NS.w, 'sdtContent')[0];
    if (!pr || !content) continue;
    if (['docPartObj', 'picture', 'checkbox', 'group', 'dropDownList', 'comboBox'].some((n) => pr.getElementsByTagNameNS('*', n).length)) continue;
    if (content.getElementsByTagNameNS(NS.w, 'tbl').length || content.getElementsByTagNameNS(NS.w, 'p').length > 1) continue;
    const ts = [...content.getElementsByTagNameNS(NS.w, 't')];
    const placeholder = pr.getElementsByTagNameNS(NS.w, 'showingPlcHdr').length > 0;
    if (!placeholder && ts.map((t) => t.textContent).join('').trim()) continue;
    const name = wVal(pr, 'alias') || wVal(pr, 'tag');
    const before = wTextBefore(sdt);
    const key = (name && classify(name, env.compiled, { ...opts, maxTail: 30 })) || classify(before, env.compiled, { ...opts, window: before });
    skip.add(sdt);
    out.push({
      key, before: (name ? '[' + name + '] ' : '') + before.slice(-40), after: '', where: where || 'form control', kind: 'control', canImage: true,
      apply(val) {
        for (const e of [...pr.getElementsByTagNameNS(NS.w, 'showingPlcHdr')]) e.parentNode.removeChild(e);
        for (const rs of [...content.getElementsByTagNameNS(NS.w, 'rStyle')]) if (/placeholder/i.test(rs.getAttributeNS(NS.w, 'val') || '')) rs.parentNode.removeChild(rs);
        ts.forEach((t, i) => { t.textContent = i === 0 && val.text != null ? val.text : ''; preserve(t); });
        const inPara = !!closestNS(sdt, NS.w, 'p');
        const target = inPara ? content : (content.getElementsByTagNameNS(NS.w, 'p')[0] || content.appendChild(doc.createElementNS(NS.w, 'w:p')));
        if (val.image) imageAt(target, null, val.image);
        else if (!ts.length) target.appendChild(wMakeRun(doc, val.text, null));
      },
    });
  }
  // Legacy text form fields: fldChar begin (with ffData/textInput) … separate … result … end
  for (const fc of [...doc.getElementsByTagNameNS(NS.w, 'fldChar')]) {
    if (fc.getAttributeNS(NS.w, 'fldCharType') !== 'begin') continue;
    const ff = kids(fc, NS.w, 'ffData')[0];
    if (!ff || !ff.getElementsByTagNameNS(NS.w, 'textInput').length) continue;
    const beginRun = fc.parentNode;
    const result = [];
    let state = 'instr';
    for (let r = beginRun.nextSibling; r; r = r.nextSibling) {
      if (r.nodeType !== 1) continue;
      const f = r.getElementsByTagNameNS(NS.w, 'fldChar')[0];
      const type = f && f.getAttributeNS(NS.w, 'fldCharType');
      if (type === 'separate') { state = 'result'; continue; }
      if (type === 'end') break;
      if (state === 'result') result.push(...r.getElementsByTagNameNS(NS.w, 't'));
    }
    if (!result.length) continue;
    const current = result.map((t) => t.textContent).join('');
    if (current.replace(/[\s\u2002\u00a0]/g, '')) continue; // already filled in
    result.forEach((t) => skip.add(t));
    const name = wVal(ff, 'name');
    const before = wTextBefore(beginRun);
    const key = classify(before, env.compiled, { ...opts, window: before }) || (name && classify(name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\d]+/g, ' '), env.compiled, opts));
    out.push({
      key, before: before.slice(-48) || name, after: '', where: where || 'form field', kind: 'control', canImage: false,
      apply(val) { if (val.text != null) result.forEach((t, i) => { t.textContent = i === 0 ? val.text : ''; preserve(t); }); },
    });
  }
  return out;
}

async function processDocx(bytes, env) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n))
    .sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
  if (!names.includes('word/document.xml')) throw new Error('This does not look like a Word document');
  const parts = [];
  for (const name of names) parts.push({ name, xml: parseXml(await zip.file(name).async('string')) });
  const opts = { docHasPrenume: /prenume/.test(norm(parts.map((p) => p.xml.documentElement.textContent).join(' '))) };
  let usedImage = false;

  // Relationship files are loaded up front so images can be inserted synchronously
  const relsCache = {};
  for (const part of parts) {
    const path = part.name.replace(/^word\//, 'word/_rels/') + '.rels';
    const f = zip.file(path);
    part.relsPath = path;
    part.rels = parseXml(f ? await f.async('string') : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.rel}"/>`);
  }
  function relFor(part) {
    if (part.rid) return part.rid;
    const rels = part.rels;
    const ids = new Set([...rels.getElementsByTagNameNS(NS.rel, 'Relationship')].map((r) => r.getAttribute('Id')));
    let rid = 'rIdAF1';
    for (let i = 2; ids.has(rid); i++) rid = 'rIdAF' + i;
    const r = rels.createElementNS(NS.rel, 'Relationship');
    r.setAttribute('Id', rid);
    r.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
    r.setAttribute('Target', 'media/' + SIG_NAME);
    rels.documentElement.appendChild(r);
    relsCache[part.relsPath] = rels;
    part.rid = rid;
    return rid;
  }

  const blanks = [];
  for (const part of parts) {
    const doc = part.xml;
    const where = part.name === 'word/document.xml' ? '' : part.name.replace(/^word\/|\.xml$/g, '');
    const imageAt = (p, pos, img) => {
      usedImage = true;
      const run = wDrawingRun(doc, relFor(part), img);
      const at = pos && pos.seg && pos.seg.t ? wSplitRun(pos.seg.t, pos.offset) : null;
      if (at) at.parent.insertBefore(run, at.before);
      else p.appendChild(run);
    };
    // Tables first: "Nume | (empty)" rows
    const labelCells = new Set();
    for (const tbl of doc.getElementsByTagNameNS(NS.w, 'tbl')) {
      const rows = kids(tbl, NS.w, 'tr').map((tr) => kids(tr, NS.w, 'tc'));
      for (const tb of tableBlanks(rows, wCellText, env.compiled, opts)) {
        labelCells.add(tb.labelCell);
        blanks.push({
          key: tb.key, before: tb.label, after: '', where: where || 'table', kind: 'cell', canImage: true,
          apply(val) {
            let p = kids(tb.cell, NS.w, 'p')[0];
            if (!p) { p = doc.createElementNS(NS.w, 'w:p'); tb.cell.appendChild(p); }
            const rPr = tb.labelCell.getElementsByTagNameNS(NS.w, 'rPr')[0];
            if (val.image) imageAt(p, null, val.image);
            else p.appendChild(wMakeRun(doc, val.text, rPr && rPr.parentNode.localName === 'r' ? rPr : null));
          },
        });
      }
    }
    // Word form controls: content controls ("Click here to enter text") and old FORMTEXT fields
    const skip = new Set();
    blanks.push(...wordControls(doc, env, opts, where, imageAt, skip));
    // text boxes are stored twice (new style + "Fallback" copy for old Word): fill the new one only
    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const paras = [...doc.getElementsByTagNameNS(NS.w, 'p')].filter((p) => !closestNS(p, MC, 'Fallback'));
    blanks.push(...paragraphBlanks(paras, (p) => wSegs(p, skip), env, opts, where, imageAt,
      (p) => { const tc = closestNS(p, NS.w, 'tc'); return tc && labelCells.has(tc); }));
  }

  return {
    blanks,
    async finish(sigBytes) {
      // keep the old-Word copy of each text box the same as the filled one
      const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
      for (const part of parts) {
        for (const ac of [...part.xml.getElementsByTagNameNS(MC, 'AlternateContent')]) {
          const ch = kids(ac, MC, 'Choice')[0], fb = kids(ac, MC, 'Fallback')[0];
          const a = ch && [...ch.getElementsByTagNameNS(NS.w, 'txbxContent')], b = fb && [...fb.getElementsByTagNameNS(NS.w, 'txbxContent')];
          if (!a || !b || a.length !== b.length) continue;
          a.forEach((src, i) => { const dst = b[i]; while (dst.firstChild) dst.removeChild(dst.firstChild); for (const c of src.childNodes) dst.appendChild(c.cloneNode(true)); });
        }
      }
      for (const part of parts) zip.file(part.name, serializeXml(part.xml));
      for (const [path, rels] of Object.entries(relsCache)) zip.file(path, serializeXml(rels));
      if (usedImage && sigBytes) {
        zip.file('word/media/' + SIG_NAME, sigBytes);
        const ct = parseXml(await zip.file('[Content_Types].xml').async('string'));
        const has = [...ct.getElementsByTagNameNS(NS.ct, 'Default')].some((d) => (d.getAttribute('Extension') || '').toLowerCase() === 'png');
        if (!has) {
          const d = ct.createElementNS(NS.ct, 'Default');
          d.setAttribute('Extension', 'png');
          d.setAttribute('ContentType', 'image/png');
          ct.documentElement.insertBefore(d, ct.documentElement.firstChild);
          zip.file('[Content_Types].xml', serializeXml(ct));
        }
      }
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    },
  };
}

/* ---------------- OpenDocument .odt ---------------- */

function oSegs(p) {
  const T = NS.text, segs = [];
  let pos = 0;
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        if (c.data.length) { segs.push({ start: pos, end: pos + c.data.length, node: c }); pos += c.data.length; }
        continue;
      }
      if (c.nodeType !== 1 || c.namespaceURI !== T) continue;
      const ln = c.localName;
      if (ln === 's') {
        const n2 = parseInt(c.getAttributeNS(T, 'c') || '1', 10) || 1;
        segs.push({ start: pos, end: pos + n2, el: c, text: ' '.repeat(n2) }); pos += n2;
      } else if (ln === 'tab') { segs.push({ start: pos, end: pos + 1, el: c, text: '\t' }); pos++; }
      else if (ln === 'line-break') { segs.push({ start: pos, end: pos + 1, el: c, text: '\n' }); pos++; }
      else if (['span', 'a', 'meta', 'ruby', 'ruby-base'].includes(ln)) walk(c);
    }
  };
  walk(p);
  return segs;
}

// Spreadsheets store runs of empty cells/rows as one element "repeated N times"; split before writing
function oUnrepeat(cell) {
  const T = NS.table;
  const row = cell.parentNode;
  const m = +(row.getAttributeNS(T, 'number-rows-repeated') || 1);
  if (m > 1) {
    const rest = row.cloneNode(true);
    row.removeAttributeNS(T, 'number-rows-repeated');
    if (m - 1 > 1) rest.setAttributeNS(T, 'table:number-rows-repeated', String(m - 1)); else rest.removeAttributeNS(T, 'number-rows-repeated');
    row.parentNode.insertBefore(rest, row.nextSibling);
  }
  const n = +(cell.getAttributeNS(T, 'number-columns-repeated') || 1);
  if (n > 1) {
    const rest = cell.cloneNode(true);
    cell.removeAttributeNS(T, 'number-columns-repeated');
    if (n - 1 > 1) rest.setAttributeNS(T, 'table:number-columns-repeated', String(n - 1)); else rest.removeAttributeNS(T, 'number-columns-repeated');
    row.insertBefore(rest, cell.nextSibling);
  }
}

async function processOdt(bytes, env) {
  const zip = await JSZip.loadAsync(bytes);
  const names = ['content.xml', 'styles.xml'].filter((n) => zip.file(n));
  if (!names.includes('content.xml')) throw new Error('This does not look like an OpenDocument file');
  const parts = [];
  for (const name of names) parts.push({ name, xml: parseXml(await zip.file(name).async('string')) });
  const opts = { docHasPrenume: /prenume/.test(norm(parts.map((p) => p.xml.documentElement.textContent).join(' '))) };
  let usedImage = false;

  const frame = (doc, img) => {
    usedImage = true;
    const hCm = 1.3, wCm = +(hCm * img.w / img.h).toFixed(2);
    const f = doc.createElementNS(NS.draw, 'draw:frame');
    f.setAttributeNS(NS.draw, 'draw:name', 'Signature' + (++docPrId));
    f.setAttributeNS(NS.text, 'text:anchor-type', 'as-char');
    f.setAttributeNS(NS.svg, 'svg:width', wCm + 'cm');
    f.setAttributeNS(NS.svg, 'svg:height', hCm + 'cm');
    f.setAttributeNS(NS.draw, 'draw:z-index', '0');
    const im = doc.createElementNS(NS.draw, 'draw:image');
    im.setAttributeNS(NS.xlink, 'xlink:href', 'Pictures/' + SIG_NAME);
    im.setAttributeNS(NS.xlink, 'xlink:type', 'simple');
    im.setAttributeNS(NS.xlink, 'xlink:show', 'embed');
    im.setAttributeNS(NS.xlink, 'xlink:actuate', 'onLoad');
    f.appendChild(im);
    return f;
  };

  const blanks = [];
  for (const part of parts) {
    const doc = part.xml;
    const where = part.name === 'content.xml' ? '' : 'header/footer';
    const imageAt = (p, pos, img) => {
      const f = frame(doc, img);
      if (pos && pos.seg && pos.seg.node) {
        const rest = pos.seg.node.splitText(pos.offset);
        rest.parentNode.insertBefore(f, rest);
      } else p.appendChild(f);
    };
    const labelCells = new Set();
    const isSheet = doc.getElementsByTagNameNS(NS.office, 'spreadsheet').length > 0;
    for (const tbl of doc.getElementsByTagNameNS(NS.table, 'table')) {
      const rows = [...tbl.getElementsByTagNameNS(NS.table, 'table-row')]
        .filter((r) => closestNS(r, NS.table, 'table') === tbl)
        .map((r) => [...r.childNodes].filter((c) => c.nodeType === 1 && c.namespaceURI === NS.table && /table-cell$/.test(c.localName)));
      const cellText = (c) => (c.localName === 'covered-table-cell' ? 'x' : c.textContent);
      for (const tb of tableBlanks(rows, cellText, env.compiled, opts)) {
        labelCells.add(tb.labelCell);
        blanks.push({
          key: tb.key, before: tb.label, after: '', where: where || 'table', kind: 'cell', canImage: true,
          apply(val) {
            oUnrepeat(tb.cell);
            if (isSheet) { tb.cell.setAttributeNS(NS.office, 'office:value-type', 'string'); }
            let p = kids(tb.cell, NS.text, 'p')[0];
            if (!p) { p = doc.createElementNS(NS.text, 'text:p'); tb.cell.appendChild(p); }
            if (val.image) p.appendChild(frame(doc, val.image));
            else p.appendChild(doc.createTextNode(val.text));
          },
        });
      }
    }
    const paras = [...doc.getElementsByTagNameNS(NS.text, 'p'), ...doc.getElementsByTagNameNS(NS.text, 'h')];
    paras.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    blanks.push(...paragraphBlanks(paras, oSegs, env, opts, where, imageAt,
      (p) => { const c = closestNS(p, NS.table, 'table-cell'); return c && labelCells.has(c); }));
  }

  return {
    blanks,
    async finish(sigBytes) {
      for (const part of parts) zip.file(part.name, serializeXml(part.xml));
      if (usedImage && sigBytes) {
        zip.file('Pictures/' + SIG_NAME, sigBytes);
        const mf = zip.file('META-INF/manifest.xml');
        if (mf) {
          const m = parseXml(await mf.async('string'));
          const e = m.createElementNS(NS.manifest, 'manifest:file-entry');
          e.setAttributeNS(NS.manifest, 'manifest:full-path', 'Pictures/' + SIG_NAME);
          e.setAttributeNS(NS.manifest, 'manifest:media-type', 'image/png');
          m.documentElement.appendChild(e);
          zip.file('META-INF/manifest.xml', serializeXml(m));
        }
      }
      const mt = zip.file('mimetype');
      if (mt) zip.file('mimetype', await mt.async('string'), { compression: 'STORE' });
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: mt ? (await mt.async('string')).trim() : 'application/vnd.oasis.opendocument.text' });
    },
  };
}

/* ---------------- PowerPoint .pptx ---------------- */

function aSegs(p) {
  const segs = [];
  let pos = 0;
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === NS.a && c.localName === 't') {
        if (!c.firstChild) continue;
        if (c.childNodes.length > 1) c.textContent = c.textContent;
        segs.push({ start: pos, end: pos + c.firstChild.data.length, node: c.firstChild });
        pos += c.firstChild.data.length;
      } else if (c.namespaceURI === NS.a && c.localName === 'br') { segs.push({ start: pos, end: pos + 1, el: c, text: '\n' }); pos++; }
      else if (c.localName === 'r' || c.localName === 'fld') walk(c);
    }
  };
  walk(p);
  return segs;
}

async function processPptx(bytes, env) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const parts = [];
  for (const name of names) parts.push({ name, xml: parseXml(await zip.file(name).async('string')) });
  const opts = { docHasPrenume: /prenume/.test(norm(parts.map((p) => p.xml.documentElement.textContent).join(' '))) };
  const blanks = [];
  for (const part of parts) {
    const paras = [...part.xml.getElementsByTagNameNS(NS.a, 'p')];
    blanks.push(...paragraphBlanks(paras, aSegs, env, opts, 'slide ' + part.name.match(/\d+/)[0], null));
  }
  return {
    blanks,
    async finish() {
      for (const part of parts) zip.file(part.name, serializeXml(part.xml));
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    },
  };
}

/* ---------------- Excel .xlsx ---------------- */

function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function splitRef(ref) { const m = /^([A-Z]+)(\d+)$/.exec(ref); return m ? { c: colNum(m[1]), r: +m[2] } : null; }

async function processXlsx(bytes, env) {
  const S = NS.s;
  const zip = await JSZip.loadAsync(bytes);
  const ssFile = zip.file('xl/sharedStrings.xml');
  const strings = [];
  if (ssFile) {
    const ss = parseXml(await ssFile.async('string'));
    for (const si of ss.getElementsByTagNameNS(S, 'si')) {
      strings.push([...si.getElementsByTagNameNS(S, 't')].filter((t) => !closestNS(t, S, 'rPh')).map((t) => t.textContent).join(''));
    }
  }
  const names = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const sheets = [];
  for (const name of names) sheets.push({ name, xml: parseXml(await zip.file(name).async('string')) });
  const opts = { docHasPrenume: strings.some((s) => /prenume/.test(norm(s))) };

  const cellValue = (c) => {
    const t = c.getAttribute('t');
    const v = kids(c, S, 'v')[0];
    if (t === 's') return v ? strings[+v.textContent] ?? '' : '';
    if (t === 'inlineStr') return [...c.getElementsByTagNameNS(S, 't')].map((x) => x.textContent).join('');
    return v ? v.textContent : '';
  };
  const setInline = (doc, c, text) => {
    for (const k of [...c.childNodes]) c.removeChild(k);
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(S, 'is');
    const t = doc.createElementNS(S, 't');
    preserve(t);
    t.textContent = text;
    is.appendChild(t);
    c.appendChild(is);
  };

  const blanks = [];
  const edited = [];
  for (const sheet of sheets) {
    const doc = sheet.xml;
    const sheetData = doc.getElementsByTagNameNS(S, 'sheetData')[0];
    if (!sheetData) continue;
    const where = 'sheet ' + sheet.name.match(/\d+/)[0];
    const cells = new Map();
    const rows = new Map();
    for (const row of kids(sheetData, S, 'row')) {
      rows.set(+row.getAttribute('r'), row);
      for (const c of kids(row, S, 'c')) cells.set(c.getAttribute('r'), c);
    }
    const merges = [...doc.getElementsByTagNameNS(S, 'mergeCell')].map((m) => {
      const [a, b] = m.getAttribute('ref').split(':').map(splitRef);
      return { a, b };
    }).filter((m) => m.a && m.b);
    const mergeAt = (r, c) => merges.find((m) => r >= m.a.r && r <= m.b.r && c >= m.a.c && c <= m.b.c);
    const empty = (ref) => { const c = cells.get(ref); return !c || !cellValue(c).trim(); };
    const getOrMake = (ref) => {
      let c = cells.get(ref);
      if (c) return c;
      const { r, c: col } = splitRef(ref);
      let row = rows.get(r);
      if (!row) {
        row = doc.createElementNS(S, 'row');
        row.setAttribute('r', r);
        const after = [...rows.keys()].filter((k) => k > r).sort((a, b) => a - b)[0];
        sheetData.insertBefore(row, after ? rows.get(after) : null);
        rows.set(r, row);
      }
      c = doc.createElementNS(S, 'c');
      c.setAttribute('r', ref);
      const next = kids(row, S, 'c').find((x) => splitRef(x.getAttribute('r')).c > col);
      row.insertBefore(c, next || null);
      cells.set(ref, c);
      return c;
    };

    const taken = new Set();
    for (const [ref, c] of cells) {
      const text = cellValue(c);
      if (!text.trim()) continue;
      const pos = splitRef(ref);
      // Text blanks inside the cell: "Nume: ______"
      const found = findBlanks(text, {}).map((b) => ({ ...b, key: assignBlank(b, env.compiled, opts) }));
      const real = found.filter((b) => b.kind !== 'insert');
      const cellBlank = (list) => {
        const state = { text, c, doc };
        edited.push(state);
        for (const b of list) {
          blanks.push({ key: b.key, ...contextSnippet(b), where: where + ' ' + ref, kind: b.kind, canImage: false,
            apply(val) { if (val.text != null) state.text = state.text.slice(0, b.start) + fillValue(text, b, val.text) + state.text.slice(b.end); } });
        }
      };
      if (real.length) { cellBlank(real); continue; }
      // Label cell with an empty cell to the right (or below)
      const key = text.length <= 60 && classify(text, env.compiled, { ...opts, maxTail: 14 });
      let target = null;
      if (key) {
        const m = mergeAt(pos.r, pos.c);
        const rightCol = (m && m.a.r === pos.r && m.a.c === pos.c ? m.b.c : pos.c) + 1;
        const rm = mergeAt(pos.r, rightCol);
        target = colName(rightCol) + pos.r;
        if (!empty(target) || taken.has(target) || (rm && rm.a.c !== rightCol)) {
          target = colName(pos.c) + (pos.r + 1);
          if (!empty(target) || taken.has(target)) target = null;
        }
      }
      if (!target) {
        const ins = found.filter((b) => b.kind === 'insert' && b.key);
        if (ins.length) cellBlank(ins);
        continue;
      }
      taken.add(target);
      const tref = target;
      blanks.push({ key, before: text, after: '', where: where + ' ' + tref, kind: 'cell', canImage: false,
        apply(val) { if (val.text != null) setInline(doc, getOrMake(tref), val.text); } });
    }
  }
  return {
    blanks,
    async finish() {
      for (const st of edited) if (st.text !== cellValue(st.c)) setInline(st.doc, st.c, st.text);
      for (const sheet of sheets) zip.file(sheet.name, serializeXml(sheet.xml));
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    },
  };
}
