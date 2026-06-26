// discord.js — Discord Interactions webhook helpers (Phase 3 P3). Discord POSTs a signed Interaction;
// the Worker verifies the Ed25519 signature, PONGs the PING handshake, and deferred-acks a slash
// command (within 3s) — then composes the music and edits the original message via the interaction
// webhook. This is the native, event-driven replacement for the REST-poll strudel-watch.py — no laptop.
//
// Verification uses WebCrypto Ed25519 (supported in workerd). The signature is over
// `timestamp + rawBody` (UTF-8), with the app's public key (DISCORD_PUBLIC_KEY, hex of the raw 32 bytes).

// Interaction + response type constants (Discord API).
export const T = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  PONG: 1,
  DEFERRED_CHANNEL_MESSAGE: 5, // ACK + "Riff is thinking…" while we compose
};

export function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// True iff the request signature is valid for this public key. Any malformed input → false (never throws).
export async function verifyInteractionSignature(publicKeyHex, signatureHex, timestamp, rawBody) {
  try {
    if (!publicKeyHex || !signatureHex || !timestamp) return false;
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    const sig = hexToBytes(signatureHex);
    const msg = new TextEncoder().encode(timestamp + rawBody);
    return await crypto.subtle.verify("Ed25519", key, sig, msg);
  } catch {
    return false;
  }
}

// Pull the `prompt` string option out of a slash-command interaction (null if absent).
export function commandPrompt(interaction) {
  const opts = interaction?.data?.options || [];
  const p = opts.find((o) => o && o.name === "prompt");
  return typeof p?.value === "string" ? p.value : null;
}

// A stable session id for the modify chain / history, derived from where the interaction came from.
export function interactionSessionId(interaction) {
  const ch = interaction?.channel_id;
  return ch ? `discord:${ch}` : null;
}

// The webhook URL that edits the deferred (@original) response — authorized by the interaction token,
// so NO bot token is needed.
export function followupUrl(apiBase, applicationId, token) {
  const base = (apiBase || "https://discord.com/api/v10").replace(/\/+$/, "");
  return `${base}/webhooks/${applicationId}/${token}/messages/@original`;
}

// Riff's accent for the result embed (a tweakable single int — Discord embed color).
export const RIFF_COLOR = 0x8e5cff;
const EMBED_DESC_MAX = 4096;   // Discord embed description cap (vs 2000 for plain content)
const EMBED_TITLE_MAX = 256;

function truncate(s, n) {
  s = String(s ?? "");
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// Build the result as a Discord EMBED: the prompt as the title, a MASKED play link (so the ~300-char
// base64 share URL never shows and Discord doesn't unfurl an ugly preview), the code inline, an accent
// color, and a footer that surfaces the follow-up superpower. The rendered mp3 is attached separately
// (Discord shows an inline player) — `hasAudio:false` adds a one-line note so a render miss isn't silent.
// Code is inlined when it fits the 4096 description cap; a huge song degrades to link-only (the link is
// the playable deliverable). Returns a Discord embed object.
export function followupEmbed(prompt, code, shareUrl, { hasAudio = true } = {}) {
  const play = `**[▶ Play on strudel.cc](${shareUrl})**`;
  const fence = "```js\n" + code + "\n```";
  const audioNote = hasAudio ? "" : "\n\n🔇 *Audio didn't render this time — tap ▶ to play it in your browser.*";
  let description = `${play}\n${fence}${audioNote}`;
  if (description.length > EMBED_DESC_MAX) {
    description = `${play}\n*(code is long — tap ▶ to open, play & view it on strudel.cc)*${audioNote}`;
  }
  return {
    title: truncate(`🎶 ${prompt}`, EMBED_TITLE_MAX),
    description,
    color: RIFF_COLOR,
    footer: { text: 'Riff · reply "darker", "add a bassline", or "give me 3 variations" to remix' },
  };
}

// The friendly nudge when someone invokes Riff with no prompt — examples + the remix hint.
export function emptyPromptMessage() {
  return [
    "🎶 **Tell me what to make** — a genre, a mood, or an occasion:",
    "> `/riff` *funky disco loop, 120 bpm*",
    "> `/riff` *dreamy lofi to study to*",
    "> `/riff` *a triumphant victory fanfare*",
    'Then remix it: **darker · add a bassline · give me 3 variations**.',
  ].join("\n");
}

// Human, actionable error copy — NEVER leak raw internals (those go to the server log). Lightly tailored
// by the error's HTTP-ish status so a timeout vs. an upstream outage reads differently.
export function composeErrorMessage(err) {
  const status = err && err.status;
  if (status === 504) return "⏳ That took too long to compose — give it another try in a moment.";
  if (status === 502) return "🔌 My music brain is unavailable right now — please try again shortly.";
  return "😕 I couldn't turn that into music just now. Try rephrasing with a genre, mood, or tempo — e.g. *“chill lofi, 90 bpm”*.";
}
