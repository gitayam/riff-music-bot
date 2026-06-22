# Strudel × ZeroClaw — Lessons Learned

Field-tested notes from getting **Riff** (the ZeroClaw music bot) to emit Strudel
that actually *plays*. Concrete, evidence-based, and dated. Companion to
`sundai-zeroclaw-music-roadmap.md` (plan) and `music-theory-for-zeroclaw.md` (theory).

> **Source of truth for the Strudel API:** Strudel moved GitHub → **Codeberg `uzu/strudel`**
> (`packages/core/pattern.mjs`) + <https://strudel.cc/learn/>. Verify function signatures there,
> NOT from an LLM's pre-trained memory — that's where the hallucinations come from.

---

## 1. The model is the real root cause of invalid output (2026-06-21)

The recurring "the bot's code doesn't play" was **not** primarily a prompt problem — it was a
*model-capability* problem.

- **Mistral-large** is musically literate through the SOUL but emits **invalid Strudel**:
  hallucinated functions, `[...]`-array wraps, and **hand-fabricated base64 links that don't even
  match the shown code**. A weak model cannot be trusted to emit valid code *or* encode base64.
- **GPT-5.4** (switched 2026-06-21) follows the SOUL contract, emits valid + creative Strudel
  (modes, builds via `cat`, filter sweeps, `.off()`), **and** base64-encodes byte-for-byte exact —
  *measured* on 132-char and 666-char patterns. This single swap fixed the bulk of "doesn't play."

**Lesson:** for a code-emitting agent, model capability > prompt babysitting. Don't pour effort
into "keep it tiny / template-only" guardrails to compensate for a model that simply can't —
upgrade the model, then *unlock* creativity within a hard validity contract.

## 2. Strudel function cheat-sheet — banned hallucinations → the real thing

Every one of these was emitted by the bot and broke playback. Replacement verified against
`uzu/strudel` + strudel.cc/learn.

| ❌ Wrong (hallucination) | ✅ Correct | Why |
|---|---|---|
| `.saturate("bass")` | `.distort(amt)` | **no `saturate` function exists**; distortion is `distort(distortion, volume?, type?)` |
| `.reverb()` | `.room(0..1)` | reverb is `.room` |
| `.swingBy(1/3)` | `.swing(n)` *or* `.swingBy(amount, subdivision)` | **`swingBy` needs TWO args** → `Error: .swingBy() expects 2 inputs but got 1`. `.swing(4)` ≡ `.swingBy(1/3, 4)` (pattern.mjs) |
| `sound("*hx")` | `sound("hh*2")` | leading `*` = **parse error** (`but "*" found`): `*` is the speed-up op and must *follow* a value |
| `[setcpm(...), stack(...)]` | `setcpm(...)` ⏎ `stack(...)` | `[ ]` makes a **JS array, not a pattern** — see §3 |
| `.scale("G:mxidyd")` | `.scale("G:mixolydian")` | scale format is `root:fullname` (full mode spelling) |
| `note("0 2 4").scale(...)` | `n("0 2 4").scale(...)` | **scale degrees use `n()`**, not `note()` (`note` is for pitch names like `c3`) |
| `.ren()` · `.base()` · `.gtrain()` · `.lpenv()` · `sound("newpiano")` | — | not real / invented names |
| `.voicings()` | spell chords as `note("c3 e3 g3")` | **build-dependent** — may not exist in the live build; the theory doc's chord recipes lean on it, so don't rely on it in shipped patterns |

**Both fine:** `.rev` and `.rev()`.
**Verified-valid verbs used in practice:** `setcpm` `stack` `cat` `sound` `note` `n` `.scale`
`.bank("RolandTR909"/"808"/"707")` `.gain` `.pan` `.lpf` `.hpf` `.room` `.delay` `.crush`
`.distort` `.fast` `.slow` `.rev` `.euclid(k,n)` `.struct` `.swing(n)` `.every(n, fn)`
`.off(t, fn)` `.add` `sine/saw/tri/rand .range(lo,hi).slow(n)`.

## 3. The `[...]` array trap — the #1 *silent* non-play

