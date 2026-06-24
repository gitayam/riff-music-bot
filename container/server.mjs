// server.mjs — the render microservice that runs inside the Cloudflare Container (Phase 3 P1).
//
// Decomposition for the edge migration: the Worker does orchestration + the LLM compose (Strudel code);
// THIS service does the heavy, binary-dependent part the Worker can't — headless-Chromium render +
// ffmpeg transcode. It wraps the proven faithful engine (../render/strudel-render.mjs) so the audio is
// the real strudel.cc output (true 909/808/dirt samples + effects), not a synth approximation.
//
//   GET  /health            → {ok:true}
//   POST /render {code, cycles?, format?} → audio bytes (Content-Type audio/*) ; 422 if it won't render
//
// No LLM here (that's the Worker). Dep-free (stdlib http); shells out to the render engine + ffmpeg,
// exactly like scripts/api-server.py's render path. Runs as a plain node process locally (the engine
// works on this Mac) and inside the container image (Dockerfile) in prod.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Where the faithful engine lives. In the container image render/ is copied next to this file
// (RENDER_DIR=/app/render); locally it defaults to the repo's render/ sibling dir.
const RENDER_DIR = process.env.RENDER_DIR || resolve(HERE, "..", "render");
const RENDER = join(RENDER_DIR, "strudel-render.mjs");
const PORT = parseInt(process.env.PORT, 10) || 8800;
const RENDER_TIMEOUT_MS = parseInt(process.env.RENDER_TIMEOUT_MS, 10) || 180000;
// When set, /render requires `Authorization: Bearer <RENDER_TOKEN>`. Set on the server (compose
// env_file) once the service is exposed via a public tunnel; the Worker sends the same token.
// Unset (local dev) = open, so test.sh / a local node process need no header.
const RENDER_TOKEN = process.env.RENDER_TOKEN || "";

const FMT = { mp3: ["-c:a", "libmp3lame", "-q:a", "4"], ogg: ["-c:a", "libopus", "-b:a", "96k"], wav: null };
const CTYPE = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav" };

// Fast structural reject so obvious garbage doesn't pay the ~6s Chromium launch (the Worker already
// gates, but this service may be called directly). The render itself is the authoritative validator.
function looksInvalid(code) {
  const t = (code || "").trim();
  if (!t) return "empty code";
  if (t.startsWith("[")) return "the whole program is wrapped in [ ... ]";
  return null;
}

function run(cmd, args, { input, timeout } = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    const timer = timeout ? setTimeout(() => p.kill("SIGKILL"), timeout) : null;
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { if (timer) clearTimeout(timer); res({ code: -1, err: String(e) }); });
    p.on("close", (code) => { if (timer) clearTimeout(timer); res({ code, err }); });
    if (input != null) { p.stdin.write(input); p.stdin.end(); }
  });
}

// code → audio Buffer in the requested format. Throws {status} on failure.
async function renderAudio(code, cycles, fmt) {
  const cyc = Math.max(1, Math.min(16, parseInt(cycles, 10) || 4));
  const format = ["mp3", "ogg", "wav"].includes(fmt) ? fmt : "mp3";
  const bad = looksInvalid(code);
  if (bad) throw Object.assign(new Error(bad), { status: 422 });

  const dir = await mkdtemp(join(tmpdir(), "render-"));
  try {
    const wav = join(dir, "out.wav");
    // faithful render (Chromium, code on stdin) — timeout + one retry (headless audio can flake)
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      const r = await run("node", [RENDER, wav, String(cyc)], { input: code, timeout: RENDER_TIMEOUT_MS });
      ok = r.code === 0;
      if (!ok && attempt === 2) {
        throw Object.assign(new Error("render failed (likely invalid Strudel): " + r.err.trim().slice(-200)), { status: 422 });
      }
    }
    if (format === "wav") return await readFile(wav);
    const out = join(dir, `out.${format}`);
    const t = await run("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-i", wav, "-af", "alimiter=limit=0.95", ...FMT[format], out]);
    if (t.code !== 0) throw Object.assign(new Error("transcode failed: " + t.err.trim().slice(-200)), { status: 500 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return sendJson(res, 200, { ok: true });
  if (req.method === "POST" && (req.url || "").split("?")[0] === "/render") {
    // Bearer gate (only when RENDER_TOKEN is configured) — the service is public via the tunnel.
    if (RENDER_TOKEN && (req.headers["authorization"] || "") !== `Bearer ${RENDER_TOKEN}`) {
      return sendJson(res, 401, { error: "unauthorized" });
    }
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 2_000_000) req.destroy(); });
    req.on("end", async () => {
      let body;
      try { body = JSON.parse(raw || "{}"); } catch { return sendJson(res, 400, { error: "bad json" }); }
      if (!body.code || typeof body.code !== "string") return sendJson(res, 400, { error: "missing 'code'" });
      try {
        const fmt = ["mp3", "ogg", "wav"].includes(body.format) ? body.format : "mp3";
        const audio = await renderAudio(body.code, body.cycles, fmt);
        res.writeHead(200, { "Content-Type": CTYPE[fmt], "Content-Length": audio.length });
        res.end(audio);
      } catch (e) {
        sendJson(res, e.status || 500, { error: e.status === 422 ? "could not render" : "render error", detail: String(e.message || e) });
      }
    });
    return;
  }
  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log(`render service on :${PORT} (engine: ${RENDER})`));
