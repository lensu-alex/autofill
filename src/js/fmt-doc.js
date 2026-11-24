'use strict';
// Old Word files (.doc, Word 97–2003). Reads the text (paragraphs and tables) out of the binary
// file and writes a simple .docx, which is then filled like any Word document.

function cfbStreams(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
  if (u32(0) !== 0xE011CFD0 || u32(4) !== 0xE11AB1A1) throw new Error('Not an old Word file');
  const ss = 1 << u16(0x1E), mss = 1 << u16(0x20);
  const sec = (n) => 512 + n * ss; // version 3 files; v4 has 4096-byte sectors and a 4096 header
  const hdr = ss === 4096 ? 4096 : 512;
  const at = (n) => hdr + n * ss;
  const nFat = u32(0x2C), dirStart = u32(0x30), cutoff = u32(0x38), miniFatStart = u32(0x3C), difatStart = u32(0x44);
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(u32(0x4C + i * 4));
  for (let d = difatStart; d < 0xFFFFFFFA && fatSecs.length < nFat;) {
    for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(u32(at(d) + i * 4));
    d = u32(at(d) + ss - 4);
  }
  const fat = [];
  for (const f of fatSecs) for (let i = 0; i < ss / 4; i++) fat.push(u32(at(f) + i * 4));
  const chain = (start, table) => { const out = []; for (let n = start, g = 0; n < 0xFFFFFFFA && g < 1e6; g++) { out.push(n); n = table[n]; } return out; };
  const read = (start, size) => {
    const out = new Uint8Array(size);
    let o = 0;
    for (const n of chain(start, fat)) { const len = Math.min(ss, size - o); if (len <= 0) break; out.set(bytes.subarray(at(n), at(n) + len), o); o += len; }
    return out;
  };
  const dirBytes = (() => { const c = chain(dirStart, fat); return read(dirStart, c.length * ss); })();
  const entries = [];
  for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
    const nl = dirBytes[o + 0x40] | (dirBytes[o + 0x41] << 8);
    const name = new TextDecoder('utf-16le').decode(dirBytes.subarray(o, o + Math.max(0, nl - 2)));
    const dvd = new DataView(dirBytes.buffer, dirBytes.byteOffset + o, 128);
    entries.push({ name, type: dirBytes[o + 0x42], start: dvd.getUint32(0x74, true), size: dvd.getUint32(0x78, true) });
  }
  const root = entries[0];
  const miniStream = read(root.start, root.size);
  const miniFat = [];
  if (miniFatStart < 0xFFFFFFFA) { const mf = read(miniFatStart, chain(miniFatStart, fat).length * ss); const mdv = new DataView(mf.buffer); for (let i = 0; i < mf.length / 4; i++) miniFat.push(mdv.getUint32(i * 4, true)); }
  const streams = {};
  for (const e of entries) {
    if (e.type !== 2) continue;
    if (e.size < cutoff) {
      const out = new Uint8Array(e.size);
      let o = 0;
      for (const n of chain(e.start, miniFat)) { const len = Math.min(mss, e.size - o); if (len <= 0) break; out.set(miniStream.subarray(n * mss, n * mss + len), o); o += len; }
      streams[e.name] = out;
    } else streams[e.name] = read(e.start, e.size);
  }
  void sec;
  return streams;
}

