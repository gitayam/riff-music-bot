# Riff Reliability Roadmap

> **Goal:** make rendered audio land on (almost) every `/riff` and `/generate render:true` — close the best-effort `422` gap — and put safety nets (tests, monitoring) under the now-live production stack.
> **Created:** 2026-06-26 · **Focus:** reliability · **Status:** proposed
> **Companion:** docs/reliability-roadmap-progress.md (the loop's worklist)

## TL;DR — current state (verified 2026-06-26)
Production is **live and green** — the build is done; this roadmap is about *reliability of what shipped*.

| Thing | State | Evidence |
|---|---|---|
| Worker `riff-music-api` | live on Cloudflare | `GET /health` 200; deploy `v0.3.1` |
| Render service | self-hosted Proxmox, tunnel-exposed, bearer-gated | `riff-render` container `running`; `container/server.mjs:91` auth gate |
| hermes (Discord @mention agent) | live | `systemctl is-active zeroclaw-hermes` → active since 2026-06-24 |
| strudel-watch (voice messages) | live, delivering | heartbeat ~15s; voice msg `1519407700310491257` posted |
| Service errors (30-min scan) | **none** | hermes/strudel-watch/riff-render logs clean |
| **Render hit-rate** | **best-effort, not measured** | gpt-5.4 sometimes emits Strudel the offline engine `422`s (`.lpenv()`, `.swingBy()`, `.sometimes(x=>…)`) → degrades to code+link |

The one real reliability gap: **render hit-rate is unmeasured and < 100%.** Everything else is sound.

## How to use this roadmap
1. The ratchet that gates every change: **`node scripts/render-corpus.mjs --json`** → `corpus-render-failures` must never increase (and must *drop* on remediation units). Baseline is set by unit **R0.1**.
2. Verify gate (must pass before any commit): **`npm --prefix worker run dry-run`** (Worker bundles/validates); `npm --prefix worker test` at phase boundaries.
3. Work unit-by-unit via the ledger. **R0.1 is the foundation — it builds the corpus + harness and establishes the baseline; do it first, don't reorder.**

## North star / guiding principle
Audio is **best-effort by contract** — a user always gets code + a play link. The win is raising the *rate* at which they also get audio, **without** changing the public payload shape, the auth model, or the engine's offline guarantee. The loop must NOT decide on its own: whether to add new render-engine *features* (vs restrict to the supported subset), anything touching the live Proxmox host, or any git history rewrite — those are DECISION units.

## Phases
| # | Item | Fix | Skill / command | Impact | Effort | Evidence |
|---|---|---|---|---|---|---|
| R0.1 | No render metric | Build corpus + harness, set baseline | node test | unblocks all | M | this doc |
| R1.1 | gpt-5.4 emits unsupported fns | Post-compose sanitizer | `worker/src/` | high | M | `container/server.mjs:70` 422 path |
| R1.2 | Prompt allows bad fns | Constrain compose prompt/soul | `worker/src/lib.js`, `souls/hermes.SOUL.md` | high | S | — |
| R1.3 | Weak repair on 422 | Feed render error back to gpt-5.4 | `worker/src/` (`repairPrompt`) | med | S | `index.js` repair_attempts |
| R2.1 | No Worker tests | Unit tests: renderBytes auth/503-retry, discord verify, auth gate | `worker/test/` | med | M | `worker/src/index.js:123` |
| R2.2 | No prod monitoring | Health-check script + systemd timer (repo only) → ntfy | `scripts/`, `deploy/` | med | M | ntfy.alfaren.xyz exists |
| R3.1 | Docs stale | README + roadmap reflect prod topology + ratchet | docs | low | S | this migration |

## Success metrics
- [ ] `corpus-render-failures` : `<R0.1-baseline>` → **0** (or lowest achievable; documented residual)  ← completion target
- [ ] `npm --prefix worker run dry-run` clean; `npm --prefix worker test` green
- [ ] every render-path change keeps the offline guarantee (no new external fetch in `render/`)

## Execution notes
- The ratchet (`render-corpus.mjs`) runs the real engine (`render/strudel-render.mjs`) locally on the Mac — Chromium + `render/node_modules` are already present. Deterministic: same snippet → same pass/fail.
- Prefer the **shared layer**: a sanitizer/validator the compose path *and* the render service can share beats per-call patches.
- Never change the public response shape or the auth model in an AUTO unit. Never auto-deploy to the live bot.
