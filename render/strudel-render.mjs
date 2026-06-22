#!/usr/bin/env node
// strudel-render.mjs — render a Strudel pattern to a WAV file, headlessly.
//
//   node strudel-render.mjs <out.wav> [cycles]   # code on stdin
//   node strudel-render.mjs --code "<code>" <out.wav> [cycles]
//
// Drives headless Chromium (Playwright) → render.html, which loads @strudel/web and
// renders the pattern through an OfflineAudioContext (deterministic, faster-than-
// realtime). The official renderPatternAudio() emits a WAV via a blob download; we
// capture it with Playwright and write it to <out.wav>.
//
// Tempo: renderPatternAudio uses the cps WE pass, not the code's setcpm(); so we parse
// setcpm()/setcps() out of the code and compute cps. setcpm(n) => cps=n/60; default 0.5.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = argv.slice(2);
  let code = null, out = null, cycles = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--code') { code = a[++i]; }
    else if (out === null) { out = a[i]; }
    else if (cycles === null) { cycles = Number(a[i]); }
  }
  if (!out) { console.error('usage: strudel-render.mjs <out.wav> [cycles]  (code on stdin or --code)'); process.exit(2); }
  return { code, out, cycles: cycles || 4 };
}

function readStdin() {
  return new Promise((res) => {
    let d = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => res(d));
  });
}

// Compute cycles-per-second from the code's tempo directive. Only arithmetic on numbers
// is eval'd (digits . / * + - and parens) — never anything from the pattern body.
function cpsFromCode(code) {
  const safeNum = (expr) => {
    if (!/^[\d\s.+\-*/()]+$/.test(expr)) return null;
    try { const v = Function(`"use strict";return (${expr})`)(); return Number.isFinite(v) ? v : null; } catch { return null; }
  };
  let m = code.match(/setcps\s*\(([^)]*)\)/);
  if (m) { const v = safeNum(m[1].trim()); if (v) return v; }
  m = code.match(/setcpm\s*\(([^)]*)\)/);
  if (m) { const v = safeNum(m[1].trim()); if (v) return v / 60; }
  return 0.5; // Strudel default (cpm 30)
}

// Tiny static server rooted at the render dir so the page has a real http origin
// (ESM module loading + audio-worklet addModule need an origin, not file://).
function serve(root) {
  const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function main() {
  const { code: argCode, out, cycles } = parseArgs(process.argv);
  const code = (argCode ?? (await readStdin())).trim();
  if (!code) { console.error('error: empty Strudel code'); process.exit(2); }
  const cps = cpsFromCode(code);

  const { srv, port } = await serve(HERE);
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  let failure = null;
  try {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    // Offline-reliability test hook: STRUDEL_BLOCK_EXTERNAL=1 aborts every non-localhost
    // request, proving the render needs no CDN (the @strudel/web bundle is now served
    // locally). A synth-only pattern renders fully under this; cross-origin sample-pack
    // fetches will (soft-)fail by design. Off for normal renders. Used by the offline smoke.
    if (process.env.STRUDEL_BLOCK_EXTERNAL === '1') {
      await page.route('**', (route) => {
        const host = new URL(route.request().url()).hostname;
        if (host === '127.0.0.1' || host === 'localhost') route.continue();
        else route.abort();
      });
    }
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

    await page.goto(`http://127.0.0.1:${port}/render.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.__strudelReady !== undefined', null, { timeout: 30000 });
    await page.evaluate('window.__strudelReady').catch(() => {});
    const sampleStatus = await page.evaluate('window.__samplesStatus').catch(() => null);
    if (sampleStatus) console.error('  samples:', sampleStatus.join(' | '));

    const downloadP = page.waitForEvent('download', { timeout: 60000 });
    const renderP = page.evaluate(
      ({ code, cycles, cps }) => window.__render(code, { cycles, cps }),
      { code, cycles, cps },
    );
    const [download] = await Promise.all([downloadP, renderP.catch((e) => { throw new Error('render(): ' + e.message + (pageErrors.length ? ' | ' + pageErrors.join(' ; ') : '')); })]);
    await download.saveAs(out);
    const bytes = fs.statSync(out).size;
    if (bytes < 1000) throw new Error(`WAV suspiciously small (${bytes} bytes)`);
    console.error(`✓ rendered ${cycles} cycles @ cps=${cps} → ${out} (${bytes} bytes)`);
  } catch (e) {
    failure = e;
  } finally {
    await browser.close();
    srv.close();
  }
  if (failure) { console.error('✗ render failed:', failure.message); process.exit(1); }
}

main();
