// index.js — Riff music API as a Cloudflare Worker (Phase 3 P0 + P2: edge orchestrator, Tier-A).
//
// Ports scripts/api-server.py to the edge: prompt → gpt-5.4 (via fetch) → valid Strudel → strudel.cc
// link, with a per-session modify chain (Durable Object) and cross-session history (D1). NO audio
// render yet — that needs a Container (Phase 3 P1), so audio_url is always null here.
//
//   GET  /health               → {ok:true}
//   GET  /                      → self-documenting capabilities
//   GET  /history?session_id=…  → {tracks:[…]}  (bearer-gated; cross-session history from D1)
//   POST /generate {prompt}     → {prompt, strudel_code, share_url, audio_url:null, version, …}
//   POST /modify {session_id, instruction} → {…, diff, version, parent_id}  (edits the last version)
//   POST /render   {code}       → same shape (skips the LLM; validates + links code you already have)
//
// Auth: every POST + /history needs `Authorization: Bearer <MUSIC_API_TOKEN>` (matches api-server.py).
// Env: OPENAI_API_KEY (secret), MUSIC_API_TOKEN (secret), OPENAI_MODEL/OPENAI_BASE_URL/RETENTION_DAYS
//      (vars); bindings SESSIONS (Durable Object), DB (D1). Daily Cron Trigger → scheduled() prunes D1.

import {
  shareUrl, extractStrudel, validateStrudel, buildChatBody, repairPrompt,
  modifyUserContent, diffString, audioFormat, audioKey, audioUrlFor, audioContentType,
} from "./lib.js";
import { sanitizeStrudel } from "./sanitize.js";
import { Session } from "./session.js";
import { insertTrack, recentTracks, pruneTracks, buildTrackRow, newId, nowSec, embeddedTracks, trackById } from "./store.js";
import { rankBySimilarity, parseEmbedding } from "./similar.js";
import {
  T, verifyInteractionSignature, commandPrompt, interactionSessionId, followupUrl, followupContent,
} from "./discord.js";

export { Session }; // the runtime needs the DO class exported from the entry module

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Call the LLM. Throws Error with .status set (502 upstream error, 504 timeout) for clean mapping.
async function callOpenAI(env, userContent) {
  const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = env.OPENAI_MODEL || "gpt-5.4";
  if (!env.OPENAI_API_KEY) {
    const e = new Error("OPENAI_API_KEY is not configured on the Worker");
    e.status = 502;
    throw e;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000); // Workers fetch wall-clock guard
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify(buildChatBody(userContent, model)),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 300);
      const e = new Error(`OpenAI upstream ${r.status}: ${txt}`);
      e.status = 502;
      throw e;
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      const e = new Error("OpenAI returned no message content");
      e.status = 502;
      throw e;
    }
    return content;
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error("LLM call timed out");
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Ask the LLM for valid Strudel from `initialContent`, auto-repairing on a failed structural gate
// (mirrors api-server.py generate_valid). Used by both /generate (content = the prompt) and /modify
// (content = current code + the change). Throws Error{status:422} if it never converges.
async function composeValid(env, initialContent, attempts) {
  attempts = Math.max(1, Math.min(4, parseInt(attempts, 10) || 2));
  let lastErr = "invalid Strudel code";
  let code = "";
  for (let i = 0; i < attempts; i++) {
    const userContent = i === 0 ? initialContent : repairPrompt(initialContent, lastErr, code.slice(0, 800));
    const text = await callOpenAI(env, userContent);
    const extracted = extractStrudel(text);
    if (extracted === null) {
      lastErr = "no ```javascript code block in the reply";
      code = text.slice(0, 800);
      continue;
    }
    code = extracted;
    const err = validateStrudel(code);
    // Sanitize AFTER the structural gate, BEFORE share/render: rewrite engine-unsupported
    // constructs (one-arg .swingBy → .swing(4); drop .lpenv/.sometimes) so the composed code
    // renders to audio instead of degrading to code+link. Pure + idempotent; /render's own
    // caller-supplied code is never rewritten (validated separately, by contract).
    if (err === null) return sanitizeStrudel(code);
    lastErr = err;
  }
  const e = new Error(`could not produce valid Strudel after ${attempts} attempts: ${lastErr}`);
  e.status = 422;
  throw e;
}

// The DO stub for a conversation. idFromName(session_id) is stable, so the same session_id always
// maps to the same modify chain (Contract 1: "discord:user:1234").
function sessionStub(env, sessionId) {
  return env.SESSIONS.get(env.SESSIONS.idFromName(sessionId));
}

