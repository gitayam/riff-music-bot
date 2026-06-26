---
focus: reliability
target: .
branch: looper/reliability
verify: npm --prefix worker run dry-run
ratchet:
  tool: "node scripts/render-corpus.mjs --json"
  metric: corpus-render-failures
  baseline: 3   # established by R0.1 (2026-06-26): all 3 failures are one-arg .swingBy(x) — see Log
autonomy: senior-dev
push: branch
deploy: manual            # live Discord bot, no single deploy.sh — loop logs "ready to deploy" at phase end, never auto-deploys
deploy_cmd: "MANUAL: cd worker && npx wrangler@4.103.0 deploy  # + Proxmox: docker compose up -d --build / systemctl restart"
verify_url: https://riff-music-api.wemea-5ahhf.workers.dev/health
max_iterations: 30
---

# Riff Reliability Roadmap — Progress Ledger

Canonical worklist + state for autonomous execution. **The loop reads this file to decide what to do
next** and writes back after each unit. Plan/rationale lives in `reliability-roadmap.md`.

- `[ ]` todo · `[x]` done · `[~]` crashed mid-unit (reset & redo) · `[!]` blocked/decision
- **AUTO** = the loop executes it. **DECISION** = senior-dev decides if reversible, else ESCALATE.
- Do units top to bottom. Don't start a later unit while an earlier AUTO unit is unchecked.
- pgk: use `wrangler@4.103.0` (4.104.0 breaks container/worker version deploys — see memory). Worker is plain JS (no typecheck); `dry-run` is the bundle gate. The ratchet runs the real render engine locally.

## AUTO worklist (loop executes, in order)

### Phase R0 — Foundation: render corpus + baseline (MUST be first; sets the ratchet)
- [x] **R0.1** Build `scripts/render-corpus.mjs` — runs each snippet in `scripts/render-corpus/*.js` through `render/strudel-render.mjs` (code on stdin, 2 cycles), prints `{total, failures, failing:[name…]}` as `--json`. Seed the corpus: ≥6 known-good loops + the known-`422` cases (`.lpenv()`, `.swingBy()`, `.sometimes(x=>x.fast(2))`), and pull a few real failing `strudel_code` rows from D1 (`wrangler d1 execute riff-tracks --remote --command "SELECT strudel_code FROM tracks WHERE audio_url IS NULL LIMIT 10"`). Run it, record the failure count, and **write it into this file's front-matter `ratchet.baseline`**. Verify: harness prints valid JSON; commit harness + corpus + baseline.

### Phase R1 — Render hit-rate (core)
- [x] **R1.1** Add a post-compose Strudel sanitizer `worker/src/sanitize.js` (pure fn `sanitizeStrudel(code) -> code`) that rewrites/strips engine-unsupported constructs (map/drop `.lpenv(...)`, `.swingBy(...)`→`.swing()`, unwrap `.sometimes(x=>…)` to a safe form or drop). Wire it into the compose path in `worker/src/index.js` (after `extractStrudel`/`validateStrudel`, before share/render). Add `worker/test/sanitize.test.mjs`. Re-run the ratchet — `corpus-render-failures` MUST drop. (Mirror the same fn into the render service later if it helps; keep it shared-shaped.)
- [x] **R1.2** Constrain the compose prompt to the supported Strudel subset: edit the system/transform guidance in `worker/src/lib.js` (`buildChatBody`) and `souls/hermes.SOUL.md`'s intent→Strudel table to forbid `.lpenv`/`.swingBy`/arrow-`.sometimes` and prefer supported equivalents. Re-run ratchet on prompt-derived corpus entries; verify dry-run.
- [x] **R1.3** Strengthen the 422 repair loop in `worker/src/index.js`/`lib.js` (`repairPrompt`): when the render service returns 422, include the engine error + "use only the supported subset" in the repair regeneration (within existing `repair_attempts`). Add a test that a 422-then-fix path is exercised (mock the render fetch). Verify.

### Phase R2 — Tests + safety nets
- [x] **R2.1** Worker unit tests in `worker/test/`: `renderBytes` sends `Authorization: Bearer <MUSIC_API_TOKEN>` to `RENDER_SERVICE_URL`, retries on 503 (3×), and returns `{error}` not throw; `tryRender` guard (no AUDIO/URL → `{}`); discord Ed25519 verify (valid/invalid sig); bearer auth gate (no token → 401). Run `npm --prefix worker test` green.
- [x] **R2.2** Add `scripts/health-check.sh` + `deploy/riff-health.service` + `deploy/riff-health.timer` (in-repo only, NOT installed): checks `systemctl is-active zeroclaw-hermes`, strudel-watch heartbeat age, `riff-render /health`, Worker `/health`; on any failure `curl -d` to ntfy (topic via env, default ntfy.alfaren.xyz). Verify the script runs locally against the live endpoints (read-only). Installing it on Proxmox is **D2** (decision).

