'use strict';
// Finds blanks in a line/paragraph of text and edits text split across many nodes.

const PH_RE = /\{\{\s*([^{}]{1,60}?)\s*\}\}|«\s*([^«»]{1,60}?)\s*»|\[\[\s*([^\[\]]{1,60}?)\s*\]\]/g;
const FILL_RE = /[_.…][_.… \t ]*[_.…]/g;
// "Nume:" followed by a tab, the end of the line, or a wide gap
const COLON_RE = /:(?=[  ]*(?:\t|$)|[  ]{3,}\S)/g;

function isFiller(s) {
  const u = (s.match(/_/g) || []).length;
  const d = (s.match(/\./g) || []).length;
  const e = (s.match(/…/g) || []).length;
  return u + d * 0.75 + e * 2.5 >= 3;
}

// ctx: { prevText, nextText } neighbouring lines, for labels on the line above
function findBlanks(text, ctx = {}) {
  const out = [];
  const overlaps = (a, b) => out.some((x) => a < x.end && b > x.start);

  for (const m of text.matchAll(PH_RE)) {
    out.push({ start: m.index, end: m.index + m[0].length, kind: 'placeholder', name: m[1] || m[2] || m[3] });
  }
  for (const m of text.matchAll(FILL_RE)) {
    let s = m.index, e = s + m[0].length, str = m[0];
    // "str. ____": the first dot ends an abbreviation, it is not part of the blank
    while (/^\.[ \t ]/.test(str) && /[A-Za-zÀ-ž]/.test(text[s - 1] || '')) {
      const cut = str.match(/^\.[ \t ]+/)[0].length;
      s += cut; str = str.slice(cut);
    }
    // "____." the last dot ends the sentence
    if (/[_…]\.$/.test(str)) { e -= 1; str = str.slice(0, -1); }
    if (!str || !isFiller(str) || overlaps(s, e)) continue;
    out.push({ start: s, end: e, kind: 'filler' });
  }
  for (const m of text.matchAll(COLON_RE)) {
    const at = m.index + 1;
    const rest = text.slice(at);
    if (/^[  \t]*[_.…]{3,}/.test(rest) || /^[  \t]*(\{\{|«|\[\[)/.test(rest)) continue;
    if (!rest.trim() && ctx.nextText && /^\s*[_.…]{3,}/.test(ctx.nextText)) continue;
    if (/^\s*$/.test(text.slice(0, at - 1))) continue; // a lone ":"
    if (overlaps(at, at + 1)) continue;
    out.push({ start: at, end: at, kind: 'insert' });
  }
  out.sort((a, b) => a.start - b.start);

  let prev = 0;
  out.forEach((b, i) => {
    const next = out[i + 1] ? out[i + 1].start : text.length;
    b.label = text.slice(prev, b.start);
    b.after = text.slice(b.end, next);
    b.window = ((ctx.prevText || '') + ' \n ' + text.slice(0, b.start)).slice(-160);
    if (!b.label.replace(/[\s,;:]+/g, '') && i === 0 && ctx.prevText) b.label = ctx.prevText.slice(-80);
    prev = b.end;
  });
  return out;
}

// Decide which field a blank should get
function assignBlank(b, compiled, opts) {
  if (b.kind === 'placeholder') {
    const n = norm(b.name).replace(/ /g, '_');
    const direct = compiled.find((f) => f.key === n);
    if (direct) return direct.key[0] === '@' ? null : direct.key;
    return classify(b.name, compiled, { ...opts, maxTail: 40 });
  }
  let k = classify(b.label, compiled, { ...opts, window: b.window, fuzzyMin: b.kind === 'insert' ? 0.75 : opts.fuzzyMin });
  b.guess = !!(k && classify.lastGuess);
  if (!k) {
    // "______ (nume și prenume)" — the hint is after the blank
    const m = /^\s*\(([^)]{2,50})\)/.exec(b.after || '');
    if (m) { k = classify(m[1], compiled, { ...opts, maxTail: 30 }); b.guess = !!(k && classify.lastGuess); }
  }
  return k;
}

// Text to put into a blank, with spaces so it does not touch the label
function padValue(text, b, value) {
  const before = text[b.start - 1];
  const after = text[b.end];
  const left = b.start > 0 && before && !/\s/.test(before) ? ' ' : '';
  const right = after && /[^\s.,;:)\]]/.test(after) ? ' ' : '';
  return left + value + right;
}

// segs: [{start, end, node: Text}] or [{start, end, el: Element}] (tabs, spaces…)
// Deletes [start, end) and inserts text at start. Returns where the insertion ended.
function editSegments(segs, start, end, text) {
  let ins = null;
  if (end > start) ins = segs.find((s) => s.node && s.start <= start && start < s.end);
  if (!ins) ins = [...segs].reverse().find((s) => s.node && s.start < start && start <= s.end);
  if (!ins) ins = segs.find((s) => s.node && s.start >= start);
  if (!ins) ins = segs.find((s) => s.node);

  for (const s of segs) {
    const a = Math.max(start, s.start), b = Math.min(end, s.end);
    if (a >= b) continue;
    if (s.node) {
      const d = s.node.data;
      s.node.data = d.slice(0, a - s.start) + d.slice(b - s.start);
    } else if (s.el && a === s.start && b === s.end && s.el.parentNode) {
      s.el.parentNode.removeChild(s.el);
    }
  }
  if (!ins) return null;
  const off = clamp(start - ins.start, 0, ins.node.data.length);
  ins.node.data = ins.node.data.slice(0, off) + text + ins.node.data.slice(off);
  return { seg: ins, offset: off + text.length };
}

function textOfSegs(segs) { return segs.map((s) => (s.node ? s.node.data : s.text)).join(''); }

// Tables: a label cell followed by an empty cell (or a header row above empty cells)
// rows: Array<Array<cell>>; text(cell) -> string
function tableBlanks(rows, text, compiled, opts) {
  const out = [];
  const used = new Set();
  const isLabel = (t) => t && t.length <= 60 && classify(t, compiled, { ...opts, maxTail: 14, fuzzyMin: 0.75 });
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const t = text(cell).trim();
      const key = isLabel(t);
      if (!key) return;
      const right = row[c + 1];
      if (right && !text(right).trim() && !used.has(right)) {
        used.add(right);
        out.push({ labelCell: cell, cell: right, label: t, key });
        return;
      }
      const below = rows[r + 1]?.[c];
      if (below && !text(below).trim() && !used.has(below) && rows[r + 1].length === row.length) {
        used.add(below);
        out.push({ labelCell: cell, cell: below, label: t, key });
      }
    });
  });
  return out;
}

// Short "…before [blank] after…" for the review table
function contextSnippet(b) {
  const before = (b.window || b.label || '').replace(/\s+/g, ' ').trimStart().slice(-48);
  const after = (b.after || '').replace(/\s+/g, ' ').slice(0, 28);
  return { before, after, guess: !!b.guess, labelText: (b.kind === 'placeholder' ? b.name : b.label) || '' };
}

// Second look using neighbours: "domiciliat în ____, str. ____ nr. __" wants only the city
// in the first blank, because the street comes separately.
function refineKeys(blanks) {
  blanks.forEach((b, i) => {
    if (b.key !== 'address') return;
    const next = blanks.slice(i + 1, i + 4);
    if (next.some((n) => n.key === 'street' || n.key === 'street_number')) b.key = 'city';
  });
}
