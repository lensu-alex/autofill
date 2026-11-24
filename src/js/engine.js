'use strict';
// Finds blanks in a line/paragraph of text and edits text split across many nodes.

const PH_RE = /\{\{\s*([^{}]{1,60}?)\s*\}\}|«\s*([^«»]{1,60}?)\s*»|\[\[\s*([^\[\]]{1,60}?)\s*\]\]/g;
// "|__|__|__|" one box per character (CNP, codes)
const BOX_RE = /\|(?:[ _\u00a0]{1,4}\|){3,}/g;
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
  for (const m of text.matchAll(BOX_RE)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const cells = [];
    let p = m.index + 1;
    for (const part of m[0].slice(1, -1).split('|')) { cells.push([p, p + part.length]); p += part.length + 1; }
    out.push({ start: m.index, end: m.index + m[0].length, kind: 'boxes', cells });
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
    // "… se face cu:" followed by a list ("1) …", "a) …", "- …") introduces the list, it is not a blank
    if (!rest.trim() && ctx.nextText && /^\s*(\d{1,2}[.)]|[a-zA-Z][.)]|[-•–·])\s/.test(ctx.nextText)) continue;
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
  let k;
  if (b.kind === 'insert') {
    // "Label:" with nothing after it. Sentences that end in ":" ("se face cu:", "I certify that:")
    // are not labels: the label must be short and end with the field word; headings in CAPITALS are skipped.
    const lab = b.label.replace(/\([^)]*\)/g, ' ').split(/[.;!?]\s/).pop().trim();
    const words = lab.split(/\s+/).filter(Boolean);
    const caps = lab.replace(/[^A-Za-zĂÂÎȘȚăâîșț]/g, '');
    if (!words.length || words.length > 7 || (words.length >= 2 && caps.length > 4 && caps === caps.toUpperCase())) return null;
    const listItem = /^\s*(\d{1,2}[.)]|[a-zA-Z][.)]|[-•–·])\s/.test(b.label);
    k = classify(lab, compiled, { ...opts, window: b.window, maxTail: 3, maxLead: 2, fuzzy: words.length <= 3 && !listItem, fuzzyMin: 0.75 });
    if (listItem) b.noSmart = true;
  } else k = classify(b.label, compiled, { ...opts, window: b.window });
  b.guess = !!(k && classify.lastGuess);
  if (!k) {
    // "______ (nume și prenume)" — the hint is after the blank
    const m = /^\s*\(([^)]{2,50})\)/.exec(b.after || '');
    if (m) { k = classify(m[1], compiled, { ...opts, maxTail: 30 }); b.guess = !!(k && classify.lastGuess); }
  }
  return k;
}

// What replaces a blank in text: boxes get one character each, other blanks the padded value
function fillValue(text, b, value) {
  if (b.kind !== 'boxes') return padValue(text, b, value);
  const chars = String(value).replace(/[\s.\-/]/g, '');
  return '|' + b.cells.map(([s, e], i) => (chars[i] || '').padEnd(Math.max(1, Math.min(2, e - s)) , ' ').slice(0, Math.max(1, e - s))).join('|') + '|';
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
  // a cell that has its own blank ("Nume: ____") is filled inside, not next to it
  const isLabel = (t) => t && t.length <= 60 && !findBlanks(t).some((b) => b.kind !== 'insert')
    && classify(t, compiled, { ...opts, maxTail: 14, fuzzyMin: 0.75 });
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
  return { before, after, guess: !!b.guess, noSmart: !!b.noSmart, labelText: (b.kind === 'placeholder' ? b.name : b.label) || '' };
}

// Second look using neighbours: "domiciliat în ____, str. ____ nr. __" wants only the city
// in the first blank, because the street comes separately.
function refineKeys(blanks) {
  applySections(blanks);
  // "anul universitar ......-......": the two halves of the academic year
  blanks.forEach((b, i) => {
    const n = blanks[i + 1];
    if (b.key === 'academic_year' && n && (!n.key || n.key === 'academic_year') && /^\s*[-–\/]\s*$/.test(n.labelText || '')) {
      b.key = 'academic_year_start'; n.key = 'academic_year_end'; b.guess = n.guess = false;
    }
  });
  // "seria ____ nr. ____": a nameless blank right after the ID series is the ID number
  blanks.forEach((b, i) => {
    if (!b.key && i > 0 && blanks[i - 1].key === 'id_series' && b.kind !== 'field' && !b.otherPerson) { b.key = 'id_number'; b.guess = true; }
  });
  blanks.forEach((b, i) => {
    if (b.key !== 'address') return;
    const next = blanks.slice(i + 1, i + 4);
    if (next.some((n) => n.key === 'street' || n.key === 'street_number')) b.key = 'city';
  });
}

// Section headings ("DATE PRIVIND COPIII MINORI", "Date despre soț/soție") tell whose details follow.
// texts: paragraph/line texts in order; returns the heading in force for each one.
function sectionsOf(texts) {
  let cur = '';
  return texts.map((t) => {
    const x = t.trim();
    const letters = x.replace(/[^A-Za-zĂÂÎȘȚăâîșțŞŢşţ]/g, '');
    const caps = letters && letters.replace(/[^A-ZĂÂÎȘȚŞŢ]/g, '').length / letters.length;
    const hasBlank = /_{3,}|\.{4,}|\u2026/.test(x);
    if (x && x.length <= 90 && !hasBlank && letters.length >= 4 && (caps > 0.6 || /:$/.test(x))) cur = x;
    return cur;
  });
}
const OTHER_SECTION = /\b(copil|copii|copiii|copiilor|copilului|minor|minori|minorului|parinti|parintilor|sot|sotie|sotului|sotiei|reprezentant|reprezentantului|imputernicit|imputernicitului|tutore|garant|codebitor|mostenitor|decedat|defunct|child|children|spouse|parent|parents|guardian|representative|requester)\b/;
const SELF_SECTION = /\b(solicitant|solicitantului|subsemnat|titular|titularului|date personale|applicant|your details|personal details|despre dumneavoastra)\b/;
function applySections(blanks) {
  for (const b of blanks) {
    if (!b.section || !b.key || b.key === 'today' || b.key === 'signature') continue;
    const n = norm(b.section);
    if (OTHER_SECTION.test(n) && !SELF_SECTION.test(n)) {
      b.otherKey = b.key; b.key = null; b.guess = false; b.otherPerson = true;
      b.otherRel = /\b(copil|copii|copiii|copiilor|copilului|minor|minori|minorului|child|children)\b/.test(n) ? 'child'
        : /\b(sot|sotie|sotului|sotiei|spouse)\b/.test(n) ? 'spouse'
        : /\b(parinti|parintilor|parent|parents)\b/.test(n) ? 'parent' : 'other';
    }
  }
}

// Nearest non-empty text before/after position i (labels can sit a few empty paragraphs away)
function neighbours(texts, i) {
  let p = i - 1, n = i + 1;
  while (p >= 0 && !texts[p].trim()) p--;
  while (n < texts.length && !texts[n].trim()) n++;
  return { prevText: p >= 0 ? texts[p] : '', nextText: n < texts.length ? texts[n] : '' };
}
