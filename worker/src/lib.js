// lib.js — pure, runtime-agnostic helpers for the Riff music Worker (Phase 3 P0).
// No Worker/Node globals at module top-level (uses only btoa/TextEncoder/RegExp), so this
// imports cleanly under both `workerd` and `node --test`. The Worker (index.js) wires these
// to fetch()/env; these functions carry the logic worth unit-testing on their own.

// Riff's composing brief — a tight distillation of souls/hermes.SOUL.md, scoped to "emit ONE
// valid Strudel block". Kept here (not fetched from the soul at runtime) so the edge Worker has
// no extra round-trip; keep in sync with the soul's genre defaults + intent→transform table.
export const SYSTEM_PROMPT = `You are Riff, a music director that composes loops and full songs as Strudel live-coding patterns. Strudel is a JS pattern language (a TidalCycles port) evaluated to Web Audio in the browser.

Respond with EXACTLY ONE fenced code block: \`\`\`javascript ... \`\`\` containing only valid Strudel — no prose, no explanation, nothing outside the block.

Rules for valid Strudel:
- Set tempo with setcpm(bpm/4) (1 cycle = 1 bar of 4 beats). Never invent a tempo verb.
- Build texture with stack(...): layer sound("bd*4"), note("c2 eb2 g2"), n("0 2 4").scale("C:minor"), etc.
- Use ONLY real Strudel verbs: sound, note, n, s, stack, arrange, cat, scale, bank, gain, lpf, hpf, lpenv, room, delay, fast, slow, struct, euclid, swing, swingBy, every, range, sometimes. Do NOT use .base(), .gtrain(), or any invented method.
- Drum machines: .bank("RolandTR909") / .bank("RolandTR808"). Dirt samples: "bd hh sd cp oh rim".
- NEVER wrap the whole program in square brackets [ ... ] — that is a syntax error. The [bars, section] arrays inside arrange([8,verse],[8,chorus]) are fine; wrapping the entire program is not.
- For a full song, define sections as const (intro/verse/chorus/bridge/outro) and sequence them with arrange([bars,section], ...).

Genre defaults when unspecified: 120 bpm, C minor, a RolandTR909 kit. Map mood→{tempo,mode,density}: chill→slower + fewer layers + more .room(); dark→phrygian/minor + lower .lpf(); hype→faster + denser + brighter. Honor explicit constraints (bpm, key, scale, instrumentation) exactly.`;

// base64(utf8(code)) — byte-identical to Python base64.b64encode(code.encode()) and to
// strudel-song-links.mjs's Buffer.from(s,'utf8').toString('base64'), so links from the edge
// match the local system exactly. Strudel deep-links are standard base64 (with +/=), not URL-safe.
export function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function shareUrl(code) {
  return "https://strudel.cc/#" + b64utf8(code);
}

const FENCE_RE = /```(?:javascript|js)?\s*\n([\s\S]*?)```/;

// Pull the first ```javascript (or bare ```) block out of an LLM reply. null if there is none.
export function extractStrudel(text) {
  if (typeof text !== "string") return null;
  const m = FENCE_RE.exec(text);
  if (!m) return null;
  const code = m[1].trim();
  return code || null;
}

// Real Strudel programs begin a statement with one of these (or a comment / const / $:).
const STRUDEL_CALL_RE = /\b(?:setcpm|setcps|stack|arrange|cat|sound|note|n|s)\s*\(|\$:\s*/;

// Lightweight STRUCTURAL pre-check — not a full parse. The authoritative @strudel/transpiler
// parse-gate (scripts/render/render.mjs) lands in P1 alongside the Container render; until then
// this catches the two failure modes we actually see from the model: prose-instead-of-code, and
// the documented "[ ...whole program... ]" array-wrap bug. Returns null if OK, else an error string.
export function validateStrudel(code) {
  if (typeof code !== "string" || !code.trim()) return "empty code";
  const t = code.trim();
  if (t.startsWith("[")) return "the whole program is wrapped in [ ... ] (a Strudel syntax error)";
  if (t.includes("```")) return "stray markdown fence left in the code";
  if (!STRUDEL_CALL_RE.test(t)) return "does not look like Strudel (no stack/sound/note/arrange/setcpm call)";
  return null;
}

// OpenAI Chat Completions request body for gpt-5.4-class models. Per the project model rules:
// reasoning_effort is a flat string, only max_completion_tokens (never max_tokens), and no
// temperature (unsupported on gpt-5.4 unless reasoning_effort:"none"). Composing is templated
// slot-filling → "low" effort is fast and sufficient.
export function buildChatBody(userContent, model) {
  return {
    model: model || "gpt-5.4",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    reasoning_effort: "low",
    max_completion_tokens: 1500,
  };
}

// The re-prompt used by the auto-repair loop when an attempt fails the structural gate — mirrors
// api-server.py generate_valid(): hand the model its broken code + the exact error and ask for a fix.
export function repairPrompt(prompt, lastErr, brokenCode) {
  return `${prompt}\n\nYour previous attempt was not valid Strudel. Error: ${lastErr}\nBroken code:\n${brokenCode}\nReturn corrected, valid Strudel code only (one \`\`\`javascript block).`;
}

// The modify ask: hand the model the current code + a NL change and get the FULL updated program back.
// This is Situation E ("faster" / "add a bassline" / "darker") — the demo's core differentiator: we
// edit the code, we don't re-roll a black box. The same SYSTEM_PROMPT (valid-Strudel rules) applies.
export function modifyUserContent(code, instruction) {
  return `Current Strudel code:\n${code}\n\nApply this change and return the FULL updated program as one \`\`\`javascript block (keep everything else intact): ${instruction}`;
}

// Minimal LCS line-diff so a /modify response can SHOW the change (what makes the modify demo land).
// Pure + O(n·m) — fine for short patterns. Returns [{tag:' '|'-'|'+', line}].
export function lineDiff(a, b) {
  const A = String(a).split("\n");
  const B = String(b).split("\n");
  const m = A.length, n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ tag: " ", line: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ tag: "-", line: A[i] }); i++; }
    else { out.push({ tag: "+", line: B[j] }); j++; }
  }
  while (i < m) out.push({ tag: "-", line: A[i++] });
  while (j < n) out.push({ tag: "+", line: B[j++] });
  return out;
}

// Compact unified-ish diff string (only the changed lines) for the /modify JSON response.
export function diffString(a, b) {
  return lineDiff(a, b)
    .filter((d) => d.tag !== " ")
    .map((d) => `${d.tag} ${d.line}`)
    .join("\n");
}

// ── Rendered-audio helpers (P1 last mile: render service → R2 → served at GET /audio/<key>) ──
const AUDIO_CT = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav" };
export const audioFormat = (f) => (["mp3", "ogg", "wav"].includes(f) ? f : "mp3");
export const audioContentType = (f) => AUDIO_CT[audioFormat(f)];
export const audioKey = (id, format) => `tracks/${id}.${audioFormat(format)}`;
// Absolute, embeddable URL for an R2-stored render: this Worker's origin + the /audio/<key> route.
export function audioUrlFor(requestUrl, key) {
  return `${new URL(requestUrl).origin}/audio/${key}`;
}
