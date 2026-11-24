'use strict';
// Reading scans and photos (OCR) with Tesseract, fully offline.
// The engine, its wasm and the Romanian + English language data are stored inside this file
// (base64 blocks that only get decoded the first time a scan is opened).

let _ocrWorker = null;

function ocrAvailable() { return typeof Tesseract !== 'undefined' && !!document.getElementById('ocr-wasm'); }

async function getOcr(progress) {
  if (_ocrWorker) return _ocrWorker;
  const b64 = (id) => document.getElementById(id).textContent.trim();
  // A file:// page can't let a worker load other blob URLs, so the worker script carries everything:
  // the data as base64, a fetch() that answers from it, then the engine code itself.
  const boot = `
    const D = { wasm: "${b64('ocr-wasm')}", ron: "${b64('ocr-ron')}", eng: "${b64('ocr-eng')}" };
    const bytes = (k) => { const s = atob(D[k]); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
    const _f = self.fetch && self.fetch.bind(self);
    self.fetch = async (u, o) => {
      u = String(u);
      const m = /af-lang\\/(\\w+)\\.traineddata/.exec(u);
      if (m) return new Response(bytes(m[1]));
      if (/\\.wasm(\\?|#|$)/.test(u)) return new Response(bytes('wasm'), { headers: { 'Content-Type': 'application/wasm' } });
      return _f(u, o);
    };
    ${atob(b64('ocr-core'))}
    ;${atob(b64('ocr-worker'))}`;
  const bootUrl = URL.createObjectURL(new Blob([boot], { type: 'text/javascript' }));
  _ocrWorker = await Tesseract.createWorker(['ron', 'eng'], 1, {
    workerPath: bootUrl, workerBlobURL: false, langPath: 'af-lang', cacheMethod: 'none', gzip: true,
    logger: (m) => progress && m.status && progress(m.status, m.progress),
  });
  await _ocrWorker.setParameters({ preserve_interword_spaces: '1' });
  return _ocrWorker;
}

