'use strict';
// Plain text (.txt .md .csv .rtf …) and web pages / HTML forms.

function rtfEscape(s) {
  return s.replace(/[\\{}]/g, (c) => '\\' + c)
    .replace(/[^\x00-\x7f]/g, (c) => { const n = c.charCodeAt(0); return '\\u' + (n > 32767 ? n - 65536 : n) + '?'; });
}

async function processText(bytes, env, ext) {
  const original = decodeText(bytes);
  const lines = original.split(/(\r?\n)/); // keep line endings
  const textLines = lines.filter((_, i) => i % 2 === 0);
  const opts = { docHasPrenume: /prenume/.test(norm(original)) };
  const esc = ext === 'rtf' ? rtfEscape : (s) => s;
  const blanks = [];
  const sections = sectionsOf(textLines);
  textLines.forEach((line, li) => {
    for (const b of findBlanks(line, neighbours(textLines, li))) {
      const key = assignBlank(b, env.compiled, opts);
      const optional = b.kind === 'insert' && !key;
      blanks.push({ key, optional, ...contextSnippet(b), where: 'line ' + (li + 1), kind: b.kind, canImage: false, section: sections[li],
        apply(val) {
          if (val.text == null) return;
          const cur = lines[li * 2];
          lines[li * 2] = cur.slice(0, b.start) + esc(fillValue(line, b, val.text)) + cur.slice(b.end);
        } });
    }
  });
  return {
    blanks,
    async finish() { return new Blob([lines.join('')], { type: 'text/plain;charset=utf-8' }); },
  };
}

const HTML_BLOCKS = new Set(['P', 'DIV', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DT', 'DD', 'LABEL', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'BODY', 'TR', 'TABLE', 'UL', 'OL', 'FORM', 'HEADER', 'FOOTER', 'MAIN', 'FIELDSET', 'CAPTION']);

async function processHtml(bytes, env) {
  const doc = new DOMParser().parseFromString(decodeText(bytes), 'text/html');
  // the output is saved as UTF-8
  doc.querySelectorAll('meta[charset], meta[http-equiv="Content-Type" i]').forEach((m) => m.remove());
  const cm = doc.createElement('meta'); cm.setAttribute('charset', 'utf-8');
  (doc.head || doc.documentElement).prepend(cm);
  const opts = { docHasPrenume: /prenume/.test(norm(doc.body?.textContent || '')) };
  const blanks = [];

  // Real form inputs
  for (const el of doc.querySelectorAll('input, textarea, select')) {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (!['text', 'email', 'tel', 'date', 'number', 'search', 'url', ''].includes(type) && el.tagName === 'INPUT') continue;
    const id = el.getAttribute('id');
    const lab = (id && doc.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label');
    const prev = el.previousSibling && el.previousSibling.textContent;
    const cands = [lab?.textContent, el.getAttribute('aria-label'), el.getAttribute('placeholder'),
      (el.getAttribute('name') || '').replace(/([a-z])([A-Z])/g, '$1 $2'), (id || '').replace(/([a-z])([A-Z])/g, '$1 $2'), prev];
    let key = null, label = '';
    for (const c of cands) { if (c && (key = classify(c, env.compiled, { ...opts, maxTail: 20 }))) { label = c; break; } }
    blanks.push({ key, before: (label || cands.find(Boolean) || el.tagName.toLowerCase()).trim().slice(-48), after: '', where: 'form field', kind: 'input', canImage: false,
      apply(val) {
        if (val.text == null) return;
        if (el.tagName === 'TEXTAREA') el.textContent = val.text;
        else if (el.tagName === 'SELECT') {
          const o = [...el.options].find((o) => norm(o.textContent) === norm(val.text) || norm(o.value) === norm(val.text));
          if (o) { [...el.options].forEach((x) => x.removeAttribute('selected')); o.setAttribute('selected', ''); }
        } else el.setAttribute('value', val.text);
      } });
  }

  // Text blanks in each block of text
  const blockOf = (n) => { let e = n.parentElement; while (e && !HTML_BLOCKS.has(e.tagName)) e = e.parentElement; return e; };
  const groups = new Map();
  const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement && /^(SCRIPT|STYLE|TEXTAREA|OPTION)$/.test(n.parentElement.tagName)) continue;
    const b = blockOf(n);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(n);
  }
  const segsOf = (nodes) => { let pos = 0; return nodes.map((node) => { const s = { start: pos, end: pos + node.data.length, node }; pos = s.end; return s; }); };
  const paras = [...groups.values()];
  const texts = paras.map((nodes) => nodes.map((n) => n.data).join(''));
  const sections = sectionsOf(texts);
  paras.forEach((nodes, i) => {
    const text = texts[i];
    if (!text.trim()) return;
    const segs = segsOf(nodes);
    for (const b of findBlanks(text, neighbours(texts, i))) {
      const key = assignBlank(b, env.compiled, opts);
      const optional = b.kind === 'insert' && !key;
      blanks.push({ key, optional, ...contextSnippet(b), where: 'page text', kind: b.kind, canImage: true, section: sections[i],
        apply(val) {
          if (val.image) {
            const pos = editSegments(segs, b.start, b.end, b.kind === 'insert' ? ' ' : '');
            const img = doc.createElement('img');
            img.setAttribute('src', val.image.dataUrl);
            img.setAttribute('alt', 'signature');
            img.setAttribute('style', 'height:3em;vertical-align:bottom');
            if (pos) { const rest = pos.seg.node.splitText(pos.offset); rest.parentNode.insertBefore(img, rest); }
          } else editSegments(segs, b.start, b.end, fillValue(text, b, val.text));
        } });
    }
  });
  return {
    blanks,
    async finish() { return new Blob(['<!DOCTYPE html>\n' + doc.documentElement.outerHTML], { type: 'text/html;charset=utf-8' }); },
  };
}

/* ---------------- RTF ---------------- */
// Reads the visible text of an RTF file paragraph by paragraph, remembering where each character
// sits in the raw file, so blanks can be found in clean text and replaced in the original.
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'xmlnstbl', 'fldinst']);