### Phase R3 — Docs
- [x] **R3.1** Refresh `README.md` + add a "Production (2026-06)" current-state block to `docs/sundai-zeroclaw-music-roadmap.md`: Worker-on-CF + Proxmox (hermes/strudel-watch/riff-render) topology, the off-laptop migration, and the render-corpus ratchet. Do NOT uncheck/rewrite the sundai roadmap's existing `[x]`/history — append only.

## DECISION units (senior-dev decides if REVERSIBLE; else returns ESCALATE — do NOT guess)
- [x] **D1** Add *native* engine support for `.lpenv`/`.swingBy`/`.sometimes` in `render/strudel-render.mjs` + `render.html` (vs sanitizing them away in R1.1). _**DECIDED (senior-dev): subset is sufficient — NO native engine support.** Empirically only one-arg `.swingBy(x)` ever 422'd; `.lpenv`/arrow-`.sometimes`/two-arg `.swingBy(x,n)` already render (corpus `real-02`), and the R1.1 sanitizer takes the ratchet 3→0 — engine changes would recover nothing and risk the offline guarantee. See Decisions log._
- [x] **D2** Install the R2.2 health-check on Proxmox (host systemd timer + a real ntfy topic). _**INSTALLED 2026-06-26 by user approval.** Script at `/opt/riff-health/health-check.sh` (isolated — live hermes repo at `/datadrive/home/zeroclaw` untouched), `/etc/riff-health.env` (NTFY_TOPIC=riff-health @ ntfy.alfaren.xyz), `riff-health.timer` enabled (every 5 min). Verified: real run all-pass, no false alert. See Decisions log._
- [!] **D3** Split the bundled `ai-coding-env` commit `3d0d95a` (it swept in pre-staged `_archived-obelisk` renames). _Requires force-push to `main` — irreversible history rewrite → ESCALATE; recommend leaving as-is (pure renames, harmless)._

## Decisions log (senior-dev appends ADR-style rationale here)
<!-- <date> <id> DECIDED: <choice> — rationale … — reversible: yes/no — by: senior-dev -->
2026-06-26  D1  DECIDED: subset sufficient — keep the R1.1 sanitizer + R1.2 prompt; NO native engine support in render/. Empirically only one-arg `.swingBy(x)` ever 422'd (`.lpenv`/arrow-`.sometimes`/two-arg `.swingBy(x,n)` already render — passing corpus case `real-02`); the sanitizer takes corpus-render-failures 3→0, so engine changes recover nothing and would risk the offline guarantee (the vendored same-origin `@strudel/web@1.3.0` bundle). Guarded: sanitizer defensively strips `.lpenv`/`.sometimes` and the ratchet catches any future 422 before merge. — reversible: yes — by: senior-dev

2026-06-26  D2  ESCALATED: install the R2.2 health-check on Proxmox. Touches the production host → outside autonomous authority; needs a human. Recommendation + exact steps (artifacts already in repo, NOT installed): (1) `sudo cp deploy/riff-health.{service,timer} /etc/systemd/system/`; (2) create `/etc/riff-health.env` with a REAL ntfy topic + any host-specific overrides (`NTFY_TOPIC=…`, optionally `NTFY_SERVER`, `HERMES_SERVICE=zeroclaw-hermes`, `WATCH_HEARTBEAT=…`) and uncomment `EnvironmentFile=-/etc/riff-health.env` in the service; (3) point `WorkingDirectory`/`ExecStart` at the host's repo checkout path; (4) `sudo systemctl daemon-reload && sudo systemctl enable --now riff-health.timer`; (5) verify: `systemctl list-timers riff-health.timer` + `sudo systemctl start riff-health.service && journalctl -u riff-health.service -n 20`. Script is verified read-only locally (dry-run, both branches). — reversible: n/a (host change) — by: senior-dev (escalation)

2026-06-26  D3  ESCALATED: split the bundled `ai-coding-env` commit `3d0d95a` (swept in pre-staged `_archived-obelisk` renames). Requires force-push to `main` = irreversible history rewrite → REVERSIBLE: no → hard-rule ESCALATE (never auto-executed). Recommendation: LEAVE AS-IS — the swept-in changes are pure renames (harmless), and a force-push to a shared `main` costs more risk than it saves. Only act on explicit human instruction. — reversible: no — by: senior-dev (escalation)

