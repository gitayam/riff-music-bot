// index.js — Riff music API as a Cloudflare Worker (Phase 3 P0: "Worker shell").
//
// Ports the request/response surface of scripts/api-server.py to the edge, Tier-A only:
// prompt → gpt-5.4 (via fetch) → valid Strudel → strudel.cc share link. NO audio render yet —
// that needs a Container (Phase 3 P1), so audio_url is always null here. This proves the
// orchestrator runs off-laptop on a stable URL; render is the next vertical slice.
//
//   GET  /health            → {ok:true}
//   GET  /                  → self-documenting capabilities
//   POST /generate {prompt} → {prompt, strudel_code, share_url, audio_url:null, version, engine}
//   POST /render   {code}   → same shape (skips the LLM; validates + links code you already have)
//
// Auth: every POST needs `Authorization: Bearer <MUSIC_API_TOKEN>` (matches api-server.py).
// Env: OPENAI_API_KEY (secret), MUSIC_API_TOKEN (secret), OPENAI_MODEL (var, default gpt-5.4),
//      OPENAI_BASE_URL (var, default https://api.openai.com/v1 — point at an AI Gateway in prod).

import {
  shareUrl, extractStrudel, validateStrudel, buildChatBody, repairPrompt,
  modifyUserContent, diffString,
} from "./lib.js";
import { Session } from "./session.js";

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
    if (err === null) return code;
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
    // /modify is stateful (loads + edits the session's last version) → handled on its own.
    if (path === "/modify") {
      if (!req.session_id || typeof req.session_id !== "string") return json(400, { error: "missing 'session_id'" });
      if (!req.instruction || typeof req.instruction !== "string") return json(400, { error: "missing 'instruction'" });
      const stub = sessionStub(env, req.session_id);
      const prev = await stub.latest();
      if (!prev) return json(404, { error: "unknown session_id — call /generate with this session_id first" });
      const code = await composeValid(env, modifyUserContent(prev.code, req.instruction), req.repair_attempts);
      const share = shareUrl(code);
      const version = await stub.append({ code, share_url: share, source: "modify", instruction: req.instruction });
      return json(200, {
        session_id: req.session_id,
        instruction: req.instruction,
        strudel_code: code,
        share_url: share,
        diff: diffString(prev.code, code), // show the change — the modify demo's whole point
        audio_url: null,
        version,
        parent_id: prev.version,
        engine: "tier-a-link",
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
    let version = 1, parent_id = null;
    if (req.session_id && typeof req.session_id === "string") {
      const stub = sessionStub(env, req.session_id);
      const prev = await stub.latest();
      parent_id = prev ? prev.version : null;
      version = await stub.append({ code, share_url: share, source: path.slice(1), instruction: null });
    }
    return json(200, {
      prompt: req.prompt ?? null,
      session_id: req.session_id ?? null,
      strudel_code: code,
      share_url: share,
      audio_url: null, // Tier-A: render (audio) lands in Phase 3 P1 (Container)
      version,
      parent_id,
      engine: "tier-a-link",
    });
  } catch (e) {
    return json(e.status || 500, { error: e.status === 422 ? "invalid Strudel" : "error", detail: String(e.message || e) });
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (request.method === "GET") {
      if (pathname === "/health") return json(200, { ok: true });
      if (pathname === "/" || pathname === "/help") {
        return json(200, {
          service: "Riff music API (Cloudflare Worker · Phase 3 P0+P2 · Tier-A link)",
          auth: "Authorization: Bearer <MUSIC_API_TOKEN> on every POST",
          endpoints: {
            "POST /generate": "{prompt, session_id?, repair_attempts?=2} → {strudel_code, share_url, audio_url:null, version, session_id} (prompt → Strudel via gpt-5.4; auto-repairs invalid Strudel; pass a stable session_id to enable /modify)",
            "POST /modify": "{session_id, instruction, repair_attempts?=2} → {strudel_code, share_url, diff, version, parent_id} (edits the session's latest version — 'faster' / 'darker' / 'add a bassline' — and returns the code diff)",
            "POST /render": "{code, session_id?} → same shape (validates + links Strudel you already have)",
            "GET /health": "{ok:true}",
          },
          note: "Tier-A: returns code + a one-click strudel.cc play link, and a per-session modify chain (Durable Object). Audio render (audio_url) arrives in Phase 3 P1 (Container).",
        });
      }
      return json(404, { error: "not found" });
    }

    if (request.method === "POST") return handlePost(request, env, pathname);
    return json(405, { error: "method not allowed" });
  },
};
