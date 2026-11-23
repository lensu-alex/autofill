'use strict';
// Plain text (.txt .md .csv .rtf …) and web pages / HTML forms.

function rtfEscape(s) {
  return s.replace(/[\\{}]/g, (c) => '\\' + c)
    .replace(/[^\x00-\x7f]/g, (c) => { const n = c.charCodeAt(0); return '\\u' + (n > 32767 ? n - 65536 : n) + '?'; });
}

async function processText(bytes, env, ext) {
  const original = dec.decode(bytes);
  const lines = original.split(/(\r?\n)/); // keep line endings
  const textLines = lines.filter((_, i) => i % 2 === 0);
  const opts = { docHasPrenume: /prenume/.test(norm(original)) };
  const esc = ext === 'rtf' ? rtfEscape : (s) => s;
  const blanks = [];
  textLines.forEach((line, li) => {
    for (const b of findBlanks(line, { prevText: textLines[li - 1] || '', nextText: textLines[li + 1] || '' })) {
      const key = assignBlank(b, env.compiled, opts);
      const optional = b.kind === 'insert' && !key;
      blanks.push({ key, optional, ...contextSnippet(b), where: 'line ' + (li + 1), kind: b.kind, canImage: false,
        apply(val) {
          if (val.text == null) return;
          const cur = lines[li * 2];
          lines[li * 2] = cur.slice(0, b.start) + esc(padValue(line, b, val.text)) + cur.slice(b.end);
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
  const doc = new DOMParser().parseFromString(dec.decode(bytes), 'text/html');
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
  paras.forEach((nodes, i) => {
    const text = texts[i];
    if (!text.trim()) return;
    const segs = segsOf(nodes);
    for (const b of findBlanks(text, { prevText: texts[i - 1] || '', nextText: texts[i + 1] || '' })) {
      const key = assignBlank(b, env.compiled, opts);
      const optional = b.kind === 'insert' && !key;
      blanks.push({ key, optional, ...contextSnippet(b), where: 'page text', kind: b.kind, canImage: true,
        apply(val) {
          if (val.image) {
            const pos = editSegments(segs, b.start, b.end, b.kind === 'insert' ? ' ' : '');
            const img = doc.createElement('img');
            img.setAttribute('src', val.image.dataUrl);
            img.setAttribute('alt', 'signature');
            img.setAttribute('style', 'height:3em;vertical-align:bottom');
            if (pos) { const rest = pos.seg.node.splitText(pos.offset); rest.parentNode.insertBefore(img, rest); }
          } else editSegments(segs, b.start, b.end, padValue(text, b, val.text));
        } });
    }
  });
  return {
    blanks,
    async finish() { return new Blob(['<!DOCTYPE html>\n' + doc.documentElement.outerHTML], { type: 'text/html;charset=utf-8' }); },
  };
}