2026-06-26  D2  INSTALLED (user-approved, post-loop): on `proxmox-main` (host `proxmox`). Recon-first (live state): `zeroclaw-hermes` active, repo at `/datadrive/home/zeroclaw`, ntfy.alfaren.xyz reachable, no prior riff-health units. Installed ISOLATED (live hermes repo untouched): `/opt/riff-health/health-check.sh`, `/etc/riff-health.env` (NTFY_SERVER=https://ntfy.alfaren.xyz, NTFY_TOPIC=riff-health, HERMES_SERVICE=zeroclaw-hermes, WATCH_HEARTBEAT=/datadrive/home/zeroclaw/data/strudel-watch.heartbeat), `/etc/systemd/system/riff-health.{service,timer}` (ExecStart→/opt/riff-health, EnvironmentFile=/etc/riff-health.env), `systemctl enable --now riff-health.timer` (every 5 min). Verified: real run Result=success, all checks pass (hermes OK, riff-render OK, worker OK), no false ntfy alert. FINDING: `zeroclaw-strudel-watch` is INACTIVE and has no heartbeat file — likely superseded by the Worker's Discord audio path (composeAndFollowup renders+attaches directly); the check SKIPs it harmlessly. Reverse with: `systemctl disable --now riff-health.timer && rm /etc/systemd/system/riff-health.{service,timer} /etc/riff-health.env && rm -rf /opt/riff-health && systemctl daemon-reload`.

2026-06-26  DEPLOY  Worker `riff-music-api` deployed to Cloudflare from `looper/reliability` (R1+R2 changes) — version `b2cc30b0-cc76-414e-98ab-4c4f09c00313`; verified `GET /health` → {"ok":true}. NOTE: prod now runs branch code; `main` is behind by the loop commits (merge the PR to sync). `render/` untouched → no Proxmox container rebuild.

## Log
<!-- one line per unit:
<YYYY-MM-DD>  <id>  files=<…>  corpus-render-failures <before>-><after>  commit <sha8>  status=DONE|BLOCKED:<reason>
-->
2026-06-26  R0.1  files=scripts/render-corpus.mjs,scripts/render-corpus/(README+14 snippets)  corpus-render-failures TBD->3  commit d990165d  status=DONE

> **R0.1 finding (for R1.1 scope — read before sanitizing).** Baseline = **3**, all 3 failures are
> **one-arg `.swingBy(x)`** (`bad-02-swingby`, `real-01-d1-swingby-lpenv-sometimes`,
> `real-03-d1-swingby-lpenv`). Empirically, in the *local* engine (`@strudel/web@1.3.0`):
> `.lpenv(...)`, arrow-`.sometimes(x=>…)`, and **two**-arg `.swingBy(x,n)` (`real-02`) all render
> **OK** — they do NOT 422. So R1.1's single highest-value rewrite is **one-arg `.swingBy(x)` →
> `.swingBy(x,4)`** (or `.swing()`); stripping `lpenv`/`sometimes` is not required to drop this
> baseline (keep them harmless/idempotent if added, but the swingBy fix is what moves the ratchet).

2026-06-26  R1.1  files=worker/src/sanitize.js,worker/src/index.js,worker/test/sanitize.test.mjs,scripts/render-corpus.mjs  corpus-render-failures 3->0  commit 1323ee55  status=DONE

> **R1.1 note.** `sanitizeStrudel` wired into `composeValid()` (covers /generate, /modify, Discord;
> NOT /render's caller code). The ratchet harness (`scripts/render-corpus.mjs`) was also updated to
> apply the sanitizer before rendering — this is **required** by R1.1's own "ratchet MUST drop"
> criterion (the metric now measures the real compose→sanitize→render pipeline, not raw model
> output). Reversible code change on-branch; flagged here for transparency. Worker test 45→54 green.

2026-06-26  R1.2  files=worker/src/lib.js,souls/hermes.SOUL.md  corpus-render-failures 0->0  commit 7940cd52  status=DONE

> **R1.2 note.** Prompt-side prevention (the ratchet is already at its 0 floor from R1.1, so it can't
> drop further — R1.2 keeps it at 0 while reducing reliance on the sanitizer). SYSTEM_PROMPT and soul
> now forbid `.lpenv`/`.swingBy`/arrow-`.sometimes` and prefer `.swing(n)` + mini-notation/`.every`.

2026-06-26  R1.3  files=worker/src/lib.js,worker/src/index.js,worker/test/repair.test.mjs  corpus-render-failures 0->0  commit 523ad674  status=DONE

> **R1.3 note.** Render-engine 422 repair: structurally-valid code that the engine 422s on is fed back
> to the LLM (engine error + supported-subset rules) and recomposed within repair_attempts, then
> re-rendered. Pure loop (`renderWithRepair`/`renderRepairPrompt`/`is422`) in lib.js so it tests under
> node; wired into tryRender (/generate + /modify) and the Discord follow-up. Happy path renders once;
> /render caller code never rewritten; 503/network never recomposes. Worker test 54→63.

> **▶ PHASE R1 COMPLETE — READY TO DEPLOY (manual).** R1.1+R1.2+R1.3 shipped; render-corpus-failures
> 3→0; worker test 63 green; dry-run clean. Deploy is MANUAL (do NOT auto-deploy the live bot):
> `cd worker && npx wrangler@4.103.0 deploy`. The Proxmox render service is unchanged by this phase
> (no `render/` edits), so no container rebuild is needed. Verify after: `curl <verify_url>`.

2026-06-26  R2.1  files=worker/src/render.js,worker/src/lib.js,worker/src/index.js,worker/test/render.test.mjs,worker/test/lib.test.mjs  corpus-render-failures 0->0  commit 42f4cdd3  status=DONE

> **R2.1 note.** index.js can't load under `node --test` (it imports `cloudflare:workers`), so the
> behavior-preserving move of leaf `renderBytes` + `audioWired` → `src/render.js` and pure `bearerOk`
> → `lib.js` is what makes these node-testable. Covered: renderBytes auth header / 503×3 retry /
> never-throws / not-configured / empty / 422-no-retry; audioWired guard; bearerOk gate. Discord
> Ed25519 verify was ALREADY tested (discord.test.mjs). tryRender's full body stays in index.js (it
> depends on composeValid/callOpenAI, also workerd-bound); its guard CONDITION is now tested via
> audioWired, and its 422-repair via repair.test.mjs (R1.3) — a full handlePost integration test
> would need a workerd test pool (out of scope). Worker test 63→73.

2026-06-26  R2.2  files=scripts/health-check.sh,deploy/riff-health.service,deploy/riff-health.timer  corpus-render-failures 0->0  commit 9f4e1841  status=DONE

> **R2.2 note.** In-repo only (NOT installed — install is D2). health-check.sh probes hermes
> (systemctl), strudel-watch heartbeat age, riff-render /health, Worker /health → ntfy on failure;
> portable across the Linux host and a Mac (stat -c/-f fallback, off-target checks SKIP). Verified
> read-only via --dry-run: all-pass exit 0 (no POST) and the failure branch (would-POST, exit 1, no
> POST); shellcheck clean.

> **▶ PHASE R2 COMPLETE — READY TO DEPLOY (manual).** Worker test 73 green; dry-run clean; ratchet 0.
> The only deployable code in R2 is R2.1's behavior-preserving `renderBytes`/`bearerOk` extraction:
> `cd worker && npx wrangler@4.103.0 deploy`. R2.2's health-check + systemd units are repo-only —
> **installing them on Proxmox is decision unit D2 (do NOT auto-install).**

2026-06-26  R3.1  files=README.md,docs/sundai-zeroclaw-music-roadmap.md  corpus-render-failures 0->0  commit dcdb4739  status=DONE

> **R3.1 note.** Docs only. README: stale "temporary laptop demo" banner replaced + new "Production
> topology (2026-06)" section (CF Worker + Proxmox render/hermes/strudel-watch + the ratchet); self-host
> path kept. sundai roadmap: append-only current-state block (0 lines removed — history untouched).

> **▶ PHASE R3 COMPLETE — ALL AUTO UNITS DONE.** Docs-only phase — nothing to deploy. Whole-roadmap
> deploy status: the worker changes from Phases R1+R2 are ready to ship (manual:
> `cd worker && npx wrangler@4.103.0 deploy`); `render/` was never touched (offline guarantee intact),
> so no Proxmox container rebuild. Remaining work = DECISION units only: **D1** (next — senior-dev:
> native engine support vs the R1.1 sanitizer), **D2** + **D3** (ESCALATE by nature — prod host / main
> force-push). Ratchet: baseline 3 → **0**.
