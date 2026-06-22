#!/usr/bin/env node
// cache-samples.mjs — vendor the common Strudel sample packs LOCALLY for offline rendering.
//
//   node cache-samples.mjs            # download + write cache (idempotent; skips files already present)
//   node cache-samples.mjs --force    # re-download even if present
//
// Downloads the RolandTR909 + RolandTR808 drum-machine banks and the piano pack (the soul's
// default kits) into render/samples-cache/ (gitignored), and writes cache-local sample maps
// whose _base points at the local files with a leading-slash path (port-/base-agnostic).
// strudel-render.mjs's static server serves these cached maps in place of the remote-pointing
// vendored maps, so a network blip can no longer blank the drums. (Bare bd/hh/sd → dirt-samples
// is a separate, larger follow-up.) Run by setup.sh; safe to re-run. Needs Node 18+ (global fetch).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'samples-cache');
const FORCE = process.argv.includes('--force');
const CONCURRENCY = 8;
const BANK_PREFIXES = ['RolandTR909', 'RolandTR808'];   // which drum machines to cache

const readMap = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));

// Build the download list [{url,dest}] + the rewritten cache-local maps (leading-slash _base).
function plan() {
  const jobs = [];

  const dm = readMap('tidal-drum-machines.json');
  const dmBase = dm._base.replace(/\/$/, '') + '/';
  const localDm = { _base: '/samples-cache/drum-machines/' };
  for (const [bank, files] of Object.entries(dm)) {
    if (bank === '_base' || !BANK_PREFIXES.some((p) => bank.startsWith(p))) continue;
    localDm[bank] = files;                                       // same relative paths
    for (const rel of files) jobs.push({ url: dmBase + rel, dest: path.join(CACHE, 'drum-machines', rel) });
  }

  const pn = readMap('piano.json');
  const pnBase = pn._base.replace(/\/$/, '') + '/';
  const localPn = { _base: '/samples-cache/piano/', piano: pn.piano };
  for (const rel of Object.values(pn.piano)) jobs.push({ url: pnBase + rel, dest: path.join(CACHE, 'piano', rel) });

  return { jobs, localDm, localPn };
}

async function download({ url, dest }) {
  if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) return 'skip';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`empty ${url}`);
  fs.writeFileSync(dest, buf);
  return 'get';
}

async function pool(jobs, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      try { out.push({ ok: true, kind: await fn(j) }); }
      catch (e) { out.push({ ok: false, err: e.message }); }
    }
  }));
  return out;
}

async function main() {
  const { jobs, localDm, localPn } = plan();
  console.error(`caching ${jobs.length} sample files (909+808+piano) → ${CACHE}`);
  const res = await pool(jobs, CONCURRENCY, download);
  const got = res.filter((r) => r.ok && r.kind === 'get').length;
  const skip = res.filter((r) => r.ok && r.kind === 'skip').length;
  const fail = res.filter((r) => !r.ok);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, 'tidal-drum-machines.json'), JSON.stringify(localDm, null, 2));
  fs.writeFileSync(path.join(CACHE, 'piano.json'), JSON.stringify(localPn, null, 2));
  console.error(`✓ downloaded ${got}, skipped ${skip}, failed ${fail.length}; wrote cache maps`);
  if (fail.length) { fail.slice(0, 5).forEach((f) => console.error('  FAIL', f.err)); process.exit(1); }
}

main();