function rtfParse(raw) {
  const paras = [];
  let cur = { text: '', map: [] };
  const push = () => { paras.push(cur); cur = { text: '', map: [] }; };
  const cpm = /\\ansicpg(\d+)/.exec(raw);
  const cp = new TextDecoder(cpm ? 'windows-' + cpm[1] : 'windows-1252');
  const stack = [];
  let skip = false, uc = 1, pendingSkip = 0, i = 0;
  const add = (ch, a, b) => { if (skip) return; if (pendingSkip > 0) { pendingSkip--; return; } cur.text += ch; cur.map.push([a, b]); };
  while (i < raw.length) {
    const c = raw[i];
    if (c === '{') { stack.push({ skip, uc }); i++; if (raw.startsWith('\\*', i)) skip = true; continue; }
    if (c === '}') { const st = stack.pop() || { skip: false, uc: 1 }; skip = st.skip; uc = st.uc; i++; continue; }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (c !== '\\') { add(c, i, i + 1); i++; continue; }
    const n = raw[i + 1];
    if (n === '\\' || n === '{' || n === '}') { add(n, i, i + 2); i += 2; continue; }
    if (n === "'") { const byte = parseInt(raw.substr(i + 2, 2), 16); add(cp.decode(new Uint8Array([byte])), i, i + 4); i += 4; continue; }
    if (n === '~') { add(' ', i, i + 2); i += 2; continue; }
    if (n === '_') { add('-', i, i + 2); i += 2; continue; }
    if (n === '\n' || n === '\r') { if (!skip) push(); i += 2; continue; }
    const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i, i + 40));
    if (!m) { i += 2; continue; }
    const word = m[1], param = m[2] != null ? +m[2] : null, end = i + m[0].length;
    if (RTF_SKIP.has(word)) skip = true;
    else if (word === 'uc') uc = param ?? 1;
    else if (word === 'u') { add(String.fromCharCode(param < 0 ? param + 65536 : param), i, end); pendingSkip = skip ? 0 : uc; i = end;
      // the fallback characters after \uN belong to it
      let k = 0, j = end;
      while (k < uc && j < raw.length) { if (raw[j] === '\\' && raw[j + 1] === "'") j += 4; else if (raw[j] === '\\' || raw[j] === '{' || raw[j] === '}') break; else j++; k++; }
      if (cur.map.length && !skip) cur.map[cur.map.length - 1][1] = j;
      pendingSkip = 0; i = j; continue; }
    else if (!skip && (word === 'par' || word === 'line' || word === 'cell' || word === 'row' || word === 'sect' || word === 'page')) push();
    else if (!skip && word === 'tab') add('\t', i, end);
    i = end;
  }
  push();
  return paras;
}

function rtfEscapeText(s) {
  let out = '';
  for (const ch of s) {
    const n = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (n < 128) out += ch;
    else if (n < 65536) out += `{\\uc1\\u${n > 32767 ? n - 65536 : n}?}`;
  }
  return out;
}

async function processRtf(bytes, env) {
  let raw = new TextDecoder('latin1').decode(bytes);
  const paras = rtfParse(raw);
  const texts = paras.map((p) => p.text);
  const sections = sectionsOf(texts);
  const opts = { docHasPrenume: /prenume/.test(norm(texts.join(' '))) };
  const blanks = [];
  const edits = [];
  paras.forEach((p, i) => {
    if (!p.text.trim()) return;
    for (const b of findBlanks(p.text, neighbours(texts, i))) {
      const key = assignBlank(b, env.compiled, opts);
      const optional = b.kind === 'insert' && !key;
      const rawStart = b.end > b.start ? p.map[b.start][0] : (p.map[b.start - 1] || [0, 0])[1];
      const rawEnd = b.end > b.start ? p.map[b.end - 1][1] : rawStart;
      blanks.push({ key, optional, ...contextSnippet(b), where: 'paragraph ' + (i + 1), kind: b.kind, canImage: false, section: sections[i],
        apply(val) { if (val.text != null) edits.push({ rawStart, rawEnd, text: rtfEscapeText(fillValue(p.text, b, val.text)) }); } });
    }
  });
  return {
    blanks,
    async finish() {
      for (const e of edits.sort((a, b) => b.rawStart - a.rawStart)) raw = raw.slice(0, e.rawStart) + e.text + raw.slice(e.rawEnd);
      const out = new Uint8Array(raw.length);
      for (let k = 0; k < raw.length; k++) out[k] = raw.charCodeAt(k) & 0xff;
      return new Blob([out], { type: 'application/rtf' });
    },
  };
}
