// render.js — the render-service client, factored out of index.js (R2.1) so it unit-tests under
// `node --test`. index.js imports `cloudflare:workers` (the DO base class) and therefore can't be
// loaded by node; renderBytes uses only fetch / AbortSignal / setTimeout (present in BOTH workerd
// and node) + audioFormat, so it lives here and index.js imports it. Behavior is unchanged.
import { audioFormat } from "./lib.js";

// Render code → audio bytes via the render service (a node process locally; self-hosted on Proxmox
// behind the CF tunnel in prod). Returns {bytes, fmt} on success, or {error} — NEVER throws. Sends
// the shared bearer (the Worker's MUSIC_API_TOKEN — one secret to rotate) and retries a transient
// 503 (cold start / tunnel reconnect) up to 3×; a real answer (200 or a 4xx like 422) returns at once.
export async function renderBytes(env, code, cycles, format) {
  const fmt = audioFormat(format);
  const body = JSON.stringify({ code, cycles, format: fmt });
  // One render attempt with a fresh per-try timeout (the render service answers in ~1-8s).
  const call = () => {
    if (!env.RENDER_SERVICE_URL) return null; // not configured (Tier-A: code + link only)
    const headers = { "Content-Type": "application/json" };
    if (env.MUSIC_API_TOKEN) headers["Authorization"] = `Bearer ${env.MUSIC_API_TOKEN}`;
    return fetch(`${env.RENDER_SERVICE_URL.replace(/\/+$/, "")}/render`, { method: "POST", headers, body, signal: AbortSignal.timeout(60000) });
  };
  try {
    let r = null;
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

// True iff the audio render path is wired: the render service URL AND the R2 bucket are both bound.
// tryRender's guard uses this (no URL/bucket → Tier-A: code + link, no audio). Exported for tests.
export function audioWired(env) {
  return !!(env && env.RENDER_SERVICE_URL && env.AUDIO);
}