// Render code → audio bytes via the render service (a Container in prod; a node process locally).
// Returns {bytes, fmt} on success, or {error} — never throws. Shared by the HTTP API (tryRender,
// which stores to R2) and the Discord follow-up (which attaches the bytes to the message).
async function renderBytes(env, code, cycles, format) {
  const fmt = audioFormat(format);
  const body = JSON.stringify({ code, cycles, format: fmt });
  // One render attempt with a fresh per-try timeout (the render service answers in ~1-8s).
  const call = () => {
    if (!env.RENDER_SERVICE_URL) return null; // not configured (Tier-A: code + link only)
    const headers = { "Content-Type": "application/json" };
    // The render service (self-hosted on Proxmox, reached over the CF tunnel) requires the shared
    // bearer — reuse the Worker's MUSIC_API_TOKEN so there's one secret to rotate.
    if (env.MUSIC_API_TOKEN) headers["Authorization"] = `Bearer ${env.MUSIC_API_TOKEN}`;
    return fetch(`${env.RENDER_SERVICE_URL.replace(/\/+$/, "")}/render`, { method: "POST", headers, body, signal: AbortSignal.timeout(60000) });
  };
  try {
    let r = null;
    // Retry a transient 503 (e.g. the render service restarting / a tunnel reconnect) so a blip
    // degrades gracefully rather than dropping the audio. Steady state answers on the first try.
    for (let i = 0; i < 3; i++) {
      const res = call();
      if (res === null) return { error: "render service not configured" };
      r = await res;
      if (r.status !== 503) break;                       // got a real answer (200, or a 4xx like 422)
      await new Promise((s) => setTimeout(s, 7000));      // give the cold instance time to finish booting
    }
    if (!r.ok) return { error: `render service returned ${r.status}` };
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length === 0) return { error: "render service returned empty audio" };
    return { bytes, fmt };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 150) };
  }
}

// P1 last mile for the HTTP API: render → store in R2 → served audio_url. BEST-EFFORT — you always get
// the code + share link; any failure degrades to {render_error}, never throws. {} when not wanted/wired.
async function tryRender(env, { code, cycles, format, id, requestUrl, want }) {
  if (!want) return {};
  if (!env.RENDER_SERVICE_URL || !env.AUDIO) return {}; // not wired (Tier-A) — no error, just no audio
  const out = await renderBytes(env, code, cycles, format);
  if (out.error) return { render_error: out.error };
  try {
    const key = audioKey(id, out.fmt);
    await env.AUDIO.put(key, out.bytes, { httpMetadata: { contentType: audioContentType(out.fmt) } });
    return { audio_url: audioUrlFor(requestUrl, key) };
  } catch (e) {
    return { render_error: String(e.message || e).slice(0, 150) };
  }
}

// Whether to render for this request: /render renders by default, /generate & /modify only on req.render===true.
function wantsRender(path, req) {
  return path === "/render" ? req.render !== false : req.render === true;
}

