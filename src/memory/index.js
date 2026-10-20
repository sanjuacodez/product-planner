/**
 * Project memory: chunk the planning docs (and optionally repo docs) so agents can retrieve
 * relevant context instead of re-reading everything. Zero-dependency BM25 keyword index by default;
 * upgrades to local vector search (LanceDB + transformers.js, all free and offline) when
 * `product-planner memory setup` has installed the optional packages.
 */
import { fileDigest } from '../evidence.js';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { stateDir, loadConfig } from '../state.js';
import { readJson, writeJson, readText, listFiles, ensureDir, exists, nowIso } from '../util/fs.js';

export function memoryDir(cwd) { return path.join(stateDir(cwd), 'memory'); }
const indexPath = (cwd) => path.join(memoryDir(cwd), 'index.json');
const vecDir = (cwd) => path.join(memoryDir(cwd), 'lancedb');
const nodeModules = (cwd) => path.join(memoryDir(cwd), 'node_modules');

export function vectorAvailable(cwd) {
  return exists(path.join(nodeModules(cwd), '@lancedb', 'lancedb')) && exists(path.join(nodeModules(cwd), '@huggingface', 'transformers'));
}

/* ---------- collection and chunking ---------- */
export function collectDocs(cwd, patterns) {
  const files = new Set();
  for (const pat of patterns) {
    const [root, ...rest] = pat.split('/');
    const ext = pat.match(/\*\.(\w+)$/)?.[1];
    if (!pat.includes('*')) { if (exists(path.join(cwd, pat))) files.add(path.join(cwd, pat)); continue; }
    const base = path.join(cwd, rest.length ? root : '.');
    for (const f of listFiles(base, (p) => (!ext || p.endsWith('.' + ext)) && !p.includes('node_modules') && !p.includes(path.join('memory', 'lancedb')) && !p.includes(`${path.sep}kit${path.sep}`))) files.add(f);
  }
  return [...files];
}
export function chunk(text, { size = 900, overlap = 120 } = {}) {
  const paras = text.split(/\n(?=#{1,6}\s)|\n\n+/);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > size && cur) { chunks.push(cur.trim()); cur = cur.slice(-overlap) + '\n\n' + p; }
    else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}
export function tokenize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
}
const STOP = new Set('the a an and or of to in on for with is are be as at by it its this that from we our you your will can not'.split(' '));

/* ---------- BM25 ---------- */
export async function buildIndex(cwd, { paths } = {}) {
  const config = loadConfig(cwd);
  const files = collectDocs(cwd, paths?.length ? paths : config.memory.include);
  const docs = [];
  for (const f of files) {
    const text = readText(f, '');
    chunk(text).forEach((c, i) => docs.push({ id: `${path.relative(cwd, f)}#${i}`, file: path.relative(cwd, f), text: c, tokens: tokenize(c) }));
  }
  const df = Object.create(null);
  for (const d of docs) for (const t of new Set(d.tokens)) df[t] = (df[t] || 0) + 1;
  const avgLen = docs.reduce((a, d) => a + d.tokens.length, 0) / (docs.length || 1);
  const index = { fingerprints: Object.fromEntries(files.map((f) => { const rel = path.relative(cwd, f); return [rel, fileDigest(cwd, rel)]; })), builtAt: nowIso(), backend: 'bm25', files: files.map((f) => path.relative(cwd, f)), avgLen, df, docs: docs.map(({ tokens, ...d }) => ({ ...d, len: tokens.length, tf: countTf(tokens) })) };
  ensureDir(memoryDir(cwd));
  writeJson(indexPath(cwd), index);
  if (docs.length && vectorAvailable(cwd)) { await buildVectors(cwd, docs); index.backend = 'vector+bm25'; writeJson(indexPath(cwd), index); }
  return { files: files.length, chunks: docs.length, backend: index.backend };
}
function countTf(tokens) { const tf = Object.create(null); for (const t of tokens) tf[t] = (tf[t] || 0) + 1; return tf; }

export function bm25Search(index, query, k = 5) {
  const q = tokenize(query);
  const N = index.docs.length, k1 = 1.5, b = 0.75;
  const scored = index.docs.map((d) => {
    let score = 0;
    for (const t of q) {
      const f = d.tf[t]; if (!f) continue;
      const idf = Math.log(1 + (N - index.df[t] + 0.5) / (index.df[t] + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / index.avgLen));
    }
    return { id: d.id, file: d.file, text: d.text, score };
  }).filter((r) => r.score > 0).sort((a, b2) => b2.score - a.score);
  return scored.slice(0, k);
}

export async function searchMemory(cwd, query, k = 5) {
  const index = readJson(indexPath(cwd));
  if (!index) throw new Error('memory index not built: run `product-planner memory index`');
  const staleFiles = index.files.filter((f) => !index.fingerprints || fileDigest(cwd, f) !== index.fingerprints[f]);
  const fresh = new Set(index.files.filter((f) => !staleFiles.includes(f)));
  const freshness = { staleFiles, warning: staleFiles.length ? 'Stale or unverified sources excluded; re-index memory and inspect changed source evidence.' : null };
  if (!staleFiles.length && index.backend?.startsWith('vector') && vectorAvailable(cwd)) {
    try { return { backend: 'vector', ...freshness, results: await vectorSearch(cwd, query, k) }; } catch (e) { console.error(`vector search failed (${e.message}); falling back to keyword search`); }
  }
  return { backend: 'bm25', ...freshness, results: bm25Search({ ...index, docs: index.docs.filter((d) => fresh.has(d.file)) }, query, k) };
}

/* ---------- optional vector backend (lazy-loaded) ---------- */
const MODEL = 'Xenova/all-MiniLM-L6-v2';
async function loadVectorLibs(cwd) {
  const { createRequire } = await import('node:module');
  const req = createRequire(path.join(memoryDir(cwd), 'package.json'));
  const lancedb = await import(req.resolve('@lancedb/lancedb'));
  const tf = await import(req.resolve('@huggingface/transformers'));
  const pipe = await tf.pipeline('feature-extraction', MODEL, { cache_dir: path.join(memoryDir(cwd), 'models') });
  const embed = async (texts) => { const out = []; for (const t of texts) { const r = await pipe(t, { pooling: 'mean', normalize: true }); out.push(Array.from(r.data)); } return out; };
  return { lancedb, embed };
}
async function buildVectors(cwd, docs) {
  const { lancedb, embed } = await loadVectorLibs(cwd);
  const db = await lancedb.connect(vecDir(cwd));
  const vectors = await embed(docs.map((d) => d.text));
  const rows = docs.map((d, i) => ({ id: d.id, file: d.file, text: d.text, vector: vectors[i] }));
  await db.createTable('chunks', rows, { mode: 'overwrite' });
}
async function vectorSearch(cwd, query, k) {
  const { lancedb, embed } = await loadVectorLibs(cwd);
  const db = await lancedb.connect(vecDir(cwd));
  const table = await db.openTable('chunks');
  const [qv] = await embed([query]);
  const rows = await table.vectorSearch(qv).limit(k).toArray();
  return rows.map((r) => ({ id: r.id, file: r.file, text: r.text, score: r._distance != null ? 1 - r._distance : undefined }));
}

export function setupVector(cwd, { dryRun = false } = {}) {
  const dir = memoryDir(cwd);
  ensureDir(dir);
  const pkg = path.join(dir, 'package.json');
  if (!exists(pkg)) writeJson(pkg, { name: 'product-planner-memory', private: true, type: 'module', dependencies: { '@lancedb/lancedb': '^0.19.0', '@huggingface/transformers': '^3.5.0' } });
  const gi = path.join(dir, '.gitignore');
  if (!exists(gi)) fs.writeFileSync(gi, 'node_modules/\nlancedb/\nmodels/\n');
  if (dryRun) return { installed: false, dir };
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('npm install failed in ' + dir);
  return { installed: true, dir };
}
export function memoryStatus(cwd) {
  const index = readJson(indexPath(cwd));
  return { indexed: !!index, backend: index?.backend || null, builtAt: index?.builtAt || null, chunks: index?.docs?.length || 0, files: index?.files?.length || 0, vectorAvailable: vectorAvailable(cwd) };
}
