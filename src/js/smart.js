'use strict';
// Optional smart matching with a small multilingual AI model that runs on this computer
// (paraphrase-multilingual-MiniLM-L12-v2). It lives in a separate file, autofill-smart.js,
// next to autofill.html. Nothing is sent anywhere: the model compares the words around a blank
// with the ways each field is usually asked for, and picks the closest meaning.

// Questions people write on forms, to help the model with question-style labels
const QUESTIONS = {
  full_name: ['What is your name?', 'Cum vă numiți?', 'Numele dumneavoastră complet'],
  first_name: ['What is your first name?', 'Care este prenumele dumneavoastră?'],
  last_name: ['What is your surname?', 'Care este numele de familie?'],
  address: ['Where do you live?', 'Unde locuiți?', 'What is your home address?', 'Adresa la care locuiți', 'Wohnadresse', 'Lieu de résidence'],
  city: ['In which city do you live?', 'În ce oraș locuiți?'],
  phone: ['What is your phone number?', 'Care este numărul dumneavoastră de telefon?', 'How can we call you?', 'Cum vă putem suna?'],
  email: ['What is your email address?', 'Care este adresa de e-mail?', 'Where can we email you?'],
  birth_date: ['When were you born?', 'Când v-ați născut?', 'Ziua, luna și anul nașterii', 'Data nașterii (zi/lună/an)'],
  birth_place: ['Where were you born?', 'Unde v-ați născut?'],
  school: ['What school do you attend?', 'La ce școală învățați?', 'Ce facultate urmați?'],
  occupation: ['What is your job?', 'Ce meserie aveți?', 'Care este ocupația dumneavoastră?'],
  employer: ['Where do you work?', 'Unde lucrați?', 'Locul de muncă actual'],
  citizenship: ['What is your nationality?', 'Ce cetățenie aveți?'],
  iban: ['Your bank account (IBAN)', 'Contul dumneavoastră bancar'],
  signature: ['Sign here', 'Semnați aici'],
  today: ["Today's date", 'Data de azi'],
};

const Smart = {
  state: 'unknown', // unknown | missing | loading | ready | failed
  ext: null, protos: null, protoFor: null,

  async gunzipB64(b64) {
    const stream = new Blob([b64ToBytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },

  // Loads autofill-smart.js if it sits next to this page
  present() {
    if (window.AF_SMART) return Promise.resolve(true);
    if (this.state === 'missing') return Promise.resolve(false);
    return new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'autofill-smart.js';
      s.onload = () => res(!!window.AF_SMART);
      s.onerror = () => { this.state = 'missing'; res(false); };
      document.head.append(s);
    });
  },

  async load(progress) {
    if (this.ext) return true;
    if (!(await this.present())) return false;
    this.state = 'loading';
    try {
      progress && progress('Starting smart matching…');
      const D = window.AF_SMART;
      const url = async (b64, type) => URL.createObjectURL(new Blob([await this.gunzipB64(b64)], { type }));
      const T = await import(await url(D.transformers, 'text/javascript'));
      const onnx = T.env.backends.onnx;
      onnx.wasm.wasmPaths = { mjs: await url(D.ortMjs, 'text/javascript'), wasm: await url(D.ortWasm, 'application/wasm') };
      onnx.wasm.numThreads = 1;
      onnx.wasm.proxy = false;
      T.env.allowLocalModels = false;
      T.env.useBrowserCache = false;
      T.env.useWasmCache = false;
      const files = {};
      for (const [k, v] of Object.entries(D.files)) files[k] = await this.gunzipB64(v);
      T.env.useCustomCache = true;
      T.env.customCache = {
        async match(req) {
          const u = typeof req === 'string' ? req : req.url;
          const k = Object.keys(files).find((f) => u.endsWith('/' + f));
          return k ? new Response(files[k]) : undefined;
        },
        async put() {},
      };
      this.ext = await T.pipeline('feature-extraction', 'autofill/minilm', { dtype: 'q8', device: 'wasm' });
      this.state = 'ready';
      return true;
    } catch (e) {
      console.warn('smart matching failed to start', e);
      this.state = 'failed';
      return false;
    }
  },

  async embed(texts) {
    const out = await this.ext(texts, { pooling: 'mean', normalize: true });
    return out.tolist();
  },

  // Example wordings for every field, embedded once
  async prototypes(vault) {
    if (this.protos && this.protoFor === vault) return this.protos;
    const items = [];
    const add = (key, text) => { if (text && text.length >= 2) items.push({ key, text }); };
    for (const f of [...FIELD_DEFS, ...SPECIAL_FIELDS]) {
      f.label.split('·').forEach((t) => add(f.key, t.replace(/\(.*?\)/g, '').trim()));
      f.syn.forEach((t) => add(f.key, t));
      (MORE_PHRASES[f.key] || []).forEach((t) => add(f.key, t));
      (QUESTIONS[f.key] || []).forEach((t) => add(f.key, t));
    }
    for (const c of vault?.custom || []) { add(c.key, c.label); (c.aliases || '').split(',').forEach((t) => add(c.key, t.trim())); }
    for (const l of vault?.learned || []) add(l.key, l.phrase);
    const vecs = [];
    for (let i = 0; i < items.length; i += 64) vecs.push(...(await this.embed(items.slice(i, i + 64).map((x) => x.text))));
    items.forEach((x, i) => { x.vec = vecs[i]; });
    this.protos = items; this.protoFor = vault;
    return items;
  },

  // Fills in keys for blanks nothing else recognised. Returns how many it placed.
  async pass(blanks, vault, progress) {
    // unknown blanks, and blanks the letter-similarity only guessed
    const todo = blanks.filter((b) => (!b.key || (b.guess && !b.smart)) && (b.labelText || b.before) && b.fieldType !== 'check' && b.charIndex == null);
    if (!todo.length) return 0;
    if (!(await this.load(progress))) return 0;
    progress && progress('Smart matching: understanding the form…');
    const protos = await this.prototypes(vault);
    const queries = todo.map((b) => {
      const t = String(b.labelText || b.before).split(/_{3,}|\.{4,}|…|\t|\n/).pop()
        .replace(/[\s:,;(]+$/, '').trim();
      return t.split(/\s+/).slice(-7).join(' ');
    });
    const keep = queries.map((q) => q.replace(/[^\p{L}]/gu, '').length >= 3);
    const qs = queries.filter((_, i) => keep[i]);
    if (!qs.length) return 0;
    const qv = await this.embed(qs);
    let placed = 0, j = 0;
    todo.forEach((b, i) => {
      if (!keep[i]) return;
      const v = qv[j++];
      const best = new Map();
      for (const p of protos) {
        let s = 0;
        for (let k = 0; k < v.length; k++) s += v[k] * p.vec[k];
        if (s > (best.get(p.key) || -1)) best.set(p.key, s);
      }
      const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
      const [k1, s1] = ranked[0], s2 = ranked[1] ? ranked[1][1] : 0;
      // the model is only trusted when one field clearly wins
      if (s1 >= (b.key ? 0.7 : 0.6) && s1 - s2 >= 0.1) {
        if (b.fieldType === 'sig' || (k1 === 'signature' && b.canImage === false)) return;
        b.key = k1; b.guess = true; b.smart = true; b.smartScore = s1; placed++;
      }
    });
    return placed;
  },
};
