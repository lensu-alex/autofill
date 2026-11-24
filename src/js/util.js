'use strict';
// Small helpers shared by every module.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}

// Lowercase, strip diacritics and punctuation: "Semnătura:" -> "semnatura"
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@]+/g, ' ')
    .trim();
}

// Drop gender suffixes like "Subsemnatul(a)", "născut/ă" before matching
function cleanLabel(s) {
  return String(s || '')
    .replace(/\(\s*(a|ă|ul|ua|ă\s*\/\s*a)\s*\)/gi, '')
    .replace(/\/\s*(a|ă)\b/gi, '');
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function dataUrlToBytes(url) { return b64ToBytes(url.slice(url.indexOf(',') + 1)); }

function fileExt(name) { const m = /\.([^.]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
function baseName(name) { return (name || 'document').replace(/\.[^.]+$/, ''); }

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function toast(msg, kind = 'info', ms = 3500) {
  const t = h('div', { class: 'toast ' + kind, text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

function formatDate(d, fmt) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return (fmt || 'dd.mm.yyyy').replace('dd', dd).replace('mm', mm).replace('yyyy', yyyy).replace('yy', yyyy.slice(2));
}

// The date format a form asks for: "(DD/MM/YYYY)", "zz.ll.aaaa", "yyyy-mm-dd", "MM/DD/YY"… -> "dd/mm/yyyy" style, or null
function dateHint(text) {
  const m = /\b([dDzZ]{2}|[mMlL]{2}|[yYaA]{2,4})([./\- ])([dDzZ]{2}|[mMlL]{2}|[yYaA]{2,4})\2([dDzZ]{2}|[mMlL]{2}|[yYaA]{2,4})\b/.exec(text || '');
  if (!m) return null;
  const part = (p) => { const c = p[0].toLowerCase(); return c === 'd' || c === 'z' ? 'dd' : c === 'm' || c === 'l' ? 'mm' : p.length >= 4 ? 'yyyy' : 'yy'; };
  const parts = [part(m[1]), part(m[3]), part(m[4])];
  if (new Set(parts.map((p) => p[0])).size !== 3) return null;
  return parts.join(m[2]);
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not read this image'));
    img.src = src;
  });
}

function blobToDataUrl(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
function parseXml(str) {
  const doc = new DOMParser().parseFromString(str, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Damaged XML inside the file');
  return doc;
}
function serializeXml(doc) {
  let s = new XMLSerializer().serializeToString(doc);
  if (!s.startsWith('<?xml')) s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
  return s;
}

// Text files are not always UTF-8: old Romanian pages use ISO-8859-2 / Windows-1250
function decodeText(bytes) {
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return dec.decode(bytes.subarray(3));
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* not UTF-8 */ }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(head) || /\\ansicpg(\d+)/.exec(head);
  let cs = m ? (/^\d+$/.test(m[1]) ? 'windows-' + m[1] : m[1]) : 'windows-1250';
  try { return new TextDecoder(cs).decode(bytes); } catch { return new TextDecoder('windows-1250').decode(bytes); }
}
