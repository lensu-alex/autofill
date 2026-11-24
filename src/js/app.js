'use strict';
// Screens and buttons.

const OFFICE = {
  docx: processDocx, docm: processDocx, dotx: processDocx,
  odt: processOdt, ott: processOdt, ods: processOdt, ots: processOdt, odp: processOdt, otp: processOdt, odg: processOdt,
  pptx: processPptx,
  xlsx: processXlsx, xlsm: processXlsx,
  html: processHtml, htm: processHtml,
  txt: processText, md: processText, csv: processText, tsv: processText, rtf: processRtf, text: processText,
};
const IMAGES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif' };
const APPLE = { pages: 'Pages', numbers: 'Numbers', key: 'Keynote' };
const OLD_FORMATS = { xls: 'Excel', ppt: 'PowerPoint' }; // the Mac app converts these through Numbers/Keynote

// Inside the Mac app: Pages/Numbers/Keynote convert files for us (see app/main.swift)
const Native = {
  ok() { return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native); },
  async convert(bytes, name, to) {
    const r = await window.webkit.messageHandlers.native.postMessage({ op: 'convert', name, data: bytesToB64(bytes), to });
    return b64ToBytes(r.data);
  },
};
const NATIVE_TO = { pages: 'docx', numbers: 'xlsx', key: 'pptx', doc: 'docx', xls: 'xlsx', ppt: 'pptx' };
const NATIVE_BACK = { pages: 'pages', numbers: 'numbers', key: 'key' };