// Finds what a scan uses as blanks — solid lines ("____", underlines) and dotted lines ("......") —
// records them, then paints them white so the text reader sees clean labels.
function cleanScan(canvas) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  // two thresholds: lines in scans are often thin and grey, text dots are solid
  const dark = new Uint8Array(W * H), ink = new Uint8Array(W * H);
  for (let i = 0, p = 0; p < W * H; i += 4, p++) { const v = d[i] + d[i + 1] + d[i + 2]; dark[p] = v < 500 ? 1 : 0; ink[p] = v < 360 ? 1 : 0; }
  const found = [];

  // 1) solid horizontal runs
  const minRun = Math.round(W * 0.045);
  const runs = [], shorts = [];
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const k = x < W && dark[y * W + x];
      if (k && start < 0) start = x;
      else if (!k && start >= 0) { if (x - start >= minRun) runs.push({ x0: start, x1: x, y }); else if (x - start >= W * 0.008) shorts.push({ x0: start, x1: x, y }); start = -1; }
    }
  }
  // join runs on touching rows into lines; a slanted line spans many rows but stays thin in each column
  const solid = [];
  let active = [];
  for (const r of runs) {
    let comp = null;
    for (const c of active) {
      if (c.lastY < r.y - 1) continue;
      if (c.last.some((q) => q.x0 <= r.x1 && q.x1 >= r.x0)) { comp = c; break; }
    }
    if (!comp) { comp = { runs: [], last: [], lastY: r.y, cur: [] }; solid.push(comp); active.push(comp); }
    if (comp.lastY !== r.y) { comp.last = comp.cur.length && comp.curY === r.y - 1 ? comp.cur : comp.last; comp.cur = []; }
    comp.runs.push(r); comp.cur.push(r); comp.curY = r.y; comp.lastY = r.y;
    if (comp.last.length === 0) comp.last = [r];
    if (r.y % 64 === 0) active = active.filter((c) => c.lastY >= r.y - 2);
  }
  for (const c of solid) {
    const x0 = Math.min(...c.runs.map((r) => r.x0)), x1 = Math.max(...c.runs.map((r) => r.x1));
    const cov = new Uint16Array(x1 - x0 + 1);
    for (const r of c.runs) for (let x = r.x0; x < r.x1; x++) cov[x - x0]++;
    const nz = [...cov].filter((v) => v).sort((a, b) => a - b);
    c.x0 = x0; c.x1 = x1; c.thick = nz[nz.length >> 1] || 0;
    // the line's height where its left end is (what text sits on)
    const ys = c.runs.filter((r) => r.x0 <= x0 + (x1 - x0) * 0.25);
    c.y0 = Math.min(...(ys.length ? ys : c.runs).map((r) => r.y));
    c.y1 = Math.max(...(ys.length ? ys : c.runs).map((r) => r.y));
  }
  for (const l of solid) {
    if (l.thick > Math.max(8, W / 200) || l.x1 - l.x0 < minRun) continue;
    // "|__|__|__|": bars standing on the line at even steps -> one box per character
    if (l.x1 - l.x0 < W * 0.45) {
      const bars = [];
      for (let x = l.x0; x <= l.x1; x++) {
        let hgt = 0;
        for (let y = l.y0 - 1; y > Math.max(0, l.y0 - W * 0.03) && dark[y * W + x]; y--) hgt++;
        if (hgt >= W * 0.006) { const last = bars[bars.length - 1]; if (last && x - last.x1 <= 2) last.x1 = x; else bars.push({ x0: x, x1: x }); }
      }
      if (bars.length >= 6) {
        const steps = bars.slice(1).map((b, i) => (b.x0 + b.x1) / 2 - (bars[i].x0 + bars[i].x1) / 2);
        const avg = steps.reduce((a, b) => a + b, 0) / steps.length;
        if (steps.every((st) => Math.abs(st - avg) < avg * 0.3)) {
          l.cells = bars.slice(1).map((b, i) => [bars[i].x1 + 1, b.x0 - 1]);
          l.bars = bars;
        }
      }
    }
    found.push(l);
  }

  // 2) dotted lines: rows of small blobs at the same height
  const lab = new Int32Array(W * H);
  const parent = [0];
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  let next = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (!ink[p]) continue;
    const a = x > 0 ? lab[p - 1] : 0, b = y > 0 ? lab[p - W] : 0;
    if (a && b) { const ra = find(a), rb = find(b); lab[p] = Math.min(ra, rb); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); }
    else if (a || b) lab[p] = a || b;
    else { lab[p] = next; parent.push(next); next++; }
  }
  const box = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = lab[y * W + x];
    if (!l) continue;
    const r = find(l);
    let b = box.get(r);
    if (!b) box.set(r, b = { x0: x, x1: x, y0: y, y1: y, n: 0 });
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; b.n++;
  }
  const maxDot = Math.max(4, Math.round(W * 0.0045));
  // a dot is small, roughly round and solid (letter fragments are thin strokes)
  const dots = [...box.values()].filter((b) => {
    const w = b.x1 - b.x0 + 1, hh = b.y1 - b.y0 + 1;
    return w <= maxDot && hh <= maxDot && b.n >= 3 && w / hh < 2.2 && hh / w < 2.2 && b.n / (w * hh) >= 0.45;
  })
    .map((b) => ({ ...b, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 }))
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  // walk left to right, following the row even if the page is a bit tilted
  dots.sort((a, b) => a.cx - b.cx);
  const used = new Uint8Array(dots.length);
  const maxGap = Math.max(maxDot * 4, W * 0.008);
  for (let i = 0; i < dots.length; i++) {
    if (used[i]) continue;
    const chain = [i];
    let last = dots[i];
    for (let j = i + 1; j < dots.length; j++) {
      const c = dots[j];
      if (c.x0 - last.x1 > maxGap) break;
      if (used[j] || c.cx <= last.cx || Math.abs(c.cy - last.cy) > maxDot * 0.6) continue;
      chain.push(j); last = c;
    }
    const first = dots[chain[0]];
    // leaders are regular: similar dot sizes, similar spacing
    const steps = chain.slice(1).map((k, n) => dots[k].cx - dots[chain[n]].cx).sort((a, b) => a - b);
    const medStep = steps[steps.length >> 1] || 0;
    const sizes = chain.map((k) => dots[k].n).sort((a, b) => a - b);
    const medSize = sizes[sizes.length >> 1] || 0;
    const regular = steps.filter((g) => g <= medStep * 1.8).length >= steps.length * 0.85
      && sizes.filter((z) => z <= medSize * 2.5 && z >= medSize / 2.5).length >= sizes.length * 0.85;
    // trim stray bits at the ends (a comma, the edge of the next letter)
    const ok = (k) => dots[k].n <= medSize * 2.5 && dots[k].n >= medSize / 2.5;
    while (chain.length > 2 && (dots[chain[chain.length - 1]].cx - dots[chain[chain.length - 2]].cx > medStep * 1.4 || !ok(chain[chain.length - 1]))) chain.pop();
    while (chain.length > 2 && (dots[chain[1]].cx - dots[chain[0]].cx > medStep * 1.4 || !ok(chain[0]))) chain.shift();
    if (chain.length >= 6 && regular && dots[chain[chain.length - 1]].x1 - dots[chain[0]].x0 >= W * 0.03) {
      chain.forEach((k) => { used[k] = 1; });
      const ds = chain.map((k) => dots[k]);
      const left = ds.slice(0, Math.max(3, Math.ceil(ds.length / 4))); // a tilted line: its height where text starts
      found.push({ x0: ds[0].x0, x1: ds[ds.length - 1].x1, y0: Math.min(...left.map((q) => q.y0)), y1: Math.max(...left.map((q) => q.y1)),
        ey0: Math.min(...ds.map((q) => q.y0)), ey1: Math.max(...ds.map((q) => q.y1)) }); // ey: the whole line, for erasing
    }
  }

  // 3) rows of short underlines side by side: one box per character ("|__|__|__|" for a CNP)
  const shortRuns = shorts;
  const segs = [];
  for (const r of shortRuns.sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    const sgm = segs.find((q) => r.y - q.y1 <= 1 && Math.abs(r.x0 - q.x0) < 3);
    if (sgm) sgm.y1 = r.y; else segs.push({ x0: r.x0, x1: r.x1, y0: r.y, y1: r.y });
  }
  // a box underline is thin and has empty paper above it (text has letters there)
  const emptyAbove = (g) => {
    let darkPx = 0, all = 0;
    const top = Math.max(0, Math.round(g.y0 - W * 0.012)), x0 = g.x0 + 3, x1 = g.x1 - 3;
    for (let y = top; y < g.y0 - 2; y++) for (let x = x0; x < x1; x += 2) { all++; darkPx += ink[y * W + x]; }
    return all > 0 && darkPx / all < 0.04;
  };
  const allSegs = segs.map((g) => ({ ...g, thin: g.y1 - g.y0 <= Math.max(3, W / 500), empty: emptyAbove(g) }));
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i].y1 - segs[i].y0 > Math.max(3, W / 500) || !emptyAbove(segs[i])) segs.splice(i, 1);
  // pieces of the same underline (scan noise breaks them) join up
  segs.sort((a, b) => a.x0 - b.x0);
  const joined = [];
  for (const g of segs) {
    const j = joined.find((q) => Math.abs(q.y0 - g.y0) <= 3 && g.x0 <= q.x1 + 2 && g.x1 >= q.x0 - 2);
    if (j) { j.x0 = Math.min(j.x0, g.x0); j.x1 = Math.max(j.x1, g.x1); j.y0 = Math.min(j.y0, g.y0); j.y1 = Math.max(j.y1, g.y1); } else joined.push({ ...g });
  }
  joined.sort((a, b) => a.x0 - b.x0);
  const usedSeg = new Set();
  for (let i = 0; i < joined.length; i++) {
    if (usedSeg.has(i)) continue;
    const row = [joined[i]], rowIdx = [];
    let maxLen = joined[i].x1 - joined[i].x0;
    for (let j = i + 1; j < joined.length; j++) {
      const a = row[row.length - 1], c = joined[j];
      if (usedSeg.has(j) || Math.abs(c.y0 - a.y0) > 4) continue;
      if (c.x0 - a.x1 > Math.max(maxLen * 0.9, W * 0.004)) break;
      if (c.x1 - c.x0 < maxLen * 0.3) continue;
      row.push(c); rowIdx.push(j);
      maxLen = Math.max(maxLen, c.x1 - c.x0);
    }
    // pieces are only taken once the row is accepted (a date row may still need them)
    if (row.length >= 5) rowIdx.forEach((j) => usedSeg.add(j));
    if (row.length < 5) {
      // dates written as "_ _ /_ _ /_ _ _ _": the slashes make bigger gaps, so try again with more room
      const r2 = [joined[i]];
      let ml = joined[i].x1 - joined[i].x0;
      for (let j = i + 1; j < joined.length; j++) {
        const a = r2[r2.length - 1], c = joined[j];
        if (usedSeg.has(j) || Math.abs(c.y0 - a.y0) > 4) continue;
        if (c.x0 - a.x1 > Math.max(ml * 2.6, W * 0.01)) break;
        if (c.x1 - c.x0 < ml * 0.3 || c.x1 - c.x0 > ml * 3) continue;
        r2.push(c); ml = Math.max(ml, c.x1 - c.x0);
      }
      // groups between the slashes: 2-2-4 is dd/mm/yyyy; 2-4 means the day boxes were lost (touching a word): add them back
      if (r2.length === 6) {
        const gaps = r2.slice(1).map((q, k) => q.x0 - r2[k].x1);
        const small = [...gaps].sort((a, b) => a - b)[1];
        const cuts = gaps.map((g, k) => (g > small * 1.8 ? k : -1)).filter((k) => k >= 0);
        if (cuts.length === 1 && cuts[0] === 1) {
          const pitch = r2[1].x0 - r2[0].x0, slash = r2[2].x0 - r2[1].x1, w = r2[0].x1 - r2[0].x0;
          const x1 = r2[0].x0 - slash, x0 = x1 - pitch;
          r2.unshift({ ...r2[0], x0: x1 - w, x1 }, { ...r2[0], x0: x0 - w, x1: x0 });
          r2.sort((a, b) => a.x0 - b.x0);
        }
      }
      if (r2.length === 8 || r2.length === 6) {
        r2.forEach((q) => usedSeg.add(joined.indexOf(q)));
        found.push({ x0: r2[0].x0, x1: r2[r2.length - 1].x1, y0: Math.min(...r2.map((q) => q.y0)), y1: Math.max(...r2.map((q) => q.y1)),
          cells: r2.map((q) => [q.x0, q.x1]), date: true });
        continue;
      }
    }
    if (row.length >= 5) {
      usedSeg.add(i);
      // evenly spaced boxes from the row's pitch
      const starts = row.map((q) => q.x0);
      const steps = starts.slice(1).map((x, k) => x - starts[k]).sort((p, q) => p - q);
      const pitch = steps[steps.length >> 1];
      const x0 = row[0].x0, x1 = row[row.length - 1].x1;
      const n = Math.max(row.length, Math.round((x1 - x0) / pitch));
      const cells = [];
      for (let k = 0; k < n; k++) cells.push([x0 + k * pitch, x0 + k * pitch + pitch * 0.85]);
      found.push({ x0, x1, y0: Math.min(...row.map((q) => q.y0)), y1: Math.max(...row.map((q) => q.y1)), cells });
    }
  }

  // 4) vertical lines (table borders)
  const vlines = [], shortV = [];
  const minV = Math.round(H * 0.03), minShort = Math.round(H * 0.006);
  for (let x = 0; x < W; x++) {
    let start = -1;
    for (let y = 0; y <= H; y++) {
      const k = y < H && dark[y * W + x];
      if (k && start < 0) start = y;
      else if (!k && start >= 0) {
        // short dividers (boxes of a one-letter-per-box row) are kept apart: only the box finder uses them
        if (y - start >= minShort && y - start < minV) shortV.push({ x, y0: start, y1: y });
        if (y - start >= minV) {
          const l = vlines.find((q) => x - q.x1 <= 1 && start < q.y1 && y > q.y0);
          if (l) { l.x1 = x; l.y0 = Math.min(l.y0, start); l.y1 = Math.max(l.y1, y); l.area += y - start; l.sx += x * (y - start); }
          else vlines.push({ x0: x, x1: x, y0: start, y1: y, area: y - start, sx: x * (y - start) });
        }
        start = -1;
      }
    }
  }

  // erase them from the picture before reading the text
  ctx.fillStyle = '#fff';
  for (const f of found) {
    if (f.runs) for (const r of f.runs) ctx.fillRect(r.x0 - 1, r.y - 2, r.x1 - r.x0 + 3, 5);
    else { const y0 = f.ey0 ?? f.y0, y1 = f.ey1 ?? f.y1; ctx.fillRect(f.x0 - 1, y0 - 2, f.x1 - f.x0 + 3, y1 - y0 + 5); }
    for (const b of f.bars || []) ctx.fillRect(b.x0 - 1, f.y0 - W * 0.03, b.x1 - b.x0 + 3, W * 0.03);
  }
  // thickness = dark area / length (works for slightly slanted lines too)
  const vert = vlines.filter((l) => l.area / Math.max(1, l.y1 - l.y0) <= Math.max(8, W / 200));
  for (const l of vert) { l.xc = l.sx / l.area; ctx.fillRect(l.x0 - 1, l.y0, l.x1 - l.x0 + 3, l.y1 - l.y0); }
  found.vertical = vert;
  // join the short dividers column by column
  const sv = [];
  for (const l of shortV.sort((a, b) => a.y0 - b.y0 || a.x - b.x)) {
    const m = sv.find((q) => l.x - q.x1 <= 1 && l.x >= q.x0 - 1 && l.y0 < q.y1 + 2 && l.y1 > q.y0 - 2);
    if (m) { m.x1 = Math.max(m.x1, l.x); m.y0 = Math.min(m.y0, l.y0); m.y1 = Math.max(m.y1, l.y1); m.n++; }
    else sv.push({ x0: l.x, x1: l.x, y0: l.y0, y1: l.y1, n: 1 });
  }
  found.shortVertical = sv.filter((l) => l.x1 - l.x0 <= Math.max(6, W / 300));
  found.debugSegs = allSegs;
  return found;
}

