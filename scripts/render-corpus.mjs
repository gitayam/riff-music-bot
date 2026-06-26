#!/usr/bin/env node
// render-corpus.mjs — the render-reliability RATCHET.
//
//   node scripts/render-corpus.mjs           # human-readable progress + summary
//   node scripts/render-corpus.mjs --json     # {"total":N,"failures":M,"failing":["name",…]}
//
// Runs every snippet in scripts/render-corpus/*.js through the REAL offline render engine
// (render/strudel-render.mjs — code on stdin, 2 cycles) and reports how many fail to render.
// A snippet "fails" iff the engine exits non-zero (it errors / would 422 / times out). The
// engine is `container/server.mjs`'s authoritative validator, so a failure here is exactly
// the `could not render` (422) a /riff would hit in production. Deterministic: same snippet
// → same verdict. This is a measurement tool, not a gate — it always exits 0; the caller
// (the reliability loop) compares the `failures` count against the recorded baseline and
// requires it to never increase (and to DROP on remediation units).
//
// Corpus naming convention (see render-corpus/README.md):
//   good-*  — canonical, engine-supported loops; expected to render (regression guard).
//   bad-*   — minimal isolations of an engine-unsupported construct (lpenv/swingBy/arrow-sometimes).
//   real-*  — real `strudel_code` rows pulled from prod D1 where audio_url was NULL.
//
// No network/render-path code is modified by this harness; it only spawns the existing engine.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const CORPUS_DIR = path.join(HERE, 'render-corpus');
const RENDERER = path.join(REPO, 'render', 'strudel-render.mjs');
const CYCLES = 2;
// The engine has its own 30s-ready / 60s-download timeouts; this outer cap is the backstop
// so one hung Chromium can't wedge the whole ratchet.
const PER_SNIPPET_TIMEOUT_MS = 120_000;

const jsonMode = process.argv.includes('--json');
const log = (...a) => { if (!jsonMode) console.error(...a); };

function renderOne(code, outPath) {
  return new Promise((resolve) => {
    const child = spawn('node', [RENDERER, outPath, String(CYCLES)], {
      cwd: REPO,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    let done = false;
    const finish = (ok, detail) => { if (done) return; done = true; resolve({ ok, detail }); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(false, 'timeout'); }, PER_SNIPPET_TIMEOUT_MS);
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); finish(false, 'spawn: ' + e.message); });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const lastErr = stderr.trim().split('\n').filter(Boolean).pop() || '';
      finish(exitCode === 0, lastErr);
    });
    child.stdin.write(code);
    child.stdin.end();
  });
}

async function main() {
  if (!fs.existsSync(CORPUS_DIR)) {
    console.error('error: corpus dir not found:', CORPUS_DIR);
    process.exit(2);
  }
  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.js')).sort();
  if (!files.length) { console.error('error: no .js snippets in', CORPUS_DIR); process.exit(2); }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-corpus-'));
  const failing = [];
  let total = 0;

  for (const f of files) {
    const name = f.replace(/\.js$/, '');
    const code = fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8').trim();
    if (!code) continue;
    total++;
    log(`  ${name} … `);
    const { ok, detail } = await renderOne(code, path.join(tmpDir, name + '.wav'));
    if (ok) log(`    ✓ ${name}`);
    else { log(`    ✗ ${name}${detail ? '  (' + detail + ')' : ''}`); failing.push(name); }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const summary = { total, failures: failing.length, failing };
  if (jsonMode) process.stdout.write(JSON.stringify(summary) + '\n');
  else console.error(`\ncorpus: ${total - failing.length}/${total} render OK · ${failing.length} failing` +
    (failing.length ? ` → ${failing.join(', ')}` : ''));
}

main();