// Embed text for "more like this" (OpenAI embeddings). BEST-EFFORT — returns a float[] or null, never
// throws. Gated by EMBED_TRACKS (off by default, since it's a per-write API cost); when off, the
// similarity feature is simply dormant (no candidates).
async function tryEmbed(env, text) {
  if (env.EMBED_TRACKS !== "true" || !env.OPENAI_API_KEY || !text) return null;
  const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = env.EMBEDDINGS_MODEL || "text-embedding-3-small";
  try {
    const r = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, input: String(text).slice(0, 8000) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const v = d?.data?.[0]?.embedding;
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

// The text we embed for a track — the musical intent (prompt/instruction) plus a bit of the code.
function embedSource(req, code, instruction) {
  return [req?.prompt, instruction, (code || "").slice(0, 400)].filter(Boolean).join("\n");
}

async function handlePost(request, env, path) {
  // Auth — same contract as api-server.py: no token configured OR mismatch → 401.
  const auth = request.headers.get("Authorization") || "";
  if (!env.MUSIC_API_TOKEN || auth !== `Bearer ${env.MUSIC_API_TOKEN}`) {
    return json(401, { error: "unauthorized" });
  }
  let req;
  try {
    req = await request.json();
  } catch {
    return json(400, { error: "bad json" });
  }

  try {
    // /similar — "more like this": rank stored tracks by embedding cosine similarity to a query
    // (free text) or to an existing track (track_id). Read-only; bearer-gated like the other POSTs.
    if (path === "/similar") {
      if (!env.DB) return json(503, { error: "similarity unavailable (no D1 binding)" });
      let queryVec, excludeId = null;
      if (req.track_id && typeof req.track_id === "string") {
        const t = await trackById(env, req.track_id);
        if (!t) return json(404, { error: "unknown track_id" });
        queryVec = parseEmbedding(t.embedding);
        excludeId = req.track_id;
        if (!queryVec) return json(422, { error: "that track has no embedding (EMBED_TRACKS was off when it was created)" });
      } else if (req.text && typeof req.text === "string") {
        queryVec = await tryEmbed(env, req.text);
        if (!queryVec) return json(503, { error: "embeddings unavailable (EMBED_TRACKS off or embed failed)" });
      } else {
        return json(400, { error: "provide 'text' or 'track_id'" });
      }
      const cands = (await embeddedTracks(env, 500)).map((t) => ({ ...t, embedding: parseEmbedding(t.embedding) }));
      const matches = rankBySimilarity(queryVec, cands, req.limit || 5, (c) => c.id === excludeId);
      return json(200, { matches });
    }

    // /modify is stateful (loads + edits the session's last version) → handled on its own.
    if (path === "/modify") {
      if (!req.session_id || typeof req.session_id !== "string") return json(400, { error: "missing 'session_id'" });
      if (!req.instruction || typeof req.instruction !== "string") return json(400, { error: "missing 'instruction'" });
      const stub = sessionStub(env, req.session_id);
      const prev = await stub.latest();
      if (!prev) return json(404, { error: "unknown session_id — call /generate with this session_id first" });
      const code = await composeValid(env, modifyUserContent(prev.code, req.instruction), req.repair_attempts);
      const share = shareUrl(code);
      const trackId = newId();
      const rendered = await tryRender(env, { code, cycles: req.cycles, format: req.format, id: trackId, requestUrl: request.url, want: wantsRender(path, req) });
      const embedding = await tryEmbed(env, embedSource(req, code, req.instruction));
      // Persist FIRST (so the D1 row id can be stored in the DO version for parent-linking), then
      // append to the DO. Both happen only after composeValid succeeded — an invalid modify (422)
      // never advances the chain.
      await insertTrack(env, buildTrackRow({
        session_id: req.session_id, instruction: req.instruction, source: "modify", strudel_code: code,
        share_url: share, audio_url: rendered.audio_url ?? null, embedding, parent_id: prev.track_id ?? null, version: prev.version + 1,
      }, trackId));
      const version = await stub.append({ code, share_url: share, source: "modify", instruction: req.instruction, track_id: trackId });
      return json(200, {
        session_id: req.session_id,
        instruction: req.instruction,
        strudel_code: code,
        share_url: share,
        diff: diffString(prev.code, code), // show the change — the modify demo's whole point
        audio_url: rendered.audio_url ?? null,
        ...(rendered.render_error ? { render_error: rendered.render_error } : {}),
        version,
        parent_id: prev.version,
        engine: rendered.audio_url ? "audio" : "tier-a-link",
      });
    }

    let code;
    if (path === "/generate") {
      if (!req.prompt || typeof req.prompt !== "string") return json(400, { error: "missing 'prompt'" });
      code = await composeValid(env, req.prompt, req.repair_attempts);
    } else if (path === "/render") {
      if (!req.code || typeof req.code !== "string") return json(400, { error: "missing 'code'" });
      const err = validateStrudel(req.code); // caller's own code → never rewrite it, 422 if invalid
      if (err) return json(422, { error: "invalid Strudel", detail: err });
      code = req.code;
    } else {
      return json(404, { error: "not found" });
    }
    // Optionally start/extend a session so the result can be modified later.
    const share = shareUrl(code);
    const source = path.slice(1); // "generate" | "render"
    let version = 1, parent_id = null, parentTrackId = null;
    if (req.session_id && typeof req.session_id === "string") {
      const stub = sessionStub(env, req.session_id);
      const prev = await stub.latest();
      parent_id = prev ? prev.version : null;
      parentTrackId = prev ? prev.track_id ?? null : null;
      version = (prev ? prev.version : 0) + 1;
    }
    // Render to audio if wanted + wired (P1): /render renders by default, /generate on req.render===true.
    const trackId = newId();
    const rendered = await tryRender(env, { code, cycles: req.cycles, format: req.format, id: trackId, requestUrl: request.url, want: wantsRender(path, req) });
    const embedding = await tryEmbed(env, embedSource(req, code, null));
    // Persist to D1 (cross-session history), then record the D1 id in the session's modify chain.
    await insertTrack(env, buildTrackRow({
      session_id: req.session_id ?? null, prompt: req.prompt ?? null, source,
      strudel_code: code, share_url: share, audio_url: rendered.audio_url ?? null, embedding, parent_id: parentTrackId, version,
    }, trackId));
    if (req.session_id && typeof req.session_id === "string") {
      await sessionStub(env, req.session_id).append({ code, share_url: share, source, instruction: null, track_id: trackId });
    }
    return json(200, {
      prompt: req.prompt ?? null,
      session_id: req.session_id ?? null,
      strudel_code: code,
      share_url: share,
      audio_url: rendered.audio_url ?? null, // filled when the render service is wired (else Tier-A null)
      ...(rendered.render_error ? { render_error: rendered.render_error } : {}),
      version,
      parent_id,
      engine: rendered.audio_url ? "audio" : "tier-a-link",
    });
  } catch (e) {
    return json(e.status || 500, { error: e.status === 422 ? "invalid Strudel" : "error", detail: String(e.message || e) });
  }
}

// Discord Interactions webhook (Phase 3 P3). Auth here is the Ed25519 SIGNATURE, not the bearer token
// (Discord can't send our token). Verify, PONG a PING, deferred-ack a command, compose in the background.
async function handleDiscordInteraction(request, env, ctx) {
  const sig = request.headers.get("X-Signature-Ed25519");
  const ts = request.headers.get("X-Signature-Timestamp");
  const raw = await request.text(); // RAW body — signature is over (timestamp + raw)
  if (!env.DISCORD_PUBLIC_KEY) return new Response("discord not configured", { status: 503 });
  if (!(await verifyInteractionSignature(env.DISCORD_PUBLIC_KEY, sig, ts, raw))) {
    return new Response("invalid request signature", { status: 401 });
  }
  let interaction;
  try { interaction = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  if (interaction.type === T.PING) return json(200, { type: T.PONG });
  if (interaction.type === T.APPLICATION_COMMAND) {
    // Ack within 3s; the compose + message edit happen after we respond.
    ctx.waitUntil(composeAndFollowup(env, interaction));
    return json(200, { type: T.DEFERRED_CHANNEL_MESSAGE });
  }
  return json(200, { type: T.PONG }); // unknown type → harmless ack
}

// Edit the deferred @original message — with the rendered audio attached (multipart) when we have it,
// else plain text. Discord plays an mp3 attachment inline, so this is "real audio in Discord".
async function patchFollowup(url, content, audio) {
  let init;
  if (audio) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content, attachments: [{ id: 0, filename: "riff.mp3" }] }));
    form.append("files[0]", new Blob([audio], { type: "audio/mpeg" }), "riff.mp3");
    init = { method: "PATCH", body: form }; // fetch sets multipart Content-Type + boundary
  } else {
    init = { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) };
  }
  await fetch(url, init);
}