// Reads one page of a scan. Returns text items (same shape as pdf.js text) and drawn lines.
async function ocrPage(pg, progress) {
  const vp1 = pg.getViewport({ scale: 1 });
  const scale = Math.min(4, 2480 / vp1.width);
  const vp = pg.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const rules = [];
  const found = cleanScan(c);
  const vrules = found.vertical.map((l) => {
    const [x, ya] = vp.convertToPdfPoint(l.xc, l.y0);
    const [, yb] = vp.convertToPdfPoint(l.xc, l.y1);
    return { x, y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
  });
  for (const f of found.sort((a, b) => a.x0 - b.x0)) {
    const [x0, y] = vp.convertToPdfPoint(f.x0, f.y1);
    const [x1] = vp.convertToPdfPoint(f.x1, f.y1);
    const r = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y };
    if (f.cells) { r.cells = f.cells.map(([a, z]) => [vp.convertToPdfPoint(a, f.y1)[0], vp.convertToPdfPoint(z, f.y1)[0]]); r.date = !!f.date; rules.push(r); continue; }
    // pieces of the same line join up
    const m = rules.find((q) => Math.abs(q.y - r.y) < 3 && r.x0 - q.x1 < 12 && r.x1 > q.x0 - 12);
    if (m && !m.cells) { m.x0 = Math.min(m.x0, r.x0); m.x1 = Math.max(m.x1, r.x1); m.y = Math.min(m.y, r.y); } else rules.push(r);
  }
  const worker = await getOcr(progress);
  progress && progress('reading text', 0);
  // "sparse text" mode: forms are labels scattered around the page
  await worker.setParameters({ tessedit_pageseg_mode: '11' });
  const { data } = await worker.recognize(c, {}, { blocks: true, text: false });
  const items = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const ln of p.lines) {
    const bl = ln.baseline;
    for (const w of ln.words) {
      const str = (w.text || '').trim();
      if (!str || w.confidence < 35) continue;
      const midX = (w.bbox.x0 + w.bbox.x1) / 2;
      const baseY = bl && bl.x1 !== bl.x0 ? bl.y0 + (bl.y1 - bl.y0) * (midX - bl.x0) / (bl.x1 - bl.x0) : w.bbox.y1;
      const [x0, y] = vp.convertToPdfPoint(w.bbox.x0, baseY);
      const [x1] = vp.convertToPdfPoint(w.bbox.x1, baseY);
      // font size from the word's height, knowing which letters reach up or hang down
      const asc = /[A-ZĂÂÎȘȚbdfhklt0-9îÎ()\/]/.test(str), desc = /[gjpqyșţşț,;()]/.test(str);
      const factor = asc && desc ? 0.95 : asc ? 0.72 : desc ? 0.7 : 0.5;
      const size = (w.bbox.y1 - w.bbox.y0) / scale / factor;
      items.push({ str, x: Math.min(x0, x1), y, w: Math.abs(x1 - x0), size: clamp(size, 5, 40), family: 'sans-serif', widths: null });
    }
  }
  // the page may be a little tilted: measure it from the text baselines and give every word a
  // "straightened" height (gy) used to group words into lines
  const slopes = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const ln of p.lines) {
    const bl = ln.baseline;
    if (bl && bl.x1 - bl.x0 > c.width * 0.15) slopes.push((bl.y1 - bl.y0) / (bl.x1 - bl.x0));
  }
  slopes.sort((a, b) => a - b);
  const skew = slopes.length ? -slopes[slopes.length >> 1] : 0; // pdf y goes up
  for (const it of items) it.gy = it.y - skew * (it.x + it.w / 2);
  // one size per page is steadier than per word
  const sizes = items.map((i) => i.size).sort((a, b) => a - b);
  const med = sizes[sizes.length >> 1];
  if (med) for (const it of items) if (it.size < med * 1.3) it.size = med;
  for (const it of items) it.size *= 0.92; // our font runs a little larger than typical printed ones
  const gridV = found.shortVertical.map((l) => {
    const [x, ya] = vp.convertToPdfPoint((l.x0 + l.x1) / 2, l.y0);
    const [, yb] = vp.convertToPdfPoint((l.x0 + l.x1) / 2, l.y1);
    return { x, y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
  });
  return { items, rules, vrules, gridV };
}