const App = {
  vault: null, k: null, pendingVaultText: null, dirty: false,
  compiled: null, values: {}, sess: null, editor: null, lastActive: Date.now(),

  settings() { return this.vault?.settings || DEFAULT_SETTINGS; },
  cover() { return $('#cover').checked; },

  /* ---------- start / lock ---------- */

  async init() {
    try {
      const ff = new FontFace('AFSans', fontBytes());
      document.fonts.add(await ff.load());
    } catch { /* preview falls back to the system font */ }
    if (!window.crypto?.subtle) {
      $('#view-lock').prepend(h('div', { class: 'notice bad', text: 'This browser blocks encryption for local files. Open the page in Chrome, Edge, Firefox or Safari.' }));
    }
    const stored = storedVault();
    if (stored) { this.pendingVaultText = stored; this.showUnlock('Your vault saved in this browser.'); }
    else this.showCreate();

    $('#unlock-form').addEventListener('submit', (e) => { e.preventDefault(); this.unlock(); });
    $('#create-form').addEventListener('submit', (e) => { e.preventDefault(); this.create(); });
    for (const id of ['#pick-vault', '#pick-vault2']) $(id).addEventListener('click', (e) => { e.preventDefault(); $('#vault-file').click(); });
    $('#show-create').addEventListener('click', (e) => { e.preventDefault(); this.showCreate(); });
    $('#vault-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      this.pendingVaultText = await f.text();
      this.showUnlock('File: ' + f.name);
      e.target.value = '';
    });
    for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { this.lastActive = Date.now(); }, true);
    setInterval(() => this.checkIdle(), 15000);
    window.addEventListener('beforeunload', (e) => { if (this.dirty) { e.preventDefault(); e.returnValue = ''; } });
  },

  showUnlock(src) {
    $('#unlock-card').hidden = false; $('#create-card').hidden = true;
    $('#unlock-src').textContent = src;
    setTimeout(() => $('#unlock-pw').focus(), 0);
  },
  showCreate() { $('#unlock-card').hidden = true; $('#create-card').hidden = false; },

  async unlock() {
    const pw = $('#unlock-pw').value;
    if (!pw || !this.pendingVaultText) return;
    const btn = $('#unlock-form button');
    btn.disabled = true; btn.textContent = 'Unlocking…';
    try {
      const { data, k } = await openVault(this.pendingVaultText, pw);
      if (data.settings.remember && this.pendingVaultText !== storedVault()) storeVault(this.pendingVaultText);
      this.enter(data, k);
    } catch (err) {
      toast(err.message, 'bad');
    } finally { btn.disabled = false; btn.textContent = 'Unlock'; $('#unlock-pw').value = ''; }
  },

  async create() {
    const a = $('#new-pw').value, b = $('#new-pw2').value;
    if (a.length < 8) return toast('Use at least 8 characters', 'bad');
    if (a !== b) return toast('The two passwords are different', 'bad');
    const data = newVaultData();
    data.settings.remember = $('#remember').checked;
    const k = await newVaultKey(a);
    $('#new-pw').value = $('#new-pw2').value = '';
    this.enter(data, k);
    await this.saveVault();
    this.showTab('info');
    toast('Vault created. Fill in your info, then press Save.', 'good', 5000);
  },

  enter(data, k) {
    this.vault = data; this.k = k; this.dirty = false;
    this.refreshValues();
    $('#view-lock').hidden = true; $('#view-app').hidden = false;
    $('#top-right').replaceChildren(h('button', { onclick: () => this.lock(), title: 'Lock (forget everything from memory)' }, '🔒 Lock'));
    this.buildInfo(); this.buildSettings(); this.bindFill(); this.showTab('fill');
  },

  async lock() {
    if (this.dirty) await this.saveVault();
    this.dirty = false;
    location.reload(); // drops every decrypted value from memory
  },

  checkIdle() {
    if (!this.vault) return;
    const mins = +this.settings().autoLock;
    if (mins > 0 && Date.now() - this.lastActive > mins * 60000) this.lock();
  },

  async saveVault() {
    const text = await sealVault(this.vault, this.k);
    if (this.settings().remember) storeVault(text);
    else download(new Blob([text], { type: 'application/json' }), 'my-info.vault');
    this.dirty = false;
    $('#dirty').hidden = true;
    return text;
  },

  markDirty() { this.dirty = true; $('#dirty').hidden = false; this.refreshValues(); },
  refreshValues() { this.compiled = compileFields(this.vault); this.values = computeValues(this.vault); this.otherValues = {}; },
  valuesFor(pid) {
    if (!pid || pid === 'me') return this.values;
    return this.otherValues[pid] || (this.otherValues[pid] = computeValues(this.vault, pid));
  },
  personName(pid) {
    if (!pid || pid === 'me') return 'Me';
    const p = this.vault.people.find((x) => x.id === pid);
    return p ? (p.name || [p.values.first_name, p.values.last_name].filter(Boolean).join(' ') || RELATIONS.find((r) => r[0] === p.relation)?.[1] || 'Person') : 'Me';
  },

  buildLearned() {
    const box = $('#learned-list');
    box.textContent = '';
    const L = this.vault.learned || [];
    if (!L.length) { box.append(h('span', { class: 'muted', text: 'Nothing yet.' })); return; }
    L.slice().reverse().forEach((l) => {
      box.append(h('div', { class: 'learned' }, h('span', { text: `"${l.phrase}" → ${fieldLabel(l.key, this.vault)}` }),
        h('button', { class: 'mini danger', onclick: () => { this.vault.learned = L.filter((x) => x !== l); this.refreshValues(); this.markDirty(); this.saveVault(); this.buildLearned(); } }, 'Forget')));
    });
  },

  showTab(t) {
    if (t === 'settings') this.buildLearned();
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    for (const id of ['fill', 'info', 'settings']) $('#tab-' + id).hidden = id !== t;
    if (t === 'fill' && this.sess && this.editor) this.editor.drawAll();
    if (t === 'fill' && this.sess) this.renderList();
  },

  /* ---------- my information ---------- */

  buildInfo() {
    $$('.tabs button').forEach((b) => { b.onclick = () => this.showTab(b.dataset.tab); });
    this.editing = this.editing && this.vault.people.some((p) => p.id === this.editing) ? this.editing : 'me';
    const person = this.editing === 'me' ? null : this.vault.people.find((p) => p.id === this.editing);
    const target = person ? person.values : this.vault.values;
    // whose information is shown: you, or someone you fill forms for (child, spouse…)
    const bar = $('#people-bar');
    bar.textContent = '';
    const pick = (id) => { this.editing = id; this.buildInfo(); };
    bar.append(h('button', { class: this.editing === 'me' ? 'on' : '', onclick: () => pick('me') }, 'Me'));
    for (const p of this.vault.people) bar.append(h('button', { class: this.editing === p.id ? 'on' : '', onclick: () => pick(p.id) }, this.personName(p.id)));
    bar.append(h('button', { onclick: () => {
      const p = { id: 'p' + Math.random().toString(36).slice(2, 8), relation: 'child', name: '', values: {} };
      this.vault.people.push(p); this.markDirty(); pick(p.id);
    } }, '+ Add a person'));
    const pbox = $('#person-box');
    pbox.textContent = '';
    pbox.hidden = !person;
    if (person) {
      const rel = h('select', {}, ...RELATIONS.map(([v, l]) => h('option', { value: v, text: l })));
      rel.value = person.relation;
      rel.onchange = () => { person.relation = rel.value; this.markDirty(); };
      const nm = h('input', { value: person.name || '', placeholder: 'Short name, e.g. Maria' });
      nm.oninput = () => { person.name = nm.value; this.markDirty(); };
      nm.onchange = () => { const btn = $('#people-bar button.on'); if (btn) btn.textContent = this.personName(person.id); };
      pbox.append(h('div', { class: 'grid' },
        h('label', { class: 'fld' }, h('span', { text: 'Who is this?' }), rel),
        h('label', { class: 'fld' }, h('span', { text: 'Name shown in the app' }), nm)),
        h('p', { class: 'muted small', text: 'Used for form sections about them (e.g. "DATE PRIVIND COPIII MINORI"), or pick them for any blank.' }),
        h('button', { class: 'mini danger', onclick: () => { if (!confirm('Remove this person and their information?')) return; this.vault.people = this.vault.people.filter((x) => x !== person); this.markDirty(); pick('me'); } }, 'Remove this person'));
    }
    $('#me-only').hidden = !!person;
    $('#custom-card').hidden = !!person;
    const form = $('#info-form');
    form.textContent = '';
    for (const [g, gl] of FIELD_GROUPS) {
      if (g === 'custom') continue;
      const grid = h('div', { class: 'grid' });
      for (const f of FIELD_DEFS.filter((x) => x.group === g)) {
        const inp = h('input', { value: target[f.key] || '', placeholder: f.hint || '', 'data-key': f.key, autocomplete: 'off', spellcheck: false });
        inp.addEventListener('input', () => { target[f.key] = inp.value; this.markDirty(); });
        grid.append(h('label', { class: 'fld' }, h('span', { text: f.label }), inp));
      }
      form.append(h('div', { class: 'card' }, h('h3', { text: gl }), grid));
    }
    this.buildCustom();
    $('#add-custom').onclick = () => {
      this.vault.custom.push({ key: 'custom_' + Math.random().toString(36).slice(2, 8), label: '', value: '', aliases: '' });
      this.buildCustom(); this.markDirty();
      $$('#custom-list input')[$$('#custom-list input').length - 3]?.focus();
    };
    $('#save-vault').onclick = async () => { await this.saveVault(); toast('Saved (encrypted)', 'good'); };
    this.setupSignature();
  },

  buildCustom() {
    const list = $('#custom-list');
    list.textContent = '';
    this.vault.custom.forEach((c, i) => {
      const mk = (prop, ph) => {
        const inp = h('input', { value: c[prop] || '', placeholder: ph, spellcheck: false });
        inp.addEventListener('input', () => { c[prop] = inp.value; this.markDirty(); });
        return inp;
      };
      list.append(h('div', { class: 'customrow' }, mk('label', 'Name, e.g. "Car plate"'), mk('value', 'Value'), mk('aliases', 'Also called (optional), e.g. nr. auto, plate'),
        h('button', { class: 'mini danger', title: 'Delete', onclick: () => { this.vault.custom.splice(i, 1); this.buildCustom(); this.markDirty(); } }, '✕')));
    });
  },

  setupSignature() {
    const pad = $('#sigpad'), ctx = pad.getContext('2d');
    let drawing = false, last = null, inked = false;
    const clear = () => { ctx.clearRect(0, 0, pad.width, pad.height); inked = false; };
    const at = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
    pad.onpointerdown = (e) => { drawing = true; last = at(e); pad.setPointerCapture(e.pointerId); };
    pad.onpointermove = (e) => {
      if (!drawing) return;
      const p = at(e);
      ctx.strokeStyle = '#10204a'; ctx.lineWidth = 3.2; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
      last = p; inked = true;
    };
    pad.onpointerup = () => { drawing = false; };
    $('#sig-clear').onclick = clear;
    const use = async (src) => {
      try {
        const s = await cleanSignature(src);
        this.vault.signature = s.dataUrl; this.vault.sigSize = { w: s.w, h: s.h };
        this.markDirty(); this.showSig(); toast('Signature ready. Press Save to keep it.', 'good');
      } catch (err) { toast(err.message, 'bad'); }
    };
    $('#sig-use').onclick = () => { if (!inked) return toast('Draw your signature in the box first', 'bad'); use(pad.toDataURL('image/png')); };
    $('#sig-file').onchange = async (e) => { const f = e.target.files[0]; if (f) use(await blobToDataUrl(f)); e.target.value = ''; };
    $('#sig-remove').onclick = () => { this.vault.signature = null; this.vault.sigSize = null; this.markDirty(); this.showSig(); };
    this.showSig();
  },

  showSig() {
    const has = !!this.vault.signature;
    $('#sig-img').hidden = !has; $('#sig-remove').hidden = !has;
    if (has) $('#sig-img').src = this.vault.signature;
    $('#sig-none').hidden = has;
  },

  /* ---------- settings ---------- */

  buildSettings() {
    const s = this.vault.settings;
    const sel = (id, prop, conv = (x) => x) => {
      const el = $(id);
      el.value = String(s[prop]);
      el.onchange = () => { s[prop] = conv(el.value); this.markDirty(); this.saveVault(); if (this.editor) this.editor.drawAll(); };
    };
    sel('#set-date', 'dateFormat'); sel('#set-name', 'nameOrder'); sel('#set-lock', 'autoLock', Number); sel('#set-ink', 'ink');
    $('#set-smart').checked = s.smart !== false;
    $('#set-smart').onchange = (e) => { s.smart = e.target.checked; this.markDirty(); this.saveVault(); };
    Smart.present().then((ok) => { $('#smart-status').textContent = ok ? '✓ Add-on found.' : 'Add-on not found next to this page (optional).'; });
    $('#set-remember').checked = s.remember;
    $('#set-remember').onchange = async (e) => {
      s.remember = e.target.checked;
      if (!s.remember) { forgetStoredVault(); toast('Removed from this browser. Keep your .vault file safe!', 'info', 5000); }
      else { this.dirty = true; await this.saveVault(); toast('Saved in this browser', 'good'); }
    };
    $('#backup').onclick = async () => {
      const text = await sealVault(this.vault, this.k);
      if (s.remember) storeVault(text);
      download(new Blob([text], { type: 'application/json' }), 'my-info.vault');
    };
    $('#pw-form').onsubmit = async (e) => {
      e.preventDefault();
      const cur = $('#pw-cur').value, a = $('#pw-new').value, b = $('#pw-new2').value;
      try { await openVault(await sealVault(this.vault, this.k), cur).then(() => null, () => { throw new Error('Current password is wrong'); }); }
      catch (err) { return toast(err.message, 'bad'); }
      if (a.length < 8) return toast('Use at least 8 characters', 'bad');
      if (a !== b) return toast('The two new passwords are different', 'bad');
      this.k = await newVaultKey(a);
      await this.saveVault();
      e.target.reset();
      toast('Password changed. Download a new backup — old backups still use the old password.', 'good', 6000);
    };
  },

  /* ---------- filling documents ---------- */

  bindFill() {
    const drop = $('#drop');
    $('#pick-doc').onclick = () => $('#doc-file').click();
    const take = (list) => { const fs = [...list]; if (fs.length > 1) this.fillMany(fs); else if (fs[0]) this.openDoc(fs[0]); };
    $('#doc-file').onchange = (e) => { take(e.target.files); e.target.value = ''; };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files); };
    document.ondragover = (e) => e.preventDefault();
    document.ondrop = (e) => { e.preventDefault(); if (this.vault && e.dataTransfer.files.length) { this.showTab('fill'); this.closeDoc(); take(e.dataTransfer.files); } };
    $('#close-doc').onclick = () => this.closeDoc();
    $('#save-doc').onclick = () => this.saveDoc();
    $('#save-png').onclick = () => this.saveDoc(true);
    $('#cover').onchange = () => this.editor && this.editor.drawAll();
    // editor keys: Delete removes, arrows nudge (Shift = 10x), Escape deselects
    document.addEventListener('keydown', (e) => {
      const ed = this.editor, b = ed && ed.sel;
      if (!b || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
      if (e.key === 'Escape') { ed.select(null); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && b.kind !== 'field') { e.preventDefault(); this.removeBlank(b); return; }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (d && b.kind !== 'field') {
        e.preventDefault();
        const st = e.shiftKey ? 5 : 0.5;
        b.x += d[0] * st; b.y += d[1] * st;
        ed.draw(b); ed.select(b);
      }
    });
  },

  closeDoc() {
    this.sess = null; this.editor = null;
    $('#work').hidden = true; $('#drop').hidden = false;
    $('#editor').textContent = ''; $('#blank-list').textContent = '';
  },

  // Reads a file and finds its blanks (no screen updates). Returns { sess, notice }.
  // What a file really is, from its first bytes (names lie: "document", "scan.bin", "form.pdf.doc")
  async sniff(bytes, ext) {
    const b = bytes, ascii = (n) => String.fromCharCode(...b.subarray(0, n));
    if (ascii(5) === '%PDF-') return 'pdf';
    if (b[0] === 0xFF && b[1] === 0xD8) return 'jpg';
    if (b[0] === 0x89 && ascii(4).slice(1) === 'PNG') return 'png';
    if (ascii(4) === 'GIF8') return 'gif';
    if (ascii(2) === 'BM') return 'bmp';
    if ((ascii(4) === 'II*\0') || (ascii(4) === 'MM\0*')) return 'tiff';
    if (ascii(12).slice(8) === 'WEBP') return 'webp';
    if (ascii(12).slice(4, 8) === 'ftyp') return /hei[cfx]|mif1/.test(ascii(12).slice(8)) ? 'heic' : /avif/.test(ascii(12).slice(8)) ? 'avif' : ext;
    if (ascii(5) === '{\\rtf') return 'rtf';
    if (b[0] === 0xD0 && b[1] === 0xCF) return /^(doc|dot|xls|ppt|docx|xlsx|pptx|docm)$/.test(ext) ? ext : 'doc';
    if (b[0] === 0x50 && b[1] === 0x4B) {
      if (/^(docx|docm|dotx|xlsx|xlsm|pptx|odt|ods|odp|ott|ots|otp|odg|pages|numbers|key)$/.test(ext)) return ext;
      try {
        const z = await JSZip.loadAsync(bytes);
        if (z.file('word/document.xml')) return 'docx';
        if (z.file('xl/workbook.xml')) return 'xlsx';
        if (z.file('ppt/presentation.xml')) return 'pptx';
        const mt = z.file('mimetype') && (await z.file('mimetype').async('string'));
        if (mt) return { 'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods', 'application/vnd.oasis.opendocument.presentation': 'odp' }[mt.trim()] || ext;
        if (z.file('Index/Document.iwa')) return 'pages';
      } catch { /* not a zip after all */ }
      return ext;
    }
    if (OFFICE[ext] || IMAGES[ext] || APPLE[ext] || OLD_FORMATS[ext] || ext === 'pdf' || ext === 'doc') return ext;
    const head = new TextDecoder('latin1').decode(b.subarray(0, 512)).toLowerCase();
    if (/<html|<!doctype html|<body|<form/.test(head)) return 'html';
    if (!b.subarray(0, 4096).some((x) => x === 0)) return 'txt'; // no zero bytes: some kind of text
    return ext;
  },

  async loadSession(file, env) {
    let bytes = new Uint8Array(await file.arrayBuffer());
    let ext = await this.sniff(bytes, fileExt(file.name));
    let sess, notice = '', nativeBack = null;
    if (Native.ok() && NATIVE_TO[ext]) {
      try {
        env.progress && env.progress(`Asking ${{ pages: 'Pages', numbers: 'Numbers', key: 'Keynote', doc: 'Pages', xls: 'Numbers', ppt: 'Keynote' }[ext]} to open it…`);
        bytes = await Native.convert(bytes, file.name, NATIVE_TO[ext]);
        nativeBack = NATIVE_BACK[ext] || null;
        ext = NATIVE_TO[ext];
      } catch (e) { console.warn('native conversion failed', e); notice = 'Could not convert with the Apple app (' + (e.message || e) + '). '; }
    }
    if (ext === 'doc' || ext === 'dot') {
      bytes = await docToDocx(bytes);
      ext = 'docx';
      notice = 'Old Word (.doc) file: it was converted to .docx to fill it, so fonts and layout are simplified. For the original look, open it in Word or Pages, save as .docx and drop that instead.';
    }
    // A password-protected .docx/.xlsx/.pptx is an encrypted container, not a zip
    const cfb = bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
    if (cfb && /^(docx|docm|dotx|xlsx|xlsm|pptx)$/.test(ext)) throw new Error('This file is protected with a password. Open it, remove the password (File → Info → Protect / Encrypt), save, and drop it here again.');
    if (/^(docx|docm|dotx|xlsx|xlsm|pptx|odt|ods|odp|ott|ots|otp|odg)$/.test(ext) && !(bytes[0] === 0x50 && bytes[1] === 0x4B)) throw new Error('This file looks damaged or is not really a .' + ext + ' file.');
    if (OLD_FORMATS[ext]) throw new Error(`Old ${OLD_FORMATS[ext]} format. Open it and "Save As" the new format (.${ext}x), then drop that here.`);
    if (ext === 'pdf' || IMAGES[ext] || APPLE[ext]) {
      let pdfBytes = bytes, px = null;
      if (APPLE[ext]) {
        const pv = await pagesPreview(bytes);
        const r = await imageToPdf(pv.bytes, pv.type);
        pdfBytes = r.bytes; px = r.px;
        notice = `${APPLE[ext]} files can only be read from their preview picture (first page). For a sharper result: in ${APPLE[ext]} choose File → Export To → ${ext === 'numbers' ? 'Excel' : ext === 'key' ? 'PowerPoint' : 'Word'} (or PDF) and drop that file here.`;
      } else if (IMAGES[ext]) {
        const r = await imageToPdf(bytes, IMAGES[ext]);
        pdfBytes = r.bytes; px = r.px;
      }
      const res = await processPdf(pdfBytes, env);
      sess = { type: 'pdf', name: file.name, bytes: pdfBytes, px, ...res };
      if (res.scanned) notice = (notice ? notice + ' ' : '') + 'No text could be read on this picture. Click on the page where each thing should go.';
      else if (res.xfa) notice = (notice ? notice + ' ' : '') + 'This is an Adobe "XFA" form, which only Adobe Reader can fill properly. Your info will be written on top of the page instead; check the result.';
      else if (res.ocrUsed) notice = (notice ? notice + ' ' : '') + 'This is a scan/photo: its text was read automatically, so check that everything sits in the right place (drag to adjust, click the page to add more).';
    } else if (OFFICE[ext]) {
      const res = await OFFICE[ext](bytes, env, ext);
      sess = { type: 'office', name: baseName(file.name) + '.' + ext, ext, proc: OFFICE[ext], bytes, blanks: res.blanks, nativeBack };
    } else {
      throw new Error(`Can't fill .${ext || '?'} files yet. Supported: PDF, Word (.docx/.doc), Pages, OpenDocument, Excel, PowerPoint, pictures, HTML and text.`);
    }
    refineKeys(sess.blanks);
    // sections about your child/spouse/parent: use that person's info if you saved it
    for (const b of sess.blanks) {
      if (!b.otherPerson || !b.otherKey) continue;
      const p = this.vault.people.find((x) => x.relation === b.otherRel) || (b.otherRel === 'other' ? null : null);
      if (p) { b.person = p.id; b.key = b.otherKey; }
    }
    if (this.settings().smart !== false) {
      const n = await Smart.pass(sess.blanks, this.vault, env.progress);
      if (n && sess.type === 'pdf') sess.blanks.forEach((b) => { if (b.smart && b.key === 'signature') setBlankKind(b, 'signature', this.vault); });
    }
    sess.blanks.forEach((b, i) => { b.id = i; });
    return { sess, notice };
  },

  env() { return { compiled: this.compiled, vault: this.vault, values: this.values, progress: (m) => { $('#drop-status').textContent = m; } }; },

  async openDoc(file) {
    $('#drop').classList.add('busy');
    $('#work').removeAttribute('data-ready');
    try {
      const { sess, notice } = await this.loadSession(file, this.env());
      this.sess = sess;
      $('#drop').hidden = true; $('#work').hidden = false;
      $('#doc-name').textContent = file.name;
      $('#notice').hidden = !notice; $('#notice').textContent = notice;
      const visual = sess.type === 'pdf';
      $('#editor').hidden = !visual;
      $('#work').classList.toggle('visual', visual);
      $('#cover-wrap').hidden = !visual || !sess.blanks.some((b) => b.cover);
      $('#cover').checked = true;
      $('#flatten-wrap').hidden = !visual || !sess.blanks.some((b) => b.kind === 'field');
      $('#flatten').checked = false;
      $('#save-png').hidden = !sess.px || sess.pages.length > 1;
      $('#save-doc').textContent = sess.px ? 'Download as PDF' : 'Download filled file';
      this.editor = null;
      if (visual) { this.editor = new PdfEditor($('#editor'), sess, this); await this.editor.render(); }
      this.renderList();
      $('#work').setAttribute('data-ready', '');
      if (!sess.blanks.length && !visual) toast('No blanks found in this document', 'info', 5000);
    } catch (err) {
      console.error(err);
      toast(err.message || String(err), 'bad', 8000);
    } finally { $('#drop').classList.remove('busy'); $('#drop-status').textContent = ''; }
  },

  // Several files at once: fill each with the automatic choices, download one zip
  async fillMany(files) {
    $('#drop').classList.add('busy');
    const zip = new JSZip();
    const report = [];
    try {
      for (const [i, f] of files.entries()) {
        $('#drop-status').textContent = `Filling ${i + 1} of ${files.length}: ${f.name}`;
        try {
          const { sess } = await this.loadSession(f, this.env());
          const { blob, name } = await this.buildBlob(sess, false, { cover: true });
          let n = name, k = 2;
          while (zip.file(n)) n = baseName(name) + ` (${k++}).` + fileExt(name);
          zip.file(n, blob);
          const shown = sess.blanks.filter((b) => !(b.optional && !b.key));
          report.push(`✓ ${f.name}: ${shown.filter((b) => this.valueOf(b)).length} of ${shown.length} blanks filled`);
        } catch (e) { report.push(`✗ ${f.name}: ${e.message || e}`); }
      }
      zip.file('report.txt', report.join('\n') + '\n\nCheck each file before using it: guesses can be wrong.\n');
      download(await zip.generateAsync({ type: 'blob' }), 'filled-documents.zip');
      $('#batch-report').hidden = false;
      $('#batch-report').textContent = report.join('\n');
      toast('Saved filled-documents.zip to your Downloads', 'good');
    } finally { $('#drop').classList.remove('busy'); $('#drop-status').textContent = ''; }
  },

  // What goes into a blank: {text} or {image}
  valueOf(b) {
    if (!b.key) return null;
    if (b.key === '__tick') return { check: true, text: '✓' };
    if (b.key === '__text') return b.text ? (b.kind === 'field' ? fieldValue(b, b.text) : { text: b.text }) : null;
    if (b.key === 'signature') {
      if (!this.vault.signature || (b.person && b.person !== 'me')) return null;
      const sz = this.vault.sigSize || { w: 300, h: 100 };
      return { image: { dataUrl: this.vault.signature, bytes: dataUrlToBytes(this.vault.signature), w: sz.w, h: sz.h } };
    }
    let v = this.valuesFor(b.person)[b.key];
    // "str. ____" + "Str. Florilor" would give "str. Str. Florilor"
    if (v && b.key === 'street' && /\b(str|strada|bd|b-dul|bulevardul|sos|soseaua|calea|aleea|street)\.?\s*:?\s*$/i.test(b.before || '')) {
      v = v.replace(/^(str(ada)?|bd|b-dul|bulevardul|sos(eaua)?|calea|aleea)\.?\s+/i, '');
    }
    if (!v) return null;
    // "(cu majuscule)", "in capital letters"
    if (/majuscul|litere mari|litere de tipar|capital letters|block letters|in capitals/i.test((b.before || '') + ' ' + (b.labelText || '') + ' ' + (b.after || ''))) v = v.toLocaleUpperCase('ro');
    if (b.kind === 'field' && (b.fieldType !== 'text' || b.charIndex != null || b.datePart) && b.fieldType !== 'sig') return fieldValue(b, v);
    return { text: v };
  },

  fieldSelect(b, onchange, placeholder) {
    const s = h('select', { class: 'fsel' });
    s.append(h('option', { value: '', text: placeholder || '— leave empty —' }));
    for (const g of allFieldOptions(this.vault)) {
      const og = h('optgroup', { label: g.group });
      for (const it of g.items) {
        if (it.key === 'signature' && b.canImage === false) continue;
        const v = it.key === 'signature' ? (this.vault.signature ? '✓' : '(none saved)') : this.values[it.key];
        og.append(h('option', { value: it.key, text: it.label + (v ? ' — ' + String(v).slice(0, 28) : ' (empty)') }));
      }
      s.append(og);
    }
    if (b.fieldType === 'check') s.append(h('option', { value: '__tick', text: '☑ Tick this box' }));
    s.append(h('option', { value: '__text', text: b.key === '__text' && b.text ? 'Text: ' + b.text.slice(0, 30) : 'Type something else…' }));
    s.value = b.key || '';
    s.onchange = () => {
      let text;
      if (s.value === '__text') {
        text = prompt('Text to put here:', b.text || '');
        if (text == null) { s.value = b.key || ''; return; }
      }
      onchange(s.value || null, text);
    };
    return s;
  },

  personSelect(b) {
    const s = h('select', { class: 'psel', title: 'Whose information' }, h('option', { value: 'me', text: 'for: Me' }),
      ...this.vault.people.map((p) => h('option', { value: p.id, text: 'for: ' + this.personName(p.id) })));
    s.value = b.person || 'me';
    s.onchange = () => { b.person = s.value === 'me' ? null : s.value; if (this.editor) this.editor.draw(b); this.renderList(); };
    return s;
  },

  setKey(b, key, text) {
    if (key && key[0] !== '_' && key !== b.key && !b.manual) this.learn(b, key);
    b.key = key || null;
    b.guess = false;
    if (key === '__text') b.text = text;
    if (this.sess.type === 'pdf') setBlankKind(b, key, this.vault);
    if (this.editor) { this.editor.draw(b); this.editor.select(b); }
    this.renderList();
  },

  // Remember "this wording means that field" for next time (stored encrypted in the vault)
  learn(b, key) {
    const phrase = learnPhrase(b.labelText || b.before);
    if (phrase.replace(/ /g, '').length < 3) return;
    const L = (this.vault.learned = this.vault.learned || []);
    const i = L.findIndex((x) => x.phrase === phrase);
    if (i >= 0) L.splice(i, 1);
    L.push({ phrase, key });
    if (L.length > 500) L.shift();
    this.refreshValues();
    if (this.settings().remember) this.saveVault().catch(() => {});
    else this.markDirty();
  },

  addBlank(b) {
    b.id = Math.max(-1, ...this.sess.blanks.map((x) => x.id)) + 1;
    this.sess.blanks.push(b);
    this.editor.draw(b);
    this.renderList();
  },

  removeBlank(b) {
    this.sess.blanks.splice(this.sess.blanks.indexOf(b), 1);
    this.editor.select(null);
    this.editor.drawAll();
    this.renderList();
  },

  highlightRow(b) {
    $$('#blank-list .row.sel').forEach((r) => r.classList.remove('sel'));
    const r = $(`#blank-list .row[data-id="${b.id}"]`);
    if (r) { r.classList.add('sel'); r.scrollIntoView({ block: 'nearest' }); }
  },

  renderList() {
    const s = this.sess;
    if (!s) return;
    const list = $('#blank-list');
    list.textContent = '';
    let filled = 0, unknown = 0, missing = 0;
    const rows = s.blanks.filter((b) => !(b.optional && !b.key)).sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (b.y ?? 0) - (a.y ?? 0) || a.id - b.id);
    for (const b of rows) {
      let val = this.valueOf(b);
      const noPicture = val && val.image && b.canImage === false;
      if (noPicture) val = null;
      if (val || noPicture || (!val && b.fieldType === 'check' && b.key && this.values[b.key])) filled++; else if (!b.key) unknown++; else missing++;
      const unticked = !val && b.fieldType === 'check' && b.key && this.values[b.key];
      const status = val || unticked || noPicture ? 'ok' : b.key ? 'missing' : 'unknown';
      const tooLong = val?.text && b.kind === 'text' && b.maxW > 10 && textWidth(val.text, b.size * 0.72) > b.maxW * 1.05;
      const preview = val ? (val.image ? h('img', { src: val.image.dataUrl, class: 'sigthumb' }) : h('span', { text: val.text }))
        : h('span', { class: 'muted', text: noPicture ? '✍︎ sign by hand (this file type can\'t hold a picture)' : unticked ? '☐ stays unticked' : b.key ? (b.key === 'signature' ? 'no signature saved' : 'empty in your info') : 'not filled' });
      const row = h('div', { class: 'row ' + status + (b.guess && val ? ' guess' : ''), 'data-id': b.id },
        h('div', { class: 'ctx' },
          b.where ? h('span', { class: 'where', text: b.where }) : null,
          h('span', { text: b.before ? '…' + b.before : '' }), h('mark', { text: ' ▢ ' }), h('span', { text: b.after ? b.after + '…' : '' })),
        h('div', { class: 'pick' }, this.fieldSelect(b, (k, t) => this.setKey(b, k, t)), h('div', { class: 'val' }, preview)),
        this.vault.people.length && b.key && b.key[0] !== '_' && b.key !== 'signature' ? this.personSelect(b) : null,
        tooLong ? h('div', { class: 'warn', text: '⚠ Longer than the blank: check it on the page, drag it or make it smaller' }) : null,
        b.guess && val ? h('div', { class: 'warn', text: '≈ Best guess from similar wording: please check' }) : null,
        b.otherPerson && !b.key ? h('div', { class: 'warn', text: 'In a section about someone else (' + b.section.slice(0, 40) + '): left empty. Add them under My information → + Add a person.' }) : null,
        b.otherPerson && b.person ? h('div', { class: 'warn', text: 'Section about ' + this.personName(b.person) + ': filled with their info' }) : null);
      if (this.editor) row.addEventListener('click', (e) => { if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'OPTION') this.editor.select(b, true); });
      list.append(row);
    }
    $('#doc-summary').textContent = `${rows.length} blank${rows.length === 1 ? '' : 's'} · ${filled} filled` +
      (missing ? ` · ${missing} missing from your info` : '') + (unknown ? ` · ${unknown} to choose` : '');
  },

  async buildBlob(s, asPng, opts = {}) {
    const sigBytes = this.vault.signature ? dataUrlToBytes(this.vault.signature) : null;
    if (s.type === 'pdf') {
      const out = await buildPdf(s, (b) => this.valueOf(b), { ink: this.settings().ink, cover: opts.cover ?? this.cover(), flatten: opts.flatten ?? $('#flatten').checked });
      if (asPng) return { blob: await pdfPageToPng(out, s.px), name: baseName(s.name) + '-filled.png' };
      return { blob: new Blob([out], { type: 'application/pdf' }), name: baseName(s.name) + '-filled.pdf' };
    }
    const fresh = await s.proc(s.bytes, { compiled: this.compiled, vault: this.vault, values: this.values }, s.ext);
    if (fresh.blanks.length !== s.blanks.length) throw new Error('The document changed while reading it — please drop it again');
    for (let i = s.blanks.length - 1; i >= 0; i--) {
      const val = this.valueOf(s.blanks[i]);
      if (val) fresh.blanks[i].apply(val);
    }
    const blob = await fresh.finish(sigBytes);
    if (s.nativeBack && Native.ok()) {
      // back to the Apple format it came in
      try {
        const back = await Native.convert(new Uint8Array(await blob.arrayBuffer()), 'filled.' + s.ext, s.nativeBack);
        return { blob: new Blob([back]), name: baseName(s.name) + '-filled.' + s.nativeBack };
      } catch (e) { toast('Saved as .' + s.ext + ' (converting back failed: ' + (e.message || e) + ')', 'info', 6000); }
    }
    return { blob, name: baseName(s.name) + '-filled.' + s.ext };
  },

  async saveDoc(asPng) {
    const s = this.sess;
    if (!s) return;
    const btn = asPng ? $('#save-png') : $('#save-doc');
    btn.disabled = true;
    try {
      const { blob, name } = await this.buildBlob(s, asPng);
      download(blob, name);
      toast('Saved ' + name + ' to your Downloads', 'good');
    } catch (err) {
      console.error(err);
      toast('Could not create the file: ' + (err.message || err), 'bad', 8000);
    } finally { btn.disabled = false; }
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
