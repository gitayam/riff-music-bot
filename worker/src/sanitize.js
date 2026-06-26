// sanitize.js — post-compose Strudel sanitizer (Phase R1.1, reliability roadmap).
//
// sanitizeStrudel(code) rewrites/strips the constructs the offline render engine
// (@strudel/web@1.3.0, driven by render/strudel-render.mjs — the SAME engine the prod
// render service wraps in container/server.mjs) cannot render, so more /riff outputs land
// real audio instead of degrading to code+link.
//
// PURE · IDEMPOTENT · NEVER THROWS. It only ever removes or normalizes method calls — it
// never invents Strudel — so the public payload stays valid Strudel; the worst case is the
// pre-existing 422 → code+link. It is applied to LLM-COMPOSED code only (composeValid), never
// to a caller's own /render code.
//
// Empirically measured by the render-corpus ratchet (see docs/reliability-roadmap-progress.md,
// R0.1 finding): in the local engine the ONLY hard failure is **one-arg `.swingBy(x)`** —
// the engine's swingBy needs two args. `.lpenv(...)`, arrow-`.sometimes(x=>…)`, and two-arg
// `.swingBy(x,n)` all render fine, but lpenv/sometimes are stripped defensively (cheap, keeps
// us inside the prescribed supported subset, and guards against engine drift).

const SWING_DEFAULT = 4;

// Remove every `.<method>( …balanced… )` call from `code`, honoring nested parens so an arrow
// body like `.sometimes(x => x.fast(2))` is removed whole, not truncated at the inner ')'.
// Unbalanced input leaves the remainder untouched (best-effort, never throws).
function stripBalancedMethodCalls(code, method) {
  const needle = "." + method + "(";
  let out = code;
  for (;;) {
    const start = out.indexOf(needle);
    if (start === -1) break;
    let depth = 0, end = -1;
    for (let i = start + needle.length - 1; i < out.length; i++) {
      const c = out[i];
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) { end = i; break; }
    }
    if (end === -1) break; // unbalanced — stop, leave the rest as-is
    out = out.slice(0, start) + out.slice(end + 1);
  }
  return out;
}

export function sanitizeStrudel(code) {
  if (typeof code !== "string" || !code) return code;
  let out = code;

  // 1) one-arg `.swingBy(x)` → `.swing(4)` — THE fix. The single argument is a number/simple
  //    expr with no comma or nested call; two-arg `.swingBy(x,n)` (which renders fine) has a
  //    comma so it is left untouched.
  out = out.replace(/\.swingBy\(\s*[^(),]+?\s*\)/g, `.swing(${SWING_DEFAULT})`);

  // 2) bare `.swing()` → `.swing(4)` — the no-arg form is unreliable; the supported form takes
  //    a subdivision. `.swing(n)` (already has an arg) is left untouched.
  out = out.replace(/\.swing\(\s*\)/g, `.swing(${SWING_DEFAULT})`);

  // 3) drop `.lpenv( … )` — simple numeric args, no nested call (defensive).
  out = out.replace(/\.lpenv\([^()]*\)/g, "");

  // 4) drop `.sometimes( … )` whole, including an arrow body's nested parens (defensive).
  out = stripBalancedMethodCalls(out, "sometimes");

  return out;
}

export default sanitizeStrudel;