The top level of a Strudel program must be statements:
```javascript
setcpm(65/4)
stack( … )
```
Wrapping the whole thing in brackets — `[setcpm(65/4), stack(…)]` — is valid *JavaScript* (an
array) but not a Strudel pattern: the REPL reifies the array into a broken 2-step sequence (with
`setcpm`'s return value as a "note") → silent or garbage. No syntax error, so it's easy to miss.
The SOUL now hard-bans it.

## 4. Mini-notation gotchas

- `*n` speed-up **must follow a value**: `bd*4` ✓, `*hx` ✗ (parse error).
- `~` rest · `[a b]` squeeze-into-one-step · `<a b c>` one-per-cycle · `bd(3,8)` euclid.
- Sample/drum names are real tokens (`bd sd hh oh cp rim …`) — invented names (`hx`, `newpiano`) silently fail.

## 5. The strudel.cc share link (`#<base64>`)

strudel.cc encodes the pattern as **base64 of the literal code** in the URL hash. To debug a link:
```bash
echo '<base64-after-#>' | base64 -d     # must decode to the exact code you expect
```
- Weak models hand-fabricate base64 → the link decodes to something *different from* (or more
  broken than) the shown code. Classic Mistral failure.
- **GPT-5.4 encodes exactly**, so the SOUL now has Riff emit `▶ Play: https://strudel.cc/#<base64>`
  itself + the code block as the byte-for-byte fallback. Works on **Discord and SimpleX** with no
  post-processor. *Caveat:* in-context, GPT-5.4 was initially over-cautious and used the "paste the
  code" fallback — the SOUL had to explicitly assert "you CAN encode this; always include the link."
- **Deterministic alternatives** (no LLM base64): `scripts/strudel-link.sh` (file/stdin → link),
  the SimpleX bridge can post-process the reply, and `scripts/strudel-watch.py` polls Discord for the
  bot's own ` ```javascript ` replies to deliver rendered audio.

## 6. ZeroClaw runtime constraints (why the "obvious" link fix doesn't work)

- **No outbound-message hook.** zeroclaw posts model text verbatim; only *tool-call* hooks exist
  (`command_logger`, `webhook_audit`). You cannot transform a Discord reply in-process — hence the
  LLM-emits-the-link approach, or an external watcher (`strudel-watch.py`).
- **The agent can't run the link script.** `[risk_profiles.default] allowed_commands = ["ls","git","cat"]`
  (no `bash`/`base64`); `shell` is **OTP-gated + medium-risk-approval** (no approver in a daemon turn);
  the script lives *outside* the agent workspace (`workspace_only` + sandbox-exec). So "let the agent
  run `strudel-link.sh`" is a non-starter without a security regression on a public channel.
- **Deny-by-default allowlist.** A connected bot **ignores every user** until a peer group admits
  them — symptom: `"ignoring message from unauthorized user"` in `data/state/runtime-trace.jsonl`.
  Allow everyone with:
  ```toml
  [peer_groups.discord_public]
  channel = "discord.default"
  agents = ["hermes"]
  external_peers = ["*"]    # "*" = anyone; empty list = nobody
  ```
- **Config reloads on restart only.** After editing `config.toml` or a SOUL:
  `launchctl kickstart -k gui/$(id -u)/com.zeroclaw.hermes`.
- **Secrets:** never inline in `config.toml`. `run.sh` injects them from the gitignored `.env` via
  `ZEROCLAW_<dotted__path>__api_key` env overrides (a required field like Discord `bot_token` needs a
  harmless placeholder in the file so the table validates).

## 7. Two guards: the heuristic lint vs. the real parse gate

- `scripts/strudel-lint.sh` is **function-name-only** — a fast front-line check. It CANNOT catch
  the failures that actually bite: wrong arity (`.swingBy(1/3)`), the `[...]` wrap, bad scale
  strings (`G:mxidyd`), or a mismatched base64 link.
- **The authoritative gate exists — and renders audio.** Two renderers, both of which parse the
  code (invalid → non-zero exit, so each doubles as the parse gate):
  - **Option A (engine of record): faithful render** — `zeroclaw/render/strudel-render.mjs`, headless
    **Chromium (Playwright)** loading `@strudel/web` → `renderPatternAudio()` via `OfflineAudioContext`.
    Produces the *real* strudel.cc audio (true 909/808/dirt samples, real `piano`/`.room()`). Chosen
    because the demo's value is "real music, not a black box."
  - **Option B: pure-node synth render** — `scripts/render/render.mjs`, `@strudel/{core,mini,transpiler,tonal}`
    + `node-web-audio-api`. No browser; synthesized approximation. `scripts/strudel-deliver.sh` chains
    lint → render(gate) → ffmpeg.
  - **Version-pin gotcha (they DIFFER per stack):** Option A's web build needs **`@strudel/web@1.3.0`**
    (it's the version that exports `renderPatternAudio`; 1.2.0 doesn't). Option B's node stack needs
    **`@strudel/* == 1.1.0`** exactly — 1.2.x imports `SalatRepl` from `@kabelsalat/web` and won't load
    in node. Default prebake loads **synths only** — drums are silent until `samples(...)` (Option A
    vendors `tidal-drum-machines.json`/`piano.json` with `_base` re-pointed at CORS-enabled github raw,
    since the drum-machine repo moved `ritchse`→`geikha` and strudel.cc's map has no CORS).

Defense in depth: SOUL allowlist + a capable model (GPT-5.4) keep most failures from being emitted;
the lint is the cheap catch; `render.mjs` is the truth.

## 8. The verification loop (use it on every change)

1. Generate. 2. Extract the ` ```javascript ` block. 3. `bash scripts/strudel-lint.sh file.js`.
4. `bash scripts/strudel-link.sh file.js` → open the link. 5. Confirm it *makes sound*.
For the live bot: `launchctl kickstart -k …`, then a one-shot `./run.sh agent -a hermes -m "…"` and
check `data/state/runtime-trace.jsonl` (`llm_request` → model, `inbound`/reply, no `unauthorized`).
