import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KIT_SRC = path.join(PKG_ROOT, 'kit');
export const STATE_DIR = '.product-planner';

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
export function exists(p) { return fs.existsSync(p); }
export function readText(p, fallback = null) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : fallback; }
export function writeText(p, s) { ensureDir(path.dirname(p)); fs.writeFileSync(p, s); }
export function readJson(p, fallback = null) {
  const t = readText(p);
  if (t == null) return fallback;
  try { return JSON.parse(t); } catch (e) { throw new Error(`invalid JSON in ${p}: ${e.message}`); }
}
export function writeJson(p, obj) { writeText(p, JSON.stringify(obj, null, 2) + '\n'); }

export function listFiles(dir, filter = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

/** Insert or replace a marker-delimited block in a text file (idempotent). */
export function upsertBlock(filePath, marker, body) {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const block = `${start}\n${body.trim()}\n${end}`;
  let content = readText(filePath, '');
  const re = new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}`);
  if (re.test(content)) content = content.replace(re, block);
  else content = content.trimEnd() + (content.trim() ? '\n\n' : '') + block + '\n';
  writeText(filePath, content);
}
export function removeBlock(filePath, marker) {
  const content = readText(filePath);
  if (content == null) return;
  const start = `<!-- ${marker}:start -->`, end = `<!-- ${marker}:end -->`;
  const re = new RegExp(`\\n?${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`);
  writeText(filePath, content.replace(re, '\n').trimEnd() + '\n');
}
export function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Parse YAML-ish frontmatter (flat key: value only) from markdown. */
export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else if (/^".*"$/.test(v)) v = v.slice(1, -1);
    meta[k] = v;
  }
  return { meta, body: m[2] };
}

export function nowIso() { return new Date().toISOString(); }
export function today() { return new Date().toISOString().slice(0, 10); }