// Runs after the deferred ack: compose Strudel, render audio (best-effort), persist, and edit the message.
async function composeAndFollowup(env, interaction) {
  const url = followupUrl(env.DISCORD_API_BASE, interaction.application_id, interaction.token);
  const prompt = commandPrompt(interaction);
  let content, audio = null;
  try {
    if (!prompt) {
      content = "Give me something to make — e.g. `/riff prompt: funky disco loop, 120bpm`.";
    } else {
      const code = await composeValid(env, prompt, 2);
      const share = shareUrl(code);
      // Render the audio for Discord (best-effort — degrade to code+link if it fails/unconfigured).
      const id = newId();
      const r = await renderBytes(env, code, 4, "mp3");
      let audio_url = null;
      if (r.bytes) {
        audio = r.bytes;
        if (env.AUDIO) {
          try {
            const key = audioKey(id, "mp3");
            await env.AUDIO.put(key, r.bytes, { httpMetadata: { contentType: "audio/mpeg" } });
            // Absolute audio_url needs the Worker's public origin (no request.url in this async ctx);
            // set PUBLIC_BASE_URL to record it in history. The Discord attachment carries the audio regardless.
            if (env.PUBLIC_BASE_URL) audio_url = `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/audio/${key}`;
          } catch { /* R2 optional for Discord — the attachment still carries the audio */ }
        }
      }
      // Best-effort history (source 'discord'); never block the reply on persistence.
      await insertTrack(env, buildTrackRow({
        session_id: interactionSessionId(interaction), prompt, source: "discord",
        strudel_code: code, share_url: share, audio_url, version: 1,
      }, id));
      content = followupContent(prompt, code, share);
    }
  } catch (e) {
    content = `Couldn't compose that: ${String(e.message || e).slice(0, 150)}`;
    audio = null;
  }
  try {
    await patchFollowup(url, content, audio);
  } catch (e) {
    console.log("discord followup failed:", e.message);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (request.method === "GET") {
      if (pathname === "/health") return json(200, { ok: true });
      if (pathname.startsWith("/audio/")) {
        // Serve a rendered audio object from R2 (public — it's music, and audio_url must be embeddable).
        if (!env.AUDIO) return json(503, { error: "audio store not configured" });
        const key = decodeURIComponent(pathname.slice("/audio/".length));
        const obj = await env.AUDIO.get(key);
        if (!obj) return json(404, { error: "not found" });
        const h = new Headers(CORS);
        h.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
        h.set("Cache-Control", "public, max-age=31536000, immutable");
        return new Response(obj.body, { headers: h });
      }
      if (pathname === "/history") {
        // Exposes other sessions' content → bearer-gated like the POSTs.
        const auth = request.headers.get("Authorization") || "";
        if (!env.MUSIC_API_TOKEN || auth !== `Bearer ${env.MUSIC_API_TOKEN}`) return json(401, { error: "unauthorized" });
        if (!env.DB) return json(503, { error: "history unavailable (no D1 binding)" });
        const u = new URL(request.url);
        try {
          const rows = await recentTracks(env, {
            session_id: u.searchParams.get("session_id"),
            limit: u.searchParams.get("limit"),
          });
          const tracks = rows.map(({ embedding, ...t }) => t); // don't ship the bulky embedding blob
          return json(200, { tracks });
        } catch (e) {
          return json(500, { error: "history query failed", detail: String(e.message || e) });
        }
      }
      if (pathname === "/" || pathname === "/help") {
        return json(200, {
          service: "Riff music API (Cloudflare Worker · Phase 3 P0+P2 · Tier-A link)",
          auth: "Authorization: Bearer <MUSIC_API_TOKEN> on every POST and on GET /history",
          endpoints: {
            "POST /generate": "{prompt, session_id?, render?=false, format?, repair_attempts?=2} → {strudel_code, share_url, audio_url, version, session_id} (prompt → Strudel via gpt-5.4; render:true also renders audio when the render service is wired)",
            "POST /modify": "{session_id, instruction, render?=false, repair_attempts?=2} → {strudel_code, share_url, diff, audio_url, version, parent_id} (edits the session's latest version — 'faster' / 'darker' — and returns the code diff)",
            "POST /render": "{code, session_id?, format?=mp3} → renders to audio (audio_url) when the render service is wired, else validates + links",
            "POST /similar": "{text | track_id, limit?=5} → {matches:[…]} — 'more like this' by embedding cosine similarity (needs EMBED_TRACKS)",
            "GET /audio/<key>": "serves a rendered audio file from R2 (public)",
            "GET /history": "?session_id=…&limit=…(≤100, default 20) → {tracks:[…]} (cross-session history from D1, newest first)",
            "POST /discord/interactions": "Discord Interactions webhook (Ed25519-signed, not bearer): PING→PONG, slash command→deferred ack then a follow-up with code + ▶ link",
            "GET /health": "{ok:true}",
          },
          note: "Edge orchestrator: code + a strudel.cc link, a per-session modify chain (DO), cross-session history (D1), and — when the render service (Container) is wired — real rendered audio in R2 served at /audio/<key>.",
        });
      }
      return json(404, { error: "not found" });
    }

    if (request.method === "POST") {
      if (pathname === "/discord/interactions") return handleDiscordInteraction(request, env, ctx);
      return handlePost(request, env, pathname);
    }
    return json(405, { error: "method not allowed" });
  },

  // Daily Cron Trigger (wrangler.toml [triggers]) → prune tracks older than RETENTION_DAYS so the D1
  // tracks log can't grow into the 10 GB cap. A DELETE is cheap → safe to run inline in the 30s cron CPU.
  async scheduled(event, env, ctx) {
    const days = parseInt(env.RETENTION_DAYS, 10) || 30;
    const deleted = await pruneTracks(env, days);
    console.log(`retention: pruned ${deleted} track(s) older than ${days}d`);
  },
};