function docText(bytes) {
  const st = cfbStreams(bytes);
  const wd = st.WordDocument;
  if (!wd) throw new Error('Not a Word document');
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  if (dv.getUint16(0, true) !== 0xA5EC) throw new Error('Not a Word 97–2003 document');
  const flags = dv.getUint16(0x0A, true);
  if (flags & 0x0100) throw new Error('This .doc file is password-protected');
  const table = st[(flags & 0x0200) ? '1Table' : '0Table'];
  let p = 32;
  const csw = dv.getUint16(p, true); p += 2 + csw * 2;
  const cslw = dv.getUint16(p, true); const lw = p + 2; p += 2 + cslw * 4;
  p += 2;
  const ccpText = dv.getInt32(lw + 3 * 4, true);
  const fcClx = dv.getUint32(p + 33 * 8, true), lcbClx = dv.getUint32(p + 33 * 8 + 4, true);
  const tv = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let o = fcClx;
  while (table[o] === 0x01) o += 3 + tv.getUint16(o + 1, true); // property records
  if (table[o] !== 0x02) throw new Error('Could not read the text of this .doc');
  const lcb = tv.getUint32(o + 1, true);
  const plc = o + 5;
  const n = (lcb - 4) / 12;
  let text = '';
  const cp1252 = new TextDecoder('windows-1252'), u16 = new TextDecoder('utf-16le');
  for (let i = 0; i < n; i++) {
    const cp0 = tv.getUint32(plc + i * 4, true), cp1 = tv.getUint32(plc + (i + 1) * 4, true);
    const pcd = plc + (n + 1) * 4 + i * 8;
    let fc = tv.getUint32(pcd + 2, true);
    const compressed = (fc & 0x40000000) !== 0;
    const len = cp1 - cp0;
    if (compressed) { fc = (fc & ~0x40000000) >>> 1; text += cp1252.decode(wd.subarray(fc, fc + len)); }
    else text += u16.decode(wd.subarray(fc, fc + len * 2));
  }
  void lcbClx;
  text = text.slice(0, ccpText > 0 ? ccpText : text.length);
  // fields: keep what they show (between separator and end), drop their codes
  let out = '', depth = 0;
  const stack = [];
  for (const ch of text) {
    if (ch === '\x13') { stack.push('code'); continue; }
    if (ch === '\x14') { if (stack.length) stack[stack.length - 1] = 'result'; continue; }
    if (ch === '\x15') { stack.pop(); continue; }
    if (stack.includes('code')) continue;
    out += ch;
  }
  void depth;
  return out.replace(/[\x01\x08\x1f]/g, '').replace(/\x1e/g, '-').replace(/\x0b/g, '\n').replace(/\x0c/g, '\r');
}

// Table cells end with \x07 and each row ends with one more \x07; work out the column count
function splitCells(tokens) {
  for (let cols = 1; cols <= 12; cols++) {
    if (tokens.length % (cols + 1)) continue;
    let ok = true;
    for (let i = cols; i < tokens.length; i += cols + 1) if (tokens[i] !== '') { ok = false; break; }
    if (ok) { const rows = []; for (let i = 0; i < tokens.length; i += cols + 1) rows.push(tokens.slice(i, i + cols)); return rows; }
  }
  return tokens.filter((t) => t !== '').map((t) => [t]);
}

async function docToDocx(bytes) {
  const text = docText(bytes);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const para = (t) => '<w:p>' + t.split('\n').map((line, i) => (i ? '<w:r><w:br/></w:r>' : '') +
    line.split('\t').map((seg, j) => (j ? '<w:r><w:tab/></w:r>' : '') + (seg ? `<w:r><w:t xml:space="preserve">${esc(seg)}</w:t></w:r>` : '')).join('')).join('') + '</w:p>';
  const body = [];
  const table = (cells) => '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((x) => `<w:${x} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') +
    '</w:tblBorders></w:tblPr>' + splitCells(cells).map((r) => '<w:tr>' + r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(c)}</w:tc>`).join('') + '</w:tr>').join('') + '</w:tbl>';
  // \x07 ends a table cell (an empty one ends the row); \r ends a paragraph
  let buf = '', cells = null;
  for (const part of text.split(/([\r\x07])/)) {
    if (part === '\x07') { (cells = cells || []).push(buf); buf = ''; }
    else if (part === '\r') {
      if (cells && !buf) continue;
      if (cells) { body.push(table(cells)); cells = null; }
      body.push(para(buf)); buf = '';
    } else buf += part;
  }
  if (cells) body.push(table(cells));
  if (buf) body.push(para(buf));
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}
