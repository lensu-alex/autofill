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
  const dark = new Uint8Array(W * H);
  for (let i = 0, p = 0; p < W * H; i += 4, p++) dark[p] = d[i] + d[i + 1] + d[i + 2] < 360 ? 1 : 0;
  const found = [];

  // 1) solid horizontal runs
  const minRun = Math.round(W * 0.045);
  const runs = [];
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const k = x < W && dark[y * W + x];
      if (k && start < 0) start = x;
      else if (!k && start >= 0) { if (x - start >= minRun) runs.push({ x0: start, x1: x, y }); start = -1; }
    }
  }
  const solid = [];
  for (const r of runs) {
    const l = solid.find((q) => r.y - q.y1 <= 1 && r.x0 < q.x1 && r.x1 > q.x0);
    if (l) { l.y1 = r.y; l.x0 = Math.min(l.x0, r.x0); l.x1 = Math.max(l.x1, r.x1); }
    else solid.push({ x0: r.x0, x1: r.x1, y0: r.y, y1: r.y });
  }
  for (const l of solid) if (l.y1 - l.y0 <= Math.max(6, W / 300)) found.push(l);

  // 2) dotted lines: rows of small blobs at the same height
  const lab = new Int32Array(W * H);
  const parent = [0];
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  let next = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (!dark[p]) continue;
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
      found.push({ x0: ds[0].x0, x1: ds[ds.length - 1].x1, y0: Math.min(...ds.map((q) => q.y0)), y1: Math.max(...ds.map((q) => q.y1)) });
    }
  }

  // erase them from the picture before reading the text
  ctx.fillStyle = '#fff';
  for (const f of found) ctx.fillRect(f.x0 - 1, f.y0 - 2, f.x1 - f.x0 + 3, f.y1 - f.y0 + 5);
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
  for (const f of cleanScan(c).sort((a, b) => a.x0 - b.x0)) {
    const [x0, y] = vp.convertToPdfPoint(f.x0, f.y1);
    const [x1] = vp.convertToPdfPoint(f.x1, f.y1);
    const r = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y };
    // pieces of the same line join up
    const m = rules.find((q) => Math.abs(q.y - r.y) < 3 && r.x0 - q.x1 < 12 && r.x1 > q.x0 - 12);
    if (m) { m.x0 = Math.min(m.x0, r.x0); m.x1 = Math.max(m.x1, r.x1); m.y = Math.min(m.y, r.y); } else rules.push(r);
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
  // one size per page is steadier than per word
  const sizes = items.map((i) => i.size).sort((a, b) => a - b);
  const med = sizes[sizes.length >> 1];
  if (med) for (const it of items) if (it.size < med * 1.3) it.size = med;
  return { items, rules };
}
