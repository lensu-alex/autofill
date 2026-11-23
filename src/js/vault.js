'use strict';
// Your encrypted information. PBKDF2-SHA256 (600k rounds) turns the password into
// an AES-256-GCM key; the browser's built-in WebCrypto does all the crypto.

const VAULT_ITER = 600000;
const LS_KEY = 'autofill.vault.v1';
const DEFAULT_SETTINGS = { dateFormat: 'dd.mm.yyyy', autoLock: 10, ink: 'black', remember: true, smart: true, nameOrder: 'first-last' };

function newVaultData() {
  return { version: 1, values: {}, custom: [], signature: null, sigSize: null, settings: { ...DEFAULT_SETTINGS } };
}

async function deriveKey(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function newVaultKey(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveKey(password, salt, VAULT_ITER), salt, iter: VAULT_ITER };
}

// -> text of a .vault file
async function sealVault(data, k) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  data.updated = new Date().toISOString();
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, enc.encode(JSON.stringify(data))));
  return JSON.stringify({
    format: 'autofill-vault', v: 1,
    kdf: { name: 'PBKDF2-SHA256', iter: k.iter, salt: bytesToB64(k.salt) },
    cipher: 'AES-256-GCM', iv: bytesToB64(iv), data: bytesToB64(ct),
  });
}

async function openVault(text, password) {
  let box;
  try { box = JSON.parse(text); } catch { throw new Error('This is not a vault file'); }
  if (box.format !== 'autofill-vault') throw new Error('This is not a vault file');
  const salt = b64ToBytes(box.kdf.salt);
  const key = await deriveKey(password, salt, box.kdf.iter);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(box.iv) }, key, b64ToBytes(box.data));
  } catch { throw new Error('Wrong password'); }
  const data = JSON.parse(dec.decode(plain));
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  data.values = data.values || {};
  data.custom = data.custom || [];
  return { data, k: { key, salt, iter: box.kdf.iter } };
}

function storedVault() {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}
function storeVault(text) { try { localStorage.setItem(LS_KEY, text); return true; } catch { return false; } }
function forgetStoredVault() { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } }

// Photo or drawing -> transparent PNG cropped to the ink
async function cleanSignature(src) {
  const img = await loadImage(src);
  const scale = Math.min(1, 900 / img.width);
  const W = Math.max(1, Math.round(img.width * scale)), H = Math.max(1, Math.round(img.height * scale));
  const c = h('canvas', { width: W, height: H });
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H);
  const px = d.data;
  // paper colour = brightest common tone; anything close to it becomes transparent
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const a = clamp((215 - lum) / (215 - 110), 0, 1) * px[i + 3];
    px[i + 3] = a;
    if (a > 40) {
      const p = i / 4, x = p % W, y = (p - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error('No signature found in that picture');
  ctx.putImageData(d, 0, 0);
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const out = h('canvas', { width: x1 - x0 + 1, height: y1 - y0 + 1 });
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { dataUrl: out.toDataURL('image/png'), w: out.width, h: out.height };
}
