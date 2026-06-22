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

// Compose the follow-up message body. Discord caps content at 2000 chars; a full song's code can blow
// past that, so we lead with the play link and inline the code only if it fits (else link-only — the
// link is the playable deliverable). Mirrors the soul's "drop the inline code on big songs" rule.
export function followupContent(prompt, code, shareUrl) {
  const head = `🎶 **${prompt}**\n▶ ${shareUrl}`;
  const withCode = `${head}\n\`\`\`javascript\n${code}\n\`\`\``;
  if (withCode.length <= 1990) return withCode;
  return `${head}\n_(code is long — tap ▶ to play & view it on strudel.cc)_`;
}
