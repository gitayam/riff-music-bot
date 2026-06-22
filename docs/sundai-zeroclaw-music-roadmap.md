# Sundai Hack 128 — ZeroClaw Music Orchestrator — Roadmap

> 📦 **Repo (commit here):** <https://github.com/gitayam/riff-music-bot> — the standalone
> repo IS the source of truth now. Work in `zeroclaw/` and push to that remote; the copy
> in the `llms-local` monorepo is a historical mirror.

**Event:** Sundai Hack 128 · Coding Harnesses with ZeroClaw · Sun Jun 21, 10:00–22:00
**Ship gate:** working web demo on the internet by **final presentation, 20:00**.
**Ethos (Sundai):** *Build. Ship. Shortcuts.* Go for less, to do more. Get off localhost.

---

## TL;DR — what we ship today

> A community (Discord / dashboard chat) asks for music in plain language.
> **ZeroClaw orchestrates sub-agents** to turn that request into:
> 1. a **playable audio file** posted back in the chat, and
> 2. the **Strudel code** that generated it (inspectable, shareable, editable),
> and it can **iteratively modify** the music on follow-up ("faster", "add a bassline",
> "darker", "make 3 variations") by editing the code, not re-rolling a black box.

Two generation engines, deliberately complementary:

| Engine | What it gives us | Strength |
|---|---|---|
| **Strudel** (live-coding, browser/Web-Audio) | *code* → loopable pattern | Deterministic, diffable, editable, instant share-link, explains itself, royalty-free |
| **Stable Audio 3** (Modal endpoint) | neural text→audio / audio→audio | Produced, realistic texture; great for "make it sound real" |

The wow combo: **Strudel writes the controllable skeleton → Stable Audio renders the flesh** (feed a Strudel render as the `init` audio into Stable Audio's audio-to-audio with `init_noise_level`).

---

## Architecture (whiteboard → ZeroClaw primitives)

```
   Community                                   ┌─────────────── ZeroClaw (manager / "hermes") ──────────────┐
 ┌───────────┐   POST /webhook                 │  Gateway @ 127.0.0.1:42617                                 │
 │  Discord  │──┐  WS /ws/chat                  │   /webhook  /ws/chat  /api/*  /health  /metrics  dashboard │
 └───────────┘  │                              │                                                            │
 ┌───────────┐  ├──────────►  orchestrator ────┤  routes request → spawns sub-agents → composes → renders   │
 │ Frontend  │──┘ (chat,     (the agent loop)   │                                                            │
 │ Dashboard │◄──── prompt)                     │   sub-agents (zeroclaw `agents`):                          │
 │  - chat   │                                  │     SA1  make prompts / extract MusicSpec                  │
 │  - audio  │◄──── audio file + code + link    │     SA2  find / inject reference audio                     │
 │  - A→A    │                                  │     SA3  inspiration (audio analysis) + music theory       │
 │  - T→A    │                                  │                                                            │
 └─────┬─────┘                                  │   skills (zeroclaw `skills`):                              │
       │                                        │     • music-theory   (scales, modes, chords, tempo maps)   │
       │ store/fetch                            │     • strudel        (genre templates + transform verbs)   │
       ▼                                        │   cron: trending-music pull, scheduled jingles             │
 ┌──────────────┐    embeddings / metadata      └───────────────┬───────────────────────────┬───────────────┘
 │  Supabase    │◄───────────────────────────────────────────── │                           │
 │  - storage   │   audio files                                  ▼                           ▼
 │  - tracks tbl│                                       ┌──────────────────┐       ┌────────────────────┐
 │  - pgvector  │                                       │ Strudel renderer │       │ Modal Stable Audio │
 └──────────────┘                                       │ (headless / link)│       │  text→/audio→audio │
                                                         └──────────────────┘       └────────────────────┘
```

**Mapping to real ZeroClaw mechanisms** (verified against the local install in `zeroclaw/`):

| Whiteboard node | ZeroClaw primitive | How |
|---|---|---|
| Frontend ↔ ZeroClaw | **Gateway** | `./run.sh daemon` exposes `POST /webhook`, `GET /ws/chat`, `/api/*` on `127.0.0.1:42617` |
| ZeroClaw (manager) | **agent** (`hermes`) | orchestrator loop; `parallel_tools = true` already set |
| SA1 / SA2 / SA3 | **agent aliases** | `zeroclaw agents create sa-spec` etc. (own model/risk/runtime profile) |
| music theory (skill) / Strudel | **skills** | `zeroclaw skills add music-theory`, `… add strudel` (SKILL.md + TEST.sh) |
| Discord community | **channel** | `channels.discord.default` (already wired; needs MESSAGE CONTENT intent + invite) |
| trending music / scheduled jingles | **cron** | `zeroclaw cron add '0 14 * * *' 'pull trending' --agent` |
| Audio storage | **Supabase storage** | bucket `tracks/`; signed URLs back to chat |

---

## Team split & interface contracts

Three workstreams, parallelizable because the **contracts between them are fixed first**. Lock these JSON shapes early so nobody blocks anyone.

| Owner | Component | Builds |
|---|---|---|
| **Frontend / Supabase** | Dashboard + persistence | Chat UI, audio player, A→A / T→A controls, Supabase schema + storage, calls ZeroClaw gateway |
| **Modal** | Stable Audio 3 service | text→audio + audio→audio endpoints (already live), tuned prompts/params |
| **You** | **ZeroClaw orchestration + Strudel** | The agent loop, sub-agents, music-theory + strudel skills, Strudel render, the modify loop |

### Contract 1 — Frontend → ZeroClaw (request)
```jsonc
POST http://127.0.0.1:42617/webhook
{ "message": "make a funky disco loop, 120bpm",
  "session_id": "discord:user:1234",   // stable per conversation → enables "modify" state
  "community_id": "sundai" }
```

### Contract 2 — ZeroClaw → Frontend (response) — the canonical payload
```jsonc
{ "text": "Here's a 120bpm funky disco loop in C minor — four-on-the-floor 909, off-beat hats, a saw bassline with a filter envelope.",
  "strudel_code": "stack(\n  sound(\"bd*4\")...\n)",
  "share_url": "https://strudel.cc/#<base64-of-code>",  // one-click play, MVP fallback if WAV not ready
  "audio_url": "https://<supabase>/storage/v1/object/public/tracks/<id>.wav", // null until render lands
  "spec": { "...": "MusicSpec, see below" },
  "version": 3,            // increments on each modify
  "parent_id": "<prev track id or null>" }
```

### Contract 3 — MusicSpec (the shared internal representation)
```jsonc
{ "genre": "disco-funk", "bpm": 120, "key": "C", "scale": "minor",
  "mood": "energetic", "energy": 0.8, "valence": 0.6,
  "duration_s": 15, "loop": true,
  "instrumentation": ["909-kit", "saw-bass", "rhodes"],
  "structure": "loop" }       // or "intro|build|drop", "stinger", etc.
```

### Contract 4 — ZeroClaw → Modal (Stable Audio 3)
```bash
# text → audio
curl -X POST https://reverb-paste--stable-audio-3-server-stableaudio3-text-to-audio.modal.run/ \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"upbeat funky disco bassline with groovy guitar, 120 bpm","duration":15}' \
  --output out.wav

# audio → audio  (feed a Strudel render as the seed — the "skeleton → flesh" combo)
curl -X POST https://reverb-paste--stable-audio-3-server-stableaudio3-audio-to-audio.modal.run/ \
  -H 'Content-Type: application/json' \
  -d "{\"audio_base64\":\"$(base64 -i strudel_render.wav)\",\"prompt\":\"... 120 bpm\",\"duration\":15,\"init_noise_level\":0.9}" \
  --output produced.wav
```

### Contract 5 — Supabase schema
```sql
-- bucket: tracks  (public read or signed URLs)
create table tracks (
  id           uuid primary key default gen_random_uuid(),
  community_id text,
  session_id   text,
  prompt       text,
  spec         jsonb,
  strudel_code text,
  share_url    text,
  audio_url    text,
  parent_id    uuid references tracks(id),   -- modify-chain / version history
  version      int  default 1,
  embedding    vector(1536),                  -- pgvector: similarity + "trending"
  created_at   timestamptz default now()
);
```

---

## DEEP DIVE — ZeroClaw × Strudel (your part)

Reference: <https://strudel.cc/workshop/first-sounds/>. Strudel is a JS port of TidalCycles — patterns are mini-notation strings evaluated to Web-Audio. **Why it's the right tool for an agent:** the output is *code*, so the agent can (a) explain its musical choices, (b) make surgical edits on request, and (c) hand the user a tiny shareable string that plays instantly.

### The agent loop
```
intake → extract spec (SA1 + music-theory) → compose Strudel (strudel skill)
       → validate (parse/dry-eval, retry K=2) → render (WAV + share-link)
       → persist (Supabase: file + row + embedding) → respond (audio + code + link + 1-line why)
       → [on follow-up] load state → apply transform → re-validate → re-render → respond with code DIFF
```

### The hard problem: Strudel → audio *file*, headlessly
Strudel plays in a browser; we need a file to post in chat. Three tiers — **ship A first**:

- **A. MVP — share-link, no render.** Encode the pattern into a `https://strudel.cc/#<base64>` deep link. It plays in one click in the demo; `audio_url` stays null. Satisfies "pass it in the chat" today with zero render infra. *(Verify the exact hash scheme against current strudel.cc before relying on it.)*
- **B. Real — headless render to WAV.** Puppeteer/Playwright headless Chromium loads a minimal page importing `@strudel/web`, evaluates the pattern, captures output via `MediaRecorder` (needs `--autoplay-policy=no-user-gesture-required`), OR renders offline via `OfflineAudioContext` → encode WAV. Upload to Supabase, fill `audio_url`. **Wrap in timeout + K=2 retry** — headless audio capture is flaky (see reliability notes).
- **C. Stretch — Strudel skeleton → Stable Audio flesh.** Take the B render, base64 it into Modal's audio-to-audio with `init_noise_level ~0.85–0.95`. Strudel controls structure/key/tempo; Stable Audio gives it produced texture. This is the demo money-shot.

### Community request situations — the matrix (you asked to think hard here)

| # | Situation | Example ask | How ZeroClaw + Strudel handles it |
|---|---|---|---|
| **A** | **Genre / style** | "funky disco, 120bpm" · "lofi for #focus" · "chiptune" · "170bpm dnb" | strudel skill has a genre→template library; fill from spec |
| **B** | **Mood / vibe** (no genre) | "something chill" · "hype us up" · "dark and moody" | music-theory skill maps mood→{tempo, mode, density, filter, reverb}; energy→density+gain, valence→major/minor |
| **C** | **Occasion / event-triggered** | "victory fanfare when a bounty closes" · "we hit 1000 members" · "Friday-call intro" | short stingers; fired by Discord events or `cron` |
| **D** | **Contextual / reactive** | "match the vibe of #general right now" · "remix this" (+file) · "something trending" | SA2/SA3: sentiment/energy from recent messages, or BPM/key detection on an attached file → spec |
| **E** | **Iterative modify** (core) | "faster" · "add a bassline" · "darker" · "swap to a 909 kick" · "30s build with a drop" | load session state → apply a named transform to the code → re-render → return code **diff** |
| **F** | **Multi-part / collaborative** | "drums + bass + a melody, layer them" (whiteboard AF1/AF2/AF3) | fan out sub-agents, **each returns Strudel text only**, orchestrator `stack()`s them (avoids shared-FS clobber) |
| **G** | **Educational / explainable** | "how would you make a house beat?" | the annotated Strudel code *is* the answer — Strudel's transparency shines |
| **H** | **Constraint / spec** | "120bpm, exactly 15s, C minor, must loop seamlessly, royalty-free" | spec validation; Strudel loops by construction; synth-only = royalty-free (watch sample-bank licensing) |

### Modification vocabulary (the differentiator) — NL intent → Strudel transform
| Intent | Transform |
|---|---|
| faster / slower / "120bpm" | `setcpm` / `.fast(n)` / `.slow(n)` |
| add / remove a layer | mutate the `stack(...)` (add a `note(...).sound(...)` / drop a line) |
| brighter / warmer / darker | `.lpf()` / `.hpf()` cutoff; swap `sound()`; mode shift |
| "use a 909 / 808 kick" | `.bank("RolandTR909")` / `.bank("RolandTR808")` |
| darker / change key / add tension | `.scale("C:minor"→"C:phrygian")`; chord substitution |
| more syncopated / swing / halftime | `.struct(...)`, `.swingBy()`, `.euclid(3,8)` |
| build / drop / longer | arrangement via `.cat()` / `.arrange()` / `.every()` |
| more reverb / delay / sidechain | `.room()`, `.delay()`, gain ducking |
| "go back" / "give me 3 variations" | version history (`parent_id`); K=3 fan-out (= AF1/AF2/AF3) |

### Illustrative Strudel (verify exact API against strudel.cc/workshop)
```javascript
// "funky disco loop, 120bpm, C minor"  — the whiteboard's Funky Song
setcpm(120/4)
stack(
  sound("bd*4").bank("RolandTR909").gain(0.9),                 // four-on-the-floor
  sound("~ hh ~ hh").bank("RolandTR909").gain(0.5),            // off-beat hats
  sound("~ cp").bank("RolandTR909").room(0.2),                 // backbeat clap
  note("c2 c2 eb2 g2 c2 bb1 g1 c2").sound("sawtooth")          // funky bass
    .lpf(800).lpenv(4).gain(0.8),
  n("0 2 4 6").scale("C:minor").sound("rhodes").gain(0.4).room(0.3)
)

// MODIFY: "make it darker and add more space"  → diff returned to user:
//   .scale("C:minor")  →  .scale("C:phrygian")
//   + .lpf(800)  →  .lpf(500)
//   + .room(0.3) → .room(0.6)
```

### Reliability (your home turf — apply it)
- **K=2 retry + timeout** on every generation/render call (LLM compose + headless render are stochastic).
- **Validate-before-ship gate** — never return code that doesn't parse; retry on parse failure.
- **Parallel variations return TEXT only** — sub-agents return Strudel snippets; the orchestrator composes. (Parallel agents sharing one filesystem clobber each other — last-write-wins.)
- ZeroClaw runs on Mistral (`mistral-large-latest`); keep compose prompts tight and the `strudel` skill carries the genre templates so the model fills slots rather than inventing grammar.

---

## Timeline — today (anchored to the 20:00 presentation)

> It's mid-afternoon. **Hard gate: end-to-end MVP demoable by ~18:00**, leaving 2h buffer for polish + the inevitable demo gremlin. MVP path first, stretch only if green.

| By | Milestone | Done = |
|---|---|---|
| **Now** | **Lock the 5 contracts** (above) | Frontend/Modal/you agree on the JSON shapes; nobody blocks |
| **+1h** | **Tier-A path live** | NL → ZeroClaw → Strudel code + `share_url` posted to chat; one genre works end-to-end |
| **+1h** | **Supabase persistence** | `tracks` row written; code+spec stored; frontend lists history |
| **+2h** | **Modify loop** | "faster" / "add bass" / "darker" round-trips with a code diff (Situation E) |
| **+3h** | **Tier-B render** | headless → WAV → Supabase → `audio_url` filled; real audio in chat |
| **~18:00** | **MVP FROZEN** | full happy path works on the deployed URL, off localhost |
| **18:00–20:00** | **Stretch + polish** | Tier-C (Strudel→Stable Audio), Situations C/D/F, Discord live, demo rehearsal |
| **20:00** | **Present** | run the demo script below |

---

## Demo script (the most important artifact — rehearse it twice)
1. **Generate:** type *"make a funky disco loop, 120bpm"* → audio plays + code shows + share-link.
2. **Explain:** point at the code — "it told us *why*: four-on-the-floor, off-beat hats, saw bass."
3. **Modify:** *"make it darker and add more space"* → new audio + show the **diff** (this beats every black-box music demo).
4. **Variations:** *"give me 3 versions"* → A/B/C (AF1/AF2/AF3).
5. **Wow:** *"now make it sound real"* → Stable Audio audio-to-audio render (Tier-C).
6. **Persistence:** show the dashboard history pulled from Supabase.

---

## Risks & shortcuts
| Risk | Shortcut / mitigation |
|---|---|
| Headless WAV render is flaky / eats time | **Ship Tier-A share-link first**; render is additive, not blocking |
| strudel.cc hash scheme changed | verify the `#<base64>` deep-link format early; fall back to self-hosting `@strudel/web` |
| Mistral compose invents bad Strudel grammar | `strudel` skill carries genre **templates** → model fills slots; K=2 + validate gate |
| Parallel variation agents clobber files | sub-agents return **text only**; orchestrator composes |
| Modal cold starts / latency | pre-warm before the demo; cache one good render as a backup clip |
| **Leaked `SUPABASE_SECRET_KEY`** (pasted in chat) | **rotate it now**; keep only in gitignored `.env` (mirror the zeroclaw `.env`→env-override pattern); never in a committed file |

---

## Setup & env (secret-safe)

Follow the existing `zeroclaw/` pattern: secrets live in a **gitignored `.env`**, injected at runtime — never in a committed file. Create `.env` (gitignored) with:

```bash
# --- Supabase ---  (URL + publishable key are public-by-design; secret key is NOT)
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_<redacted>
SUPABASE_SECRET_KEY=            # ⚠️ ROTATE the leaked one; paste the new value here only
SUPABASE_JWKS_URL=https://<your-project>.supabase.co/auth/v1/.well-known/jwks.json

# --- Modal (Stable Audio 3) ---
MODAL_TEXT_TO_AUDIO=https://reverb-paste--stable-audio-3-server-stableaudio3-text-to-audio.modal.run/
MODAL_AUDIO_TO_AUDIO=https://reverb-paste--stable-audio-3-server-stableaudio3-audio-to-audio.modal.run/

# --- ZeroClaw (already configured in zeroclaw/.env) ---
MISTRAL_API_KEY=
DISCORD_BOT_TOKEN=
```

Run the orchestrator:
```bash
cd zeroclaw
./run.sh daemon                 # gateway + Discord on http://127.0.0.1:42617 (also syncs the soul)
./run.sh agent -a hermes -m "make a chill lofi loop"   # one-off test
zeroclaw agents create sa-spec  # scaffold sub-agents
zeroclaw skills add strudel     # scaffold the Strudel skill (SKILL.md + templates)
```

**The music brain (already built):**
- **Soul / identity:** `zeroclaw/souls/hermes.SOUL.md` (tracked) → `run.sh` syncs it to `agents/hermes/workspace/SOUL.md` (the OpenClaw identity file ZeroClaw reads). Defines persona "Riff", the 3-part reply contract (sound + code + why), genre defaults, the intent→Strudel transform table, **and a `help` / "what can you do?" capability menu** so the bot is self-describing on Discord/SimpleX. **The agent runs `workspace_only`, so its knowledge must live in the soul, not in repo docs.**
- **Theory reference:** [`docs/music-theory-for-zeroclaw.md`](./music-theory-for-zeroclaw.md) — cited deep-dive (chords/progressions, keys/modes, song anatomy, BPM-by-genre, rhythm, cadences) with per-genre **Strudel recipes**. Source the `strudel` skill's templates from §9.
- **Known gap:** Mistral-large is musically *literate* with the soul but still emits *invalid Strudel syntax* (hallucinated `.base()`/`.gtrain()` etc.). Fix = a `strudel` skill of validated templates the model fills in + the Tier-B validation/render gate. This is the highest-leverage reliability task.

---

## Stretch / post-hack
- **Reactive ambient bot:** `cron` + Discord activity → an evolving "now playing" that tracks channel mood (Situation D).
- **Data sonification:** turn GitHub/commit activity into a beat (pattern density ∝ activity).
- **Vector "more like this":** pgvector similarity over `spec`/`code` embeddings → "remix the vibe of that track from Tuesday."
- **True offline render:** replace headless capture with a proper `OfflineAudioContext` render path for deterministic, faster-than-realtime WAVs.
- **Collaborative jam mode:** multiple members each own a layer; ZeroClaw `stack()`s the live ensemble.

---

## Local render → Discord voice message (bot stays local)

**Goal:** Riff doesn't just hand back code — it renders the tune to audio **on this Mac** and drops it into the Discord channel as a **native voice message** (the inline scrub/play bubble with a waveform), alongside the code + strudel.cc link. No cloud render; the bot keeps running locally.

### Pipeline
```
@mention ─▶ zeroclaw (Riff): generate Strudel ─▶ validate (lint now / node parse next)
                                   │
                 text reply: code + ▶ strudel.cc link (strudel-link.sh)
                                   │
                                   ▼  enqueue {code, channel_id, msg_id}
                        render-worker (local, REST-only, same bot token)
                          1. render Strudel ──▶ WAV
                          2. ffmpeg ──▶ OGG/Opus (mono 48kHz 32kbps)
                          3. compute waveform[≤256] + duration_secs
                          4. Discord REST: upload + post voice message
                                   ▼
                        🎙️ voice message appears in the channel
```
Decoupled on purpose: generation (zeroclaw gateway) and render+post (REST-only worker) are separate so we don't depend on Mistral reliably tool-calling, and so two processes can share one bot token — only *gateway* connections are limited per token; REST calls are not.

### Step 1 — render Strudel → audio (locally). Both A and B are now BUILT.

> ## 🔀 ENGINE DECISION (Jun 21, user-confirmed): ship **A — the faithful browser render**.
> Two parallel sessions independently built **both** options. **A** (`zeroclaw/render/`, this
> session) renders the *real* strudel.cc audio — true 909/dirt samples, real `piano`, real
> `.room()`/`.delay()`/`.lpf`. **B** (`zeroclaw/scripts/render/render.mjs`, the other session)
> is an instant pure-node *synthesized approximation* (`.bank()` ignored, `piano`→triangle,
> reverb/delay dropped). The user chose **A as engine of record** — the demo's value prop is
> "real music, not a black box," and B undercuts the "make it sound real" pitch. **B is retained
> only as a possible instant-fallback** (Chromium/network down → degrade to synth).
>
> **➡️ HANDOFF — the only change the deliver chain needs:** repoint `scripts/strudel-deliver.sh`
> (and anything calling the render) from `scripts/render/render.mjs` (B) to
> **`render/strudel-render.mjs` (A)**. Everything else the other session built —
> `strudel-waveform.py`, `discord-voice.sh`, `strudel-watch.py`, the gpt-5.4 generation fix —
> stays. CLI shape differs: A is `node render/strudel-render.mjs <out.wav> [cycles]` with code on
> **stdin** (or `--code "<code>"`); it does NOT take seconds (uses cycles; ~4 cycles ≈ 8 s).

**A. ✅ BUILT & CHOSEN — Headless-browser offline render (`zeroclaw/render/`).** Playwright + Chromium load `render.html`, which imports `@strudel/web@1.3.0` and renders through an **`OfflineAudioContext`** (deterministic, faster-than-realtime — no audio device, no `MediaRecorder`). **Verified end-to-end:** synths, dirt drums (`bd hh sd cp`), drum-machine banks (`.bank("RolandTR909"/"RolandTR808")`), and `piano` all render audible (mean ≈ −14 to −23 dB). Files:
- `render/strudel-render.mjs` — CLI: `node strudel-render.mjs <out.wav> [cycles]` (code on stdin or `--code`). Serves the page over a tiny local HTTP origin (ESM + worklets need a real origin), drives the render, and **captures the WAV via Playwright's `download` event** — `renderPatternAudio()` emits the WAV through a blob `<a download>` click, so we capture it rather than reimplement superdough's scheduler (its internal context-setters aren't exported).
- `render/render.html` — preloads sample packs, exposes `window.__render(code,{cycles,cps})`.
- `render/strudel-waveform.mjs` — no-dep WAV→`{waveform_b64,duration_secs}` (parallel to the other session's `.py`; key is `waveform_b64` vs their `waveform`).
- `render/tidal-drum-machines.json`, `render/piano.json` — **vendored sample maps** (see finding #4).

**Hard-won findings — read before touching `render/`:**
1. `@strudel/web@1.3.0` exports `renderPatternAudio` (1.2.0 does **not**). `evaluate(code)` returns the **Pattern itself** (has `.queryArc`), not `{pattern}`.
2. `renderPatternAudio(pattern, cps, begin, end, sampleRate, maxPolyphony, multiChannelOrbits, filename)` uses the **cps we pass**, ignoring the code's `setcpm()`. The driver parses `setcpm(n)`→cps=n/60 / `setcps(n)`→cps=n out of the code (arithmetic-only safe-eval) and passes it.
3. `initStrudel()`'s default prebake registers **synths only** — drum/sample voices are **silent** until you explicitly `samples(...)`. Do **not** pass an empty `prebake` override (disables all sample loading — a real bug we hit).
4. **Sample sources moved + CORS:** `github:tidalcycles/dirt-samples` works (github raw sends CORS). Drum machines: `ritchse/tidal-drum-machines` → **renamed to `geikha/…`**, no root `strudel.json`; strudel.cc self-hosts the map but with **no CORS**. Fix: we **vendored `tidal-drum-machines.json` + `piano.json` same-origin** with `_base` injected to the CORS-enabled `raw.githubusercontent.com/geikha/tidal-drum-machines/main/machines/` (and `…/felixroos/dough-samples/main/piano/`). The wavs still fetch at render time.
5. ✅ **Bundle vendored local (Jun 22) — the hard CDN dependency is gone.** `render.html` now imports `@strudel/web@1.3.0` from `./node_modules/@strudel/web/dist/index.mjs` (served same-origin by the renderer's static server), **not** esm.sh — so a network blip can no longer blank the render. (The bundle was the only *hard* dependency; the sample loads below are already soft/caught.) `node_modules` stays gitignored and `setup.sh` `npm install`s it, so we neither commit the AGPL bundle into this MIT repo nor bloat it. The dist bundle is self-contained (vite inlines the audio worklets); its one external asset — the clock worker — resolves relative to the bundle URL under `dist/assets/`, also local. **Proven** by `STRUDEL_BLOCK_EXTERNAL=1` (a test hook in `strudel-render.mjs` that aborts every non-localhost request): a synth pattern still renders audio with all CDNs blocked. **`strudel-doctor.sh` now runs this on every demo-prep** (the "offline render" check), so a regression back to a CDN import fails the readiness gate instead of silently rotting. **✅ Closed (Jun 22) — rendering is now fully offline.** The **909/808 drum banks, piano, and dirt-samples core drums** are all cached locally (`render/cache-samples.mjs` → gitignored `samples-cache/`, served same-origin; dirt loads local-first in `render.html` with a github fallback). The doctor's three offline checks (bundle / 909-808 drums / bare dirt drums) all render with the network **fully blocked** (peak 255/255), so a demo can run with no internet. (Caching is curated — the two default kits + piano + core dirt drum names; exotic sounds still fall back to the network when online.)
6. Stacked full-gain layers can clip to 0 dBFS — add a small master gain / limiter in the Step-2 ffmpeg pass (e.g. `-af "alimiter=limit=0.95"` or `-filter:a "volume=0.7"`).

**B. ✅ BUILT (other session; superseded as primary) — Pure-node render (`zeroclaw/scripts/render/render.mjs`).** `@strudel/{core,mini,transpiler,tonal}@1.1.0` (pin exact — 1.2.x pulls `SalatRepl` from `@kabelsalat/web` and won't load in node) on **`node-web-audio-api`**; queries haps and hand-synthesizes oscillators + noise-drums (does not use superdough). Instant (~0.2 s), fully offline, no browser. Trade-off: not real Strudel audio (`.bank()` ignored, `piano`→triangle, `.room()/.delay()/.crush()` dropped). **Keep as the instant-fallback** behind A.

Render: A ≈ 3–8 s wall (incl. browser launch) for ~8 s of audio; B ≈ 0.2 s.

### Step 2 — WAV → OGG/Opus (Discord's required format)
Voice messages must be **Opus-in-OGG (not Vorbis), 1 channel, 48000 Hz, ~32 kbps**:
```bash
ffmpeg -y -i tune.wav -c:a libopus -b:a 32k -ac 1 -ar 48000 voice-message.ogg   # brew install ffmpeg
```

### Step 3 — waveform[] + duration_secs
Discord renders the preview bar from a byte array: **≤256 datapoints, 1 byte each (0–255), base64-encoded**; `duration_secs` is float seconds. Compute from the WAV PCM — bucket samples into ≤256 windows, take peak/RMS per window, scale 0–255, base64. (Can be faked if we don't care about the bar, but real amplitudes look right.) Duration = `samples / sampleRate` (or `ffprobe`).

### Step 4 — send as a voice message (bot, REST) — verified 3-step flow
1. **Request upload URL** — `POST /channels/{channel_id}/attachments`
   ```json
   { "files": [ { "filename": "voice-message.ogg", "file_size": <bytes>, "id": "2" } ] }
   ```
   → returns `upload_url` + `upload_filename`.
2. **Upload** — `PUT <upload_url>`, header `Content-Type: audio/ogg`, raw .ogg bytes.
3. **Create message** — `POST /channels/{channel_id}/messages`
   ```json
   { "flags": 8192,
     "attachments": [ { "id": "0", "filename": "voice-message.ogg",
                        "uploaded_filename": "<upload_filename>",
                        "duration_secs": <float>, "waveform": "<base64>" } ] }
   ```
   `flags: 8192` = `IS_VOICE_MESSAGE`. **Constraints:** exactly one attachment, **no `content`/embeds/other attachments**, `Content-Type` must start with `audio/`. Auth `Authorization: Bot <DISCORD_BOT_TOKEN>` (already in `.env`); bot needs **Send Messages + Attach Files** in the channel.

### What we'll need — checklist
- [ ] `ffmpeg` + Node 22+ (`brew install ffmpeg node`)
- [x] Render: **A)** Chromium (`npx playwright install chromium`) + `render/render.html` (`@strudel/web@1.3.0`) — **chosen engine**; **B)** `@strudel/{core,mini,transpiler,tonal}@1.1.0` + `node-web-audio-api` (fallback). Both built.
- [x] **`render/strudel-render.mjs` (ENGINE OF RECORD)** — Strudel code → WAV via **headless Chromium + real `@strudel/web`** (`OfflineAudioContext`, `renderPatternAudio` download captured by Playwright). Real samples (dirt + 909/808 banks + piano) & effects. Verified audible end-to-end. *(deliver chain should repoint here from B.)*
- [x] `render/strudel-waveform.mjs` — WAV → `{waveform_b64,duration_secs}`, no-dep WAV parser (node sibling of the `.py`)
- [x] `scripts/render/render.mjs` — Strudel code → WAV, **headless pure-node synth** (`@strudel/{core,mini,transpiler,tonal}@1.1.0` query haps → own oscillator/drum synth in `node-web-audio-api` `OfflineAudioContext`). **Also the parse-gate**: invalid code (incl. `[...]`-wrap) → exit 1. (built, verified — clean non-silent audio; **superseded by `render/strudel-render.mjs` as primary, kept as instant-fallback**)
- [x] `scripts/strudel-waveform.py` — any audio → `{waveform_b64 (≤256B peak), duration_secs}` (built, tested; uses ffmpeg→raw PCM, no `audioop`)
- [x] `scripts/discord-voice.sh` — ogg (+channel_id, `--send`) → 3-step REST post, **dry-run default** (built; auth verified vs live bot `zeromusicbot`)
- [x] `scripts/strudel-deliver.sh` — one command: lint → render(gate) → ogg → deliver (built, verified dry-run end-to-end)
- [x] `scripts/strudel-watch.py` — the handoff: a **REST-poll watcher** (same bot token, no gateway, no config changes) that finds the bot's own `​```javascript`-block replies and posts a rendered voice reply via the deliver chain. Arms a per-channel high-water mark so history is never replayed. (built; auth/discovery/fetch/arming verified live as `zeromusicbot`; the final `--send` post held for an explicit go-live, being outward-facing)
- [x] `strudel-lint.sh` (pre-render gate), `strudel-link.sh` (text-reply link)
- [x] ffmpeg + Node 22+ present on this Mac (node v26, ffmpeg w/ libopus ✓)

### Open questions / risks
- **zeroclaw → worker handoff & `channel_id`:** confirm how zeroclaw exposes the originating channel to a local hook/tool (gateway `/webhook` subscriber? a tool the agent calls? tail the daemon?). REST-only worker avoids gateway-connection conflicts.
- **Pure-node samples:** drum banks may not load headlessly → use browser render (A), or synth-only first.
- **Validate before render** — never render unparseable code (lint now; node `@strudel/transpiler` parse gate is the real fix, already a Next item).
- **Mistral 429s** still gate the generation step.
- Confirm current bot voice-message support — the REST API accepts it; some client libs lag, but raw REST works regardless.

Phasing: **MVP** = `strudel-deliver.sh "<code>" <channel_id>` posts a voice message for a *synth* pattern via browser render (prove end-to-end by hand). **Then** wire the zeroclaw→worker queue so it fires automatically on every `@mention`. **Then** pure-node render + sample drums.

*Sources: [Strudel webaudio/offline render](https://www.npmjs.com/package/@strudel/webaudio), [node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api), [strudel-mcp-server (Playwright render)](https://github.com/williamzujkowski/strudel-mcp-server), [Discord bot voice-message flow](https://gist.github.com/HDR/7d5d4ce8bbe4b715d788a9bc9f99e02d), [Discord Message resource](https://docs.discord.com/developers/resources/message).*

---

## Phase 2 — Song composition: multiple loops → a full song

> **Sequencing: this comes AFTER single-loop render works.** Render is the *enabler* — once a loop
> is audio, we can combine, crossfade, layer, fade, and master it (and blend Strudel renders with
> Stable Audio renders). This takes us past "one loop of notes" to **intro → verse → chorus → bridge
> → outro** with builds, drops, and loops fading in and out. Theory: `music-theory-for-zeroclaw.md`
> §4 (song anatomy), §4.2 (verse–chorus form `ABABCB`), §7 (tension/release).

### The core idea — plan once, realize at two levels
A song is **reusable loops** (drums, bass, chords, a hook) **arranged over time**, where each section
turns layers on/off and changes energy. Riff plans a **SongSpec**, then realizes it either as one
Strudel arrangement (Tier A) or as rendered audio stems assembled with an editor (Tier B). Both are
driven by the same plan, so they're not either/or — Tier A is the fast path; Tier B is the "produced"
upgrade that render unlocks.

**SongSpec** (extends Contract 3's MusicSpec — lock it first so parallel composition stays coherent):
```jsonc
{ "bpm": 120, "key": "C", "scale": "minor",
  "progression": ["i","VI","III","VII"],            // shared harmonic spine across all sections
  "palette": { "drums":"RolandTR909", "bass":"sawtooth", "chords":"piano", "lead":"square" },
  "hook": "n(\"<7 6 4 5>\")",                        // the 2–4 bar fragment the chorus repeats
  "sections": [                                       // order = the timeline; bars = 4/8-bar phrases
    {"name":"intro",     "bars":4, "energy":0.2, "layers":["chords"],                    "fade":"in"},
    {"name":"verse",     "bars":8, "energy":0.5, "layers":["drums","bass","chords"]},
    {"name":"prechorus", "bars":4, "energy":0.7, "layers":["drums","bass","chords"], "build":true},
    {"name":"chorus",    "bars":8, "energy":1.0, "layers":["drums","bass","chords","lead"], "hook":true},
    {"name":"bridge",    "bars":8, "energy":0.6, "layers":["chords","bass"], "mode":"phrygian"},
    {"name":"outro",     "bars":4, "energy":0.2, "layers":["chords"],                    "fade":"out"} ]}
```

### Tier A — Strudel-native arrangement (fast path; one render) — ✅ VERIFIED WORKING (prompt → song)
> Verified **end-to-end from a prompt**: the live gpt-5.4 agent, asked for "a full song — intro/verse/chorus/outro", composed a valid 30-line `arrange()` program (`const` sections, `.swing(4)`), which `strudel-cycles.sh` auto-sized to 24 cycles → **rendered the full ~47 s** (not cut to the intro), mean −18.5 dB. The soul's "Songs" directive already drives this correctly — **no edit needed**. Both inline and `const` sections evaluate.

Define loops as named consts; sequence sections with **`arrange([bars, section], …)`**; lift energy by
adding stack layers, raising `.lpf()`, and `.gain()`. One `arrange(...)` program → one render = a whole
song. (`arrange`/`cat` are real Strudel verbs — verify against the build per the lessons doc. NB: the
`[bars, section]` arrays are *arguments to arrange* — that is NOT the banned `[...]`-wrap-the-program bug.)
```javascript
setcpm(120/4)                              // 1 cycle = 1 bar (4 beats) at 120 BPM
// ── building-block loops ──
const drums  = stack(sound("bd*4").bank("RolandTR909"),
                     sound("~ cp ~ cp").bank("RolandTR909"),
                     sound("hh*8").gain(0.4).swing(4))
const bass   = note("c2 ~ eb2 g2").sound("sawtooth").lpf(800).gain(0.8)
const chords = n("0 2 4").scale("C:minor").sound("piano").room(0.3)
const hook   = n("<7 6 4 5>").scale("C:minor").sound("square").lpf(1600).gain(0.5)
// ── sections = which loops play + their energy ──
const intro     = chords.gain(0.3).lpf(700)
const verse     = stack(drums, bass, chords.gain(0.5))
const prechorus = stack(drums, bass, chords.gain(0.5).lpf(saw.range(600,4000).slow(4)))  // rising filter = build
const chorus    = stack(drums, bass, chords.gain(0.6), hook)
const bridge    = stack(n("0 2 4").scale("C:phrygian").sound("piano").gain(0.4), bass.gain(0.5))
const outro     = chords.gain(0.25).room(0.7)
// ── the timeline (verse–chorus form) — ~64 bars ≈ 2:08 at 120 BPM ──
arrange([4,intro],[8,verse],[4,prechorus],[8,chorus],
        [8,verse],[4,prechorus],[8,chorus],[8,bridge],[8,chorus],[4,outro])
```
*Validate the assembled program through `render.mjs` — re-applying `.gain()` to a const can compound, and a long arrangement has more surface for an invalid verb. Composing from individually-rendered loops (Tier B) sidesteps this.*

### Tier B — Audio assembly (what render unlocks; the "combine + sound-edit" path)
Render each **section (or stem)** to WAV via the faithful renderer, then assemble with `ffmpeg`. This is
where real production lives — true crossfades, fades, layering, sidechain, and mastering — and it's the
only way to **mix Strudel renders with Stable Audio renders** (the skeleton→flesh combo).
```bash
# sections rendered → intro.wav verse.wav chorus.wav … then:
# concat + smooth section joins (crossfade), one filtergraph:
ffmpeg -i intro.wav -i verse.wav -i chorus.wav -filter_complex \
  "[0][1]acrossfade=d=1:c1=tri:c2=tri[a];[a][2]acrossfade=d=1[mix]" -map "[mix]" song_raw.wav
# whole-song fade in/out + broadcast-loudness master + clip-safety limiter:
ffmpeg -i song_raw.wav -af "afade=t=in:d=2,afade=t=out:st=<end-3>:d=3,loudnorm=I=-14:TP=-1.5,alimiter=limit=0.95" song.wav
# layer a pad/riser UNDER a section (overlap, not sequence): amix
ffmpeg -i base.wav -i riser.wav -filter_complex "amix=inputs=2:normalize=0" out.wav
```
Editor verbs ↔ musical intent: `acrossfade` = seamless section change · `afade` = loop fades in/out ·
`amix` = layered loops (pad under everything, riser into the drop) · `volume`/`sidechaincompress` =
duck/pump · `aloop` = repeat a section · `loudnorm`+`alimiter` = master. Reuse the existing
`scripts/strudel-deliver.sh` / voice-message chain for delivery.

### Agent decomposition (the ZeroClaw orchestration win)
1. **song-architect** → SongSpec from the request + `music-theory` skill (anatomy, energy curve,
   progression, where the hook lands, where tension builds/releases).
2. **section/loop composers** (parallel sub-agents) → one small, individually-renderable Strudel
   pattern per loop/section, consistent with the locked palette + progression. Small parts pass the
   render-gate far more reliably than one giant program.
3. **renderer** → each section → WAV stem (the enabler; Tier-A skips straight to one render).
4. **audio-assembler** → turns the SongSpec order/fades into the `ffmpeg` filtergraph (Tier B) →
   master → deliver. (Optional: route a stem through Stable Audio audio-to-audio first.)

### Reliability & limits (apply the lessons)
- **Compose from validated parts.** Each section is small → lints/renders reliably; the render-gate
  validates every stem and the final mix. Wrap renders with **K=2 retry + timeout** (`agent-reliability`).
- **Coherence = lock the SongSpec first** (bpm/key/progression/palette/hook) before fanning out, or
  sections won't fit — same "fix the contract first" rule as the team split.
- **Delivery:** a full song's code + base64 link will **exceed Discord's 2000-char limit** — so for songs
  the **rendered audio file is the primary deliverable**; post the code as an attachment/gist + the
  share-link separately (single loops keep the inline code+`▶ Play` link).
- **Transitions in Strudel (Tier A):** build = `.lpf(saw.range(…).slow(bars))` + a last-bar fill
  (`sound("sd*16")` via `.every`); drop = full stack at max gain (optionally a 1-beat `~` before); outro
  = falling `.gain` + more `.room`.

### Phasing
- **P0** — `arrange()` of 2 sections (verse↔chorus) with a gain/filter step. Proves multi-section.
- **P1** — full `ABABCB` Strudel arrangement (Tier A) with one build + one drop + fade-out. One render.
- **P2** — Tier B: render stems → `ffmpeg` concat + `acrossfade` + `afade` + `loudnorm`/limiter → master.
- **P3 (stretch)** — per-section Strudel→Stable-Audio render + crossfade for "produced" songs;
  reference-track structure cloning (analyze a song's section map, regenerate in our palette).

---

## External API access (Cloudflare tunnel)

ZeroClaw's local gateway (`127.0.0.1:42617`) is exposed publicly via a **protected Cloudflare quick tunnel** so other groups' backends can drive music generation.

- **Base URL:** `https://frame-expensive-teddy-awarded.trycloudflare.com` — ⚠️ **quick-tunnel URLs are EPHEMERAL** (they change every time `cloudflared` restarts; re-share on restart, don't hardcode).
- **Auth:** `Authorization: Bearer <ZEROCLAW_API_TOKEN>` on **every** request (401 without it — even `/health`). The token is a shared secret: **keep it out of git** — share via the team channel / a gitignored `.env`, never a committed file.

**Verified endpoints** (all bearer-gated; tested 2026-06-21):

| Method · Path | Result |
|---|---|
| `GET /api/status` | ✓ daemon + component health JSON (gateway_port, channels, scheduler, …) |
| `GET /api/channels` | ✓ configured channels (currently `[]`) |
| `GET /metrics` | ✓ Prometheus metrics |
| `GET /health` | ✓ (bearer required) |
| `POST /webhook` `{"message":"…"}` | ⚠️ accepts + processes the prompt **async**, but the HTTP call returns **408 after ~30s with no body** — the agent reply is delivered to its *channel*, not returned to the caller. **Not** a synchronous request/response music API. |

```bash
# smoke test (token via env — do not paste the literal token into committed files)
curl -H "Authorization: Bearer $ZEROCLAW_API_TOKEN" \
  https://frame-expensive-teddy-awarded.trycloudflare.com/api/status
```

**How another group's backend gets music today**
- **Via the channels (proven path):** the reliable generate→deliver flow is Discord/SimpleX — a message to the bot triggers a text+code reply *and* the watcher auto-posts a 🎙️ voice message. An external backend can drop a message into the shared Discord channel (Discord API) and the same flow fires.
- **Programmatic request/response:** `GET /ws/chat` (WebSocket, streamed agent reply) is the designed interactive interface — **not yet verified** (no WS client installed in this session); the likely path for a backend that wants the code/link returned synchronously.
- **✅ Sync music API (`scripts/api-server.py`)** — closes the `/webhook` gap with a real request/response service (stdlib only; launch via `scripts/api-server.sh`, binds `127.0.0.1:8799` — 8787 is taken by `workerd`). Reuses the exact chain: agent (gpt-5.4) → parse-gate → faithful render → ffmpeg.
  - `POST /generate {prompt, cycles?, format?}` → `{strudel_code, share_url, format, audio_base64}` — **prompt in, music out** (verified: "a chill lofi loop" → 80bpm pattern + 12s mp3).
  - `POST /render {code, …}` → same shape, skipping the LLM (verified: 157KB mp3; invalid code → 422).
  - `GET /health` → `{ok:true}`; `GET /` → self-documenting capabilities. Auth: `Authorization: Bearer $MUSIC_API_TOKEN` on every POST (401 without).
  - **Expose to other groups:** point a Cloudflare tunnel at the port — `cloudflared tunnel --url http://localhost:8799`. Formats: mp3/ogg/wav; cycles 1–16.

---

## Phase 3 — Off the laptop: migrate ZeroClaw to Cloudflare

> **Why now.** Today the whole stack lives on one Mac — three launchd services (daemon, watcher,
> music-api) behind an **ephemeral** quick tunnel whose URL rotates on every restart, the laptop has
> to stay awake, and a single sleep/crash takes the bot down. The Sundai ethos is *get off localhost*.
> This phase moves the orchestrator, render, persistence, and Discord onto Cloudflare's edge:
> **always-on, no laptop, a stable URL, and horizontal scale** for the live-stream phase that follows.
> The current "External API access" tunnel above is the bridge; this is the destination.
>
> Grounded against current Cloudflare docs (via the `cloudflare` skill + a `cloudflare-deployment-expert`
> pass) — feasibility verdicts and the limits to **verify early** are called out inline.

### What runs where — local → Cloudflare mapping

| Today (local) | Cloudflare primitive | Notes |
|---|---|---|
| ZeroClaw Rust daemon — HTTP gateway | **Worker** (+ **Agents SDK**) | `/webhook`, `/generate`, `/render`, `/health`; the agent loop |
| Per-session "modify" state + version history | **Durable Object** (Agents SDK `setState`) | one DO per `session_id` = the modify chain, SQLite-backed |
| LLM compose (OpenAI gpt-5.4) | **`fetch()` → OpenAI** behind **AI Gateway** | stays external (Workers AI has no gpt-5.4 peer); AI Gateway adds caching + rate-limit + cost observability at ~0 added latency |
| Headless-Chromium render + ffmpeg | **Containers** (`standard-2`/`-3`) | **the crux** — see below; Browser Rendering is NOT viable for audio |
| Render dispatch | **Queues** | Worker enqueues a job → Container consumer renders → R2 |
| Supabase Postgres `tracks` | **D1** | 10 GB cap → ship a retention cron in the same PR |
| Supabase storage (WAVs) | **R2** | zero egress on every serving path |
| pgvector "more like this" | **Vectorize** | ANN-only; keep metadata in D1, join app-side |
| Local cron (trending / jingles) | **Cron Triggers** | sub-hourly cron has a 30 s CPU cap → it must *enqueue*, not render inline |
| Ephemeral quick tunnel | **Workers route / custom domain** | stable public URL; tunnel retired |

### Diagram (target)

```
                                ┌──────────────── Cloudflare edge ─────────────────┐
 Discord ──Interactions POST──► │  Worker  (gateway + Agents SDK orchestrator)      │
 Frontend ──/generate /render─► │   defer<3s → waitUntil(compose → enqueue render)  │
                                │        │                    ▲ follow-up REST       │
                                │        ▼                    │                      │
                                │   Durable Object            │                      │
                                │   (per session: modify      │                      │
                                │    chain, version history)  │                      │
                                │        │ enqueue                                    │
                                │        ▼                                            │
                                │     Queues ──► Container (Node+Playwright+Chromium  │
                                │                  @strudel/web → WAV → ffmpeg)       │
                                │                        │                           │
                                │   D1 ◄─ row   Vectorize ◄─ embedding   R2 ◄─ audio │
                                └────────────────────────────────────────────────────┘
   external (UDP blocker):  ▸ optional Discord *voice-channel* relay lives OFF Cloudflare
```

### The crux — render + transcode must run in a Container

- **Browser Rendering is OUT.** The managed browser pool **doesn't allow custom Chromium flags**
  (we rely on `--autoplay-policy`-class control), exposes **no audio-device path**, and has **no way to
  exfiltrate a generated Blob/WAV** back to the caller — so the existing `download`-event WAV-capture
  trick has no equivalent. **Don't prototype this path.**
- **Containers are the home (GA on Workers Paid).** A `linux/amd64` image runs the *existing* renderer
  unchanged — Node + Playwright + Chromium + **ffmpeg as a real binary** — owning its own filesystem for
  the WAV→Opus/HLS handoff. Size at **`standard-2` (1 vCPU / 6 GiB)** minimum, **`standard-3`
  (2 vCPU / 8 GiB)** for headroom. An ~8 s `OfflineAudioContext` render is trivially within CPU budget.
- **ffmpeg → Containers only.** WASM-ffmpeg in a Worker is a dead end (128 MiB isolate memory, 64 MB
  bundle cap, no threads) — OK for a toy clip, OOMs on real audio + HLS segmenting. The Sandbox SDK is
  Containers with extra multi-tenant overhead we don't need.
- ⚠ **Verify early:** container **cold provisioning takes minutes**; measure warm-start latency for
  Chromium init at the chosen `sleepAfter` and keep a warm instance for the demo. Keep the existing
  **timeout + K=2 retry** wrapper (renders flake / cold-start) — `agent-reliability`.

### Discord on Cloudflare

- **Interactions webhook → Worker is the clean native path.** Discord POSTs a signed request; the
  Worker verifies the Ed25519 signature, **acks within 3 s with a deferred response (type 5)**, then
  `waitUntil()` runs compose → render → **follow-up via the Discord REST webhook** (posts the 🎙️ voice
  message exactly like today's `discord-voice.sh` 3-step flow). This **retires the REST-poll
  `strudel-watch.py` watcher** — event-driven, no polling.
- A persistent **Gateway WebSocket in a DO is fragile** (15-min outbound-connection eviction → a
  reconnect/RESUME dance); only worth it if we need true gateway events. Default to Interactions.
- ⚠ **Discord *voice-channel* streaming is a hard blocker on Cloudflare** — Discord Voice needs a **UDP**
  socket for Opus RTP and **Workers/DOs have no UDP**. The "Riff is always playing in the voice channel"
  idea (and Phase 4's voice radio) needs an **external relay** (a small Container *outside* CF, or a VPS)
  that pulls the stream and pushes Opus frames. Budget for it; don't assume CF can do it.

### Persistence — the swaps and their gotchas

| Swap | Limit to design around |
|---|---|
| Postgres → **D1** | 10 GB/DB, 100 cols/table, 2 MB/row — **add a retention cron from day one** (`rules/cloudflare-lessons.md`) |
| Storage → **R2** | zero egress everywhere; ~$4.50/M writes, $0.36/M reads — batch where possible |
| pgvector → **Vectorize** | 1,536-dim max (matches OpenAI `text-embedding-3-small`), 10 M vectors/index, **ANN-only (no SQL predicates)** → upsert vectors to Vectorize, keep structured metadata in D1, join the two app-side (a 2-hop "more like this") |
| cron → **Cron Triggers** | ~1-min min interval; **sub-hourly cron = 30 s CPU cap** → the trigger must *enqueue to Queues* and return, never render inline |
| render queue → **Queues** | 5,000 msg/s, 128 KB/msg, 15-min consumer wall-clock, 100 retries |

### Phasing (thin vertical slices)

- **P0 — Worker shell.** Port `/generate` + `/render` (the stdlib `api-server.py` logic) to a Worker that
  calls OpenAI via `fetch` and returns code + `share_url`; **no render yet** (Tier-A link only). Stable
  custom-domain URL replaces the quick tunnel. *Proves the orchestrator runs on the edge.*
- **P1 — Containerized render.** Wrap the existing `render/` engine + ffmpeg in a Container image;
  Worker → Queues → Container → R2; `/render` now returns a real `audio_url`. *Proves audio renders off-laptop.*
- **P2 — State + persistence.** Per-session DO (Agents SDK) for the modify chain; `tracks` in D1;
  embeddings in Vectorize; "more like this" working. *Proves the modify loop + history on the edge.*
- **P3 — Discord-native.** Interactions webhook replaces the daemon + watcher; @mention → deferred ack →
  follow-up voice message, fully on Cloudflare. *Laptop fully retired.*

⚠ **Agents SDK GA status is unconfirmed in current docs** — treat as recently-launched; if it's still
beta when we build, fall back to **raw Durable Objects** (the SDK is a convenience layer over them —
`schedule()`/`scheduleEvery()`, `setState()`, durable execution — not a hard dependency).

---

## Phase 4 — Constant live stream (generative radio): Riff never stops

> **The idea.** Beyond request→response, Riff runs an **always-on radio station** — one stream URL that
> plays an **endless, continuously-composed, evolving set**. No track repeats; the music morphs over
> time (gradually shifting genre / mood / energy), seeded by time-of-day, channel mood (Situation D), or
> what's trending — and the community can **steer it live** ("make it darker", "more energy"). This is the
> marquee *"it's genuinely generative, not a playlist"* demo.

### How "continuous" works — a lookahead buffer

The core trick is a **lookahead buffer**: the coordinator always keeps the stream a few segments *ahead*
of the playhead, so there is always music ready while the next chunk generates.

```
 playhead ───────────────────────────────────────────────►  t
 [seg n-2][seg n-1][ seg n ]│[seg n+1][seg n+2]              in R2 + in the rolling .m3u8
   (played → evicted)        │ ▲ now playing  ▲ buffered ahead
                             │
        DJ coordinator ──────┘ generates seg n+3 NOW (SongSpec evolved from seg n+2)
                               → render (Container) → HLS segment → R2 → append to .m3u8
```

- Each new segment's **SongSpec is derived from the previous** by an *evolution engine* — a transition
  model (Markov / rule-based) over the **modify vocabulary** (see the modification table above): nudge
  BPM ±, shift a scale, add/drop a layer, swap a kit. Keep **key + tempo coherent** across adjacent
  segments so joins are seamless **harmonic mixes**, with a short crossfade (ffmpeg `acrossfade`) at each
  boundary — Phase-2 Tier-B assembly, but unbounded and real-time.
- **Steering:** `POST /steer {"nudge":"darker"}` (or a Discord command) biases the next few SongSpecs —
  the stream reacts within a segment or two without breaking continuity.

### Architecture (built on Phase 3's primitives)

| Role | Primitive | What it does |
|---|---|---|
| **DJ coordinator** | **Durable Object** (Agents SDK `scheduleEvery`) | the brains: rolling segment window (DO SQLite), schedules the next generation, derives the next SongSpec, maintains the `.m3u8` |
| Generate + render | **Queues → Container** | compose Strudel → render WAV → ffmpeg → **HLS segment** (`.ts`/fMP4, ~6–10 s) |
| Segment + playlist store | **R2** | rolling window of segments + the live `.m3u8`; old segments evicted |
| Serve to listeners | **Worker** | reads playlist/segments from R2, **short edge-cache TTL** (`cf.cacheTtl ≈ segment length`) → thousands of listeners served from cache at ~zero cost |
| Listen surface | **HLS** (`.m3u8`) | any browser/player; embed in the dashboard with an `<audio>` + hls.js player |

### Why rolling-HLS (not Cloudflare Stream / Icecast)

- **No Cloudflare-native Icecast equivalent.** Cloudflare **Stream is video-centric and billed per
  delivered minute** — far too expensive for 24/7 audio. **Rolling HLS segments to R2, served by a
  Worker, is the correct self-managed path** (R2 egress is free; the edge cache absorbs listener fan-out).
- Standard HLS latency (~3 segments behind live) is **fine for radio** — it isn't interactive, so skip
  LL-HLS complexity. Tune segment length for the latency/overhead tradeoff (~6–10 s).

### Reliability — *dead-air protection is the whole game*

A radio that goes silent is broken. Apply the `agent-reliability` discipline to a real-time deadline:
- **Never let the buffer underrun.** Generation must stay ahead by ≥2 segments. **K=2 retry + timeout**
  on every compose+render.
- **Fallback ladder on a failed/late segment:** (1) **re-loop / extend the previous segment** (already
  key/tempo-coherent), (2) drop to a **cached evergreen loop** in R2, (3) only then a brief tasteful fill.
  The listener hears audibly-fine degradation, **never dead air**.
- ⚠ **Verify early:** DO **alarms are best-effort, not a real-time clock** — at sub-15 s cadence there can
  be jitter. Because generation runs *ahead* of playback, modest jitter is absorbed by the buffer; but if
  timing proves too loose, **move the coordinator into a persistent Container process** (a real event
  loop) and keep the DO only for coordination state. R2 same-key write rate is **1/s** — rewriting the
  `.m3u8` every ~8 s is comfortably safe.

### Discord radio (stretch)

A Discord **voice-channel** "always-on Riff" is desirable but hits the **UDP blocker** (Phase 3): the
relay that pushes Opus frames into the voice channel must run **off Cloudflare** (a small box that
consumes the HLS stream). The HLS URL is the primary listen surface; the voice-channel relay is a stretch.

### Phasing

- **P0 — ✅ Local-first prototype built (`scripts/radio.sh`, Jun 22).** Renders a sequence of Strudel
  patterns → HLS audio segments (`.ts`/AAC) appended to a live `.m3u8` — no `#EXT-X-ENDLIST` while live so
  players keep polling for new segments; `--max-segments` closes it as a finished VOD. Renders **offline**
  from the cached packs, and each stage **skips-not-aborts** so one bad segment can't kill the stream.
  Verified by `scripts/test-radio.sh`. **Demoable in one command:** `radio.sh <out> --serve --window 12`
  also serves a self-contained **browser player** (`radio.html`, native HLS) + the live stream — open
  `http://localhost:8123/radio.html` (Safari) or `ffplay stream.m3u8`. (Evolution + rolling-window: see P1.)
- **P1 — Evolution engine. ✅ Core built (`scripts/radio-compose.mjs`, Jun 22).** A deterministic
  parametric walk — tempo/key/mode/kit/hat-density/filter evolve *smoothly* with the segment index — so
  the stream morphs (verified **8 distinct patterns over 8 segments**) while staying reproducible and
  testable; every generated segment passes the parse-gate, uses only cached kits, and renders offline.
  `radio.sh` now sources each segment from it instead of a fixed seed cycle. **Rolling-window playlist
  ✅ (Jun 22):** `--window W` keeps only the last W segments on disk + in the `.m3u8` (evicts the oldest,
  bumps `EXT-X-MEDIA-SEQUENCE`), so the radio runs 24/7 without filling the disk. **Still P1:** derive
  each segment from the *previous* one (a true transition model) · agent-generated segments · seamless
  harmonic-mix **crossfades** at joins (ffmpeg `acrossfade`).
- **P2 — Lift to Cloudflare.** DJ coordinator → DO / Agents `scheduleEvery`; render → Queues + Container;
  segments + playlist → R2; serve via Worker with short cache TTL. Always-on, no laptop, scales.
- **P3 — Steering + seeds. ✅ Steerable from the browser (Jun 22).** `radio-compose.mjs` takes a steer
  hint (`RADIO_STEER`) biasing mode/tempo/density; `radio.sh` re-reads `<outdir>/steer` each segment;
  and **`scripts/radio-serve.py`** (replacing the static `python -m http.server` under `--serve`) handles
  **`POST /steer`** → writes that file, so the **player has darker/brighter · faster/slower · denser/sparser
  toggle buttons** that nudge the live stream from the next segment. **And from chat (Jun 22):** any
  member typing `!radio darker faster` (or `!steer …` / 🎛️) steers a running radio — `strudel-watch.py`
  writes the hint to the steer file (opt-in via `RADIO_STEER_FILE`; dormant on the live bot otherwise).
  Deterministic + tested. **Time-seeded ✅ (Jun 22):** with no manual steer the radio auto-drifts by
  time of day (late night → darker/chill, midday → brighter) via `RADIO_AUTOSEED`; a manual steer
  overrides. **Next:** seed from channel mood (Situation D) / trending.
  **Stretch:** off-Cloudflare relay into a Discord voice channel.

---

## Build log
*Running record of what's shipped, newest first. Updated each work iteration.*

- **Jun 22 — Watcher 403-cache: stop re-polling inaccessible channels (hardens the watch-all fix).** Watching all 62 of the bot's channels meant re-polling the ~16 it can't read (private/mod-only → 403) *every* cycle — wasted API calls + 429-storm/cycle-time risk on the now-heavier watcher. `cycle()` now caches 403/401 channels in-memory (`_INACCESSIBLE`) on first encounter and filters them out before polling, so steady-state it polls only the readable ~46 (down from 62). Reset on restart (re-checks for a later permission grant). **Tested:** `test-watch-sections.py` → all green incl. a new "cycle() caches a 403 channel" case. Verified live: cycle 1 cached 16 inaccessible; cycle 2 skipped them. (Reviewed via vibe-orchestrator.)
- **Jun 22 — THE root cause: watcher now watches ALL the bot's guild channels + threads (not a hand-picked 3).** Found why the user's audio never came: the bot is in **2 guilds with 62 text channels + active threads, but the watcher watched only 3** (a hand-set `STRUDEL_WATCH_CHANNELS`) — so a reply in any other channel (e.g. **#🌞-sundai-hackathon**, where the user was) never became a voice message. `channels()` now **auto-discovers every guild the bot is in (`/users/@me/guilds`) → all its text/announce channels + active threads**, merging `STRUDEL_WATCH_CHANNELS` as extras (deduped; inaccessible channels just 403-skip per cycle; a cap-warning fires >60). Deployed → the watcher now covers all 62 incl. #sundai-hackathon. **Reverted** the earlier first-sight "deliver the most-recent stranded reply" tweak back to **arm-skip**: with ~62 channels suddenly watched, replaying backlog would bulk-deliver old stranded replies across dozens of channels (a spam burst). New replies after arming deliver normally; the idempotency check keeps deliberate re-scans safe. **Tested:** `test-watch-sections.py` → all green (channels() discovers-all-guilds + merges + dedups). Verified live: watcher running, watching 62, **no delivery burst** (0 posts in the window). ⚠ 62 channels is heavyish (re-polls inaccessible ones each cycle) — set `STRUDEL_WATCH_CHANNELS` to restrict if rate-limited. This (not the DNS wedge) was the primary reason the user's requests in #sundai-hackathon got no audio.
- **Jun 22 — Watcher now also watches threads (closes part of the incident's open gap).** Follow-up to the DNS-resilience fix: the watcher polled only top-level text/announcement channels, so a reply posted in a **thread** never became a voice message. `channels()` now also fetches the guild's **active threads** (`GET /guilds/{g}/threads/active`) and watches them (deduped; non-fatal if it fails). And first-sight no longer blindly skips a new thread/channel's whole backlog — it delivers the **most-recent stranded reply** (capped at 1, idempotent → no flood), so a thread created for a single request still gets its audio. **Tested:** `test-watch-sections.py` → all green incl. a `channels()`-thread-merge case. Deployed + verified (runs clean, reaches Discord). **Remaining gap:** **DMs** — the REST API doesn't let a bot enumerate its DM channels, so DM auto-delivery would need gateway/daemon coordination (not the REST-poll watcher); for now, request in a server channel. (NB: the guild currently has 0 threads and 0 bot DMs, so the reported incident was the DNS wedge — already fixed — not a thread/DM miss; this hardens for future thread use.)
- **Jun 22 — INCIDENT fix: watcher survives DNS blips + idempotent delivery; recovered a stranded song.** A user reported "not sending rendered audio anymore." Diagnosis: `strudel-watch.log` had a flood of `urlopen error [Errno 8] nodename nor servname` — the watcher's poll cycles were dying on a **transient DNS-resolution failure** (resolver hiccup, likely after a network/VPN change), so bot replies stopped becoming 🎙️ voice messages. The delivery pipeline itself was healthy (`voice-deliver.sh` rendered the reported song to a 110 s ogg). **Fix:** `api()` now **retries transient `URLError`/timeout** with backoff (+ a 20 s urlopen timeout) instead of crashing the cycle; delivery is **idempotent** (`already_delivered()` skips a code-reply that already has a following voice message → safe to re-scan after a blip without duplicating). Tested (`test-watch-sections.py` → all green incl. 4 idempotency + an api-retry case), deployed (watcher kickstarted + verified reaching Discord), commit `be940e7`. **Recovered:** delivered the reported song to `#general` (voice message + 2 chunked per-section-link messages — confirmed `section_messages` splits a 2768-char link set into 2 < 2000 messages). **⚠ Open gap:** the watcher polls only the guild's text/announcement channels — **NOT DMs or threads** — so a request sent there gets no auto-delivery (the reported song was in none of the 3 watched channels → likely a DM/thread). Watching DMs/threads is the next reliability item.
- **Jun 22 — Radio auto-seeds by time of day (Phase-4 P3 "Next").** With no manual steer, the 24/7 radio now drifts with the clock — `radio-compose.mjs` derives a seed from the hour (late night → `darker chill`, early morning → `brighter sparse`, daytime → `brighter`, evening → `warm`), so the same segment index sounds dark + mellow at 3am (C2:phrygian, 85 bpm) and bright at noon (lydian, 109 bpm). A manual steer (file / browser / chat) always overrides. Kept **opt-in** via `RADIO_AUTOSEED` (which `radio.sh` sets) + `RADIO_HOUR` pins the clock for tests, so the bare engine stays time-independent and deterministic (the existing evolution/determinism checks rely on that). **Tested:** `test-radio.sh` extended → all green incl. night→dark, midday→bright, manual-overrides-seed, auto-seeded segment still gates, and the bare engine stays deterministic. **Remaining:** seed from channel mood (Situation D). (Reviewed via vibe-orchestrator.)
- **Jun 22 — Chat-steer the radio: `!radio darker faster` from Discord (Phase-4 P3).** Connects the two marquee features — the chat bot and the live radio. `strudel-watch.py` now recognizes a steer command (an explicit `!radio` / `!steer` / 🎛️ prefix) from **any member** and writes the hint to the radio's steer file (`RADIO_STEER_FILE`), which `radio.sh` re-reads each segment — so the community steers a running generative radio from chat. **Opt-in** (dormant unless `RADIO_STEER_FILE` is set, so the live bot is unaffected); the explicit prefix means a normal "make a darker song" request is *not* mistaken for a steer; `clear`/`reset`/`off` clears. **Tested:** `test-watch-sections.py` extended → all green incl. 7 new cases (command→hint, lowercased, 🎛️, explicit-clear, and non-commands → None) + an end-to-end check that a command writes the steer file. **Next:** seed-from-mood / time-of-day. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Self-heal watchdog now covers the WATCHER (+ music-api) and is reproducible.** Audited resilience after the deploy: the watchdog only restarted the *daemon* — the **watcher** (whose silent zombie = "replies but no voice message," the recurring "it didn't work") had no coverage and emitted no liveness signal, and the watchdog wasn't in `install-services.sh` (a fresh clone had no self-heal at all). Fixes: `strudel-watch.py` now touches a **heartbeat** at the end of each poll cycle; `watchdog.sh` was rewritten to check **daemon** (health + discord last_ok staleness) **+ watcher** (process + heartbeat freshness — a stale heartbeat = the loop hung) **+ music-api** (/health) independently, each with its own consecutive-fail counter so it restarts *only* the bad service after `FAIL_THRESHOLD`; and `install-services.sh` now generates a **periodic** (`StartInterval`) watchdog plist (4 services total) so a clone gets self-heal. Added test hooks `WATCHDOG_DRY_RUN` (decide, don't restart) + `WATCHDOG_SKIP_PGREP` (env-independent). **Tested:** new `scripts/test-watchdog.sh` → **5/5** (periodic plist generated; stale watcher heartbeat → restart decision; fresh → no restart; watcher writes a heartbeat); added to `scripts/test.sh`. **Deployed + verified live:** watcher restarted (writing heartbeats every ~8 s), the new watchdog runs clean on the healthy system — daemon + watcher + music-api all OK, no false restarts. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Brought the demo runbook (`docs/DEMO.md`) current with the full system.** It predated everything built since the initial hack day — still said "16/16," and never mentioned offline rendering, auto-repair, per-section song links, or the generative radio, so a presenter would follow it into stale/missing features. Rewrote it: the pitch leads with *local/offline + per-section links + steerable radio*; pre-present checks now use `strudel-doctor.sh` **22/22** + `./scripts/test.sh` (the regression suite) + a render-only pre-warm; live-demo beats added for **a full song's per-section play links**, the **offline flex** (render with Wi-Fi off), and the **steerable live radio** (`radio.sh --serve` → play → click darker/faster to steer); backup plan + judging emphasis updated (offline, self-heal, steerable radio). **Every command/claim verified by running it:** doctor 22/22, `test.sh` → all **8** suites pass, the radio `--serve` + `POST /steer` smoke, and the render-only pre-warm; the remaining claims (deliver auto-repair, model fallback `gpt-5.4→mini→mistral` in `config.toml`, per-section links, offline bundle+cache) confirmed by grepping the code. (A vibe-orchestrator fact-check was dispatched but ran out of turns mid-read; self-verified instead.)
- **Jun 22 — Phase-4 P3: steer the radio from the browser (`POST /steer`).** Completes interactive steering. `scripts/radio-serve.py` replaces the static `python -m http.server` under `radio.sh --serve` — it serves the HLS output AND handles **`POST /steer`** (writes `<outdir>/steer`, which radio.sh re-reads each segment) + `GET /steer`. The player (`radio.html`) gained **toggle buttons** (darker/brighter · faster/slower · denser/sparser · clear) that POST the combined hint, so clicking "darker" morphs the live stream from the next segment. Stdlib-only, 127.0.0.1-bound; the steer body is whitespace-collapsed + length-capped and used only for substring matching (never eval'd/shelled). **Tested:** new `scripts/test-radio-serve.sh` → **6/6** (serves static + player; `POST /steer` writes the file; `GET /steer` returns it; empty body clears; newlines collapsed); added to `scripts/test.sh`, and the existing `--serve` checks still pass through the new server. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Phase-4 P3: live steering — listeners can nudge the radio.** `radio-compose.mjs` now takes a steer hint (`RADIO_STEER`, e.g. `darker faster hard`) that biases the evolution: mood (dark → phrygian/aeolian/minor, bright → lydian/mixolydian/major/dorian), tempo (`fast`/`slow` = ±24 bpm), and density (`dense` → `hh*16` + extra layers, `sparse` → `hh*4`). `radio.sh` re-reads `<outdir>/steer` **each segment**, so `echo 'darker faster' > <outdir>/steer` morphs the live stream from the next segment on — "the community steers the radio," locally, no infra. Deterministic in (index, steer) → reproducible + testable; output stays allowlisted + cached-kit-only so it still renders offline. **Tested:** `test-radio.sh` extended → all green incl. `darker`→a dark mode every segment, `faster`→higher bpm (109→133), steered segment still gate-passes, and `radio.sh` re-reads + applies the steer file end-to-end. **Next:** a `POST /steer` endpoint + a Discord command to write the steer file. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Song replies now get a clickable play link PER SECTION (intro/verse/chorus/…) + the spoken words** (direct user request). A full song's whole-program base64 link exceeds Discord's 2000-char limit, so the bot dropped the link entirely ("paste the code") — a poor reply. Fix: new `scripts/strudel-song-links.mjs` deterministically splits a song (`setcpm` + `const` sections + `arrange(...)`) into one **self-contained** `strudel.cc` link per section — each carries the `const`s it transitively references + a final bare reference so that section actually plays — with base64 built **in code, not by the model** (the project's lesson: model base64 drifts from the shown code). `strudel-watch.py` now posts these as companion message(s) after the song's voice message (greedily chunked < 2000 chars) and surfaces the 🎤 vocal line; the soul's full-song rule points to the per-section links instead of "paste the whole thing." **Tested** on the exact song from the request: `test-song-links.sh` → **8/8** (one self-contained, gate-passing link per section · loop→none · deterministic); `test-watch-sections.py` → **13/13** (▶ link per section · every message < 2000 · words surfaced · loop→none); both added to `scripts/test.sh`. **Hardened after the vibe-orchestrator review flagged two real edges:** the statement splitter now ignores brackets *inside string literals* (so `sound("bd(3,8)")` can't miscount depth), and any single section link too long to post on its own is dropped rather than producing an oversized message (tested with a 70-layer section). (Reviewed via vibe-orchestrator — it caught both; refixed + re-verified.)
- **Jun 22 — Phase-4: browser player + one-command serve (`radio.html` + `radio.sh --serve`) — the radio is now demoable.** It generated/evolved/ran 24/7, but you could only hear it via ffplay/VLC. `radio.sh --serve [--port P]` now also serves the output dir over HTTP with a self-contained, dependency-free **`radio.html`** player (styled, native HLS), so the whole demo is one command: `radio.sh /tmp/radio --serve --window 12` → open `http://localhost:8123/radio.html`. The `python3 -m http.server` is backgrounded and cleaned up on exit (a `cleanup` trap kills it — no orphaned server). **Tested:** `test-radio.sh` → **14/14** (added: `radio.html` references the stream + has an `<audio>` element; the live `stream.m3u8` *and* the player page are served over HTTP — verified by a bounded `--serve` run + curl, using curl's own `--retry` so the test needs no `sleep`). (Reviewed via vibe-orchestrator.)
- **Jun 22 — Phase-4 P1: rolling-window playlist — the radio is now 24/7-safe.** Without it an endless stream fills the disk forever. `radio.sh --window W` now keeps only the last W segments on disk and in the `.m3u8`, evicting the oldest and bumping `#EXT-X-MEDIA-SEQUENCE` (the standard live-HLS sliding window); keep-all (W=0) remains the default. The playlist is rewritten **atomically** (temp + `mv`) each segment so a polling player never reads a half-written file. **Caught + fixed a `set -e` bug via the test:** `write_playlist`'s last command was `[ test ] && echo`, which returns non-zero on the normal (non-final) call → it aborted the whole script before writing anything; switched to `if/fi` so the function returns 0. **Tested:** `test-radio.sh` rewritten → **11/11** (window keeps 2, oldest evicted from disk, `MEDIA-SEQUENCE` bumped, playlist references only kept segments, keep-all media-sequence 0, plus the HLS + evolution checks). (Reviewed via vibe-orchestrator.)
- **Jun 22 — Phase-4 P1: evolution engine (`scripts/radio-compose.mjs`) — the radio now genuinely morphs.** P0 cycled 3 fixed seeds; this makes the stream a continuously-*evolving* set. A deterministic parametric walk derives each segment's tempo/key/mode/kit/hat-density/filter from the segment index (smooth drift: bpm ~88–130 via a sine, mode every 2 segments, root every segment, kit alternating 909/808, occasional filter sweeps), emitting valid Strudel from a template. Deterministic (same index → same code) so it's reproducible and testable, yet varied. `radio.sh` now sources each segment from it (with the gate-skip still as a safety net). Only allowlisted verbs + cached kits → every segment renders offline. **Tested:** `scripts/test-radio.sh` extended → **9/9** (incl. every evolved segment idx 0-7 passes the parse-gate, **8 distinct patterns over 8 segments**, deterministic). **Still P1:** derive from the *previous* segment (true transition model) + agent-generated segments + `acrossfade` joins + rolling-window playlist. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Phase-4 P0: continuous generative radio (`scripts/radio.sh`) — the marquee live-stream feature, first slice.** Pivot from reliability polish to building the live stream the brief asked for, on the now-solid offline render pipeline (no Supabase/Cloudflare needed). `radio.sh` renders a sequence of Strudel patterns → HLS audio segments (`.ts`/AAC via ffmpeg) and appends each to a live `.m3u8`, so a player hears an endless stream that keeps being created. Live runs omit `#EXT-X-ENDLIST` (players keep polling); `--max-segments` closes a bounded run as VOD. Renders **offline** from the cached packs; each stage **skips-not-aborts** so one bad segment can't kill the stream. **Tested:** new `scripts/test-radio.sh` → **6/6** (valid HLS header, 2 segments generated, ENDLIST on bounded run, playlist references the segments, each segment is real audio via ffprobe); added as a 5th suite to `scripts/test.sh`. Listen: `(cd <out> && python3 -m http.server 8123)` → `stream.m3u8` in ffplay/VLC/Safari. **P1:** evolution engine (each segment derived from the last) + agent-generated segments + rolling-window playlist. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Unified test runner + README reliability section (make the quality legible).** Eight iterations produced 4 scattered regression tests (cycle sizing, soul-examples, sync-API auto-repair, deliver auto-repair) with no single entry point — a teammate/judge couldn't discover or run them. New **`scripts/test.sh`** runs them all → **4 suites / 22 assertions**, deterministic (no LLM, no Discord, no `.env`; ~30 s of local Chromium renders). Clean split: `test.sh` answers *"is the code correct"*; `strudel-doctor.sh` answers *"is the live system demo-ready"* (deps/services/auth/render). Also brought the public README current: a new **Reliability** section (fully-offline rendering · self-healing on both surfaces · guarded soul examples + song-length sizing) with a how-to-verify, and fixed the stale doctor count (16/16 → 22/22). Verified: `./scripts/test.sh` → all 4 suites pass. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Fixed song-length sizing: mini-notation chords no longer inflate render length.** `strudel-cycles.sh` sizes a song's render to the SUM of its `arrange([bars, section], …)` bars (so a song isn't truncated or over-long). Bug found: a chord written as mini-notation `n("[0,4,7]")` inside a section was being counted as an arrange pair — its leading number inflated the length, so the song rendered over-long with a trailing repeat/silence. Fix: the pair regex now requires a **non-digit after the comma**, matching true `[bars, section]` pairs (sections are identifiers/expressions, never digit-first) but not `[n,n,n]` chords. New `scripts/test-cycles.sh` → **6/6** (soul SONG = 56; chord `[2,7,11]` no longer inflates → 16 not 18; loop → default; custom default; spaced pairs). `strudel-doctor.sh` gained a sizing check → now **22/22**. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Auto-repair on the Discord delivery path (the primary demo surface now self-heals).** Extends iter-3's sync-API repair to the channel path — the bigger reliability gap, since Discord `@mention → voice message` is the demo. `strudel-deliver.sh`'s parse-gate used to abort (`set -e`) when the agent posted invalid Strudel, so the watcher silently dropped the reply (no voice message). Now on gate failure it calls **`scripts/strudel-repair.sh`** (asks gpt-5.4 to fix the code + extracts the corrected block), re-gates, and delivers the repaired version — aborting only if the repair *also* fails (never delivers invalid code). Because the watcher renders via this same chain, the whole @mention path (and manual/API delivery) self-heals; cycles are re-sized from the repaired code for songs. `STRUDEL_REPAIR_CMD` makes the repair injectable for tests. **Tested:** new `scripts/test-deliver-repair.sh` stubs the repair (no LLM) → **4/4** (repair→valid renders; repair→invalid aborts without delivering); a **live** run fixed a real `[..]`-wrapped pattern → passes the gate. `strudel-doctor.sh` gained a "deliver path self-heals" check → now **21/21**. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Regression guard: the soul's Strudel examples must parse (`scripts/test-soul-examples.py`).** Pivot from the offline arc to generation-correctness. The agent is told to copy the soul's "bulletproof templates" verbatim, so an invalid example there ships as invalid output — *exactly* how the `.swingBy(1/3)` bug once reached the demo (build log below). New test extracts every fenced `javascript` block from `souls/hermes.SOUL.md` and runs each through the pure-node parse-gate (no LLM, ~1 s). All **3** soul templates (FULL GROOVE / MELODY / SONG) currently pass; the guard fails loudly if a future soul edit introduces a non-parsing example. `strudel-doctor.sh` runs it as a check → now **20/20**. (Reviewed via vibe-orchestrator.)
- **Jun 22 — dirt-samples core drums cached → rendering is now FULLY offline.** Completes finding #5: bare `bd/hh/sd/cp/…` (the most common drum syntax, no `.bank()`) previously fetched from `raw.githubusercontent.com` — the last network dependency at render time. `cache-samples.mjs` now also fetches the dirt `strudel.json`, filters to a curated core drum set, downloads them into gitignored `samples-cache/dirt/` (169 files), and writes a cache-local `dirt.json` (leading-slash `_base`). `render.html` loads dirt **local-first with a github fallback** (`loadFirst('dirt', ./dirt.json, github:…)`), and the static server serves `./dirt.json` from the cache when present (404 → github when absent, so online still works on a fresh clone). **Tested:** bare `bd/cp/hh` rendered with **all CDNs blocked** → `dirt ok` (was `dirt FAIL`), peak 255/255 non-silent; the doctor gained a dirt offline check → now **19/19**. Offline story complete: bundle ✓ + 909/808 ✓ + piano ✓ + dirt ✓, all render with no internet. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Offline DRUM samples: cache the 909/808 banks + piano locally (full-offline for the common case).** Closes most of finding #5's remaining gap — bundle-vendoring made *synth* patterns offline, but drum/piano WAVs still fetched from `raw.githubusercontent.com`, so a network blip silently dropped the drums (the most common element). New `render/cache-samples.mjs` downloads the soul's default kits — **RolandTR909 + RolandTR808 + piano** (~109 unique files, a few MB) — into a **gitignored** `render/samples-cache/` (same node_modules pattern: fetched by `setup.sh`, never committed), and writes cache-local sample maps with leading-slash `_base`. `strudel-render.mjs`'s static server transparently serves those cached maps in place of the remote-pointing vendored ones (render.html unchanged). **Tested:** a 909+piano pattern rendered with **all CDNs blocked** → non-silent (waveform **peak 255/255**, the dirt fetch provably aborted); `strudel-doctor.sh` gained an **"offline drums"** check that asserts the waveform peak (WAV byte-size can't distinguish silence) → now **18/18**. **Remaining:** dirt-samples (bare `bd/hh/sd`) is the last, larger pack to cache. (Reviewed via vibe-orchestrator.)
- **Jun 22 — Auto-repair retry on parse-gate failure (sync music API).** The roadmap's named reliability gap (Next-items #1): when gpt-5.4 emits Strudel that doesn't parse, `POST /generate` used to 422 and the caller got nothing back. Now `generate_valid()` re-prompts the agent with the **exact parse error + the broken code** and retries (default 2 attempts; `repair_attempts` overridable, capped at 4) before giving up — directly attacking the most frequent live failure ("the bot replied but it didn't play"). Kept surgical: extracted `gate_code()`, gave `render_code()` a `pre_gated` flag (skips the re-gate when the repair loop already validated), and left **`/render` deliberately un-repaired** (caller-supplied code → still 422 on invalid, never silently rewritten). **Tested** via a new deterministic harness `scripts/test-auto-repair.py` (real pure-node gate + an injected fake generator — no LLM needed): **8/8** incl. returns-the-fix, error-fed-back, valid-first-short-circuits, exhausted-raises-after-N, and `render_code` both paths render real audio; `py_compile` clean. (Diff reviewed via vibe-orchestrator.) ⚠ The live launchd `music-api` service still runs the old code until `launchctl kickstart -k gui/$(id -u)/com.zeroclaw.music-api` reloads it.
- **Jun 22 — Locked the offline-render guarantee into `strudel-doctor.sh` (now 17/17).** Yesterday's bundle-vendoring removed the esm.sh dependency, but nothing *asserted* it — a future edit re-pointing the import at a CDN would leave the doctor green while quietly re-introducing the #1 demo risk. Added an **"offline render" check** to the readiness gate: it renders a synth pattern with `STRUDEL_BLOCK_EXTERNAL=1` (all non-localhost requests aborted) and asserts a valid WAV, so a CDN regression now **fails** demo-prep. **Tested:** full doctor run → `17 passed, 0 failed` with the new check green (`renders with all CDNs blocked (705644 bytes — bundle is local)`); `bash -n` clean. (Diff reviewed via vibe-orchestrator.)
- **Jun 22 — Offline render hardening: vendored the `@strudel/web` bundle (killed the esm.sh CDN dependency).** `render/render.html` loaded the Strudel browser bundle from **esm.sh** — the one *hard* network dependency at render time (sample fetches are soft/caught, but a bundle-load failure blanks the *whole* render), and the roadmap's stated **#1 demo-reliability TODO** (render finding #5). Fix: import from `./node_modules/@strudel/web/dist/index.mjs`, served same-origin by the renderer's existing local static server (`node_modules` is gitignored and `setup.sh` already `npm install`s it → no AGPL bundle committed into this MIT repo, no repo bloat). Verified the dist bundle is self-contained (vite inlines the audio worklets; the only external asset, the clock worker, resolves relative to the bundle URL under `dist/assets/` — also served locally). Added an env-gated test hook **`STRUDEL_BLOCK_EXTERNAL=1`** in `render/strudel-render.mjs` (Playwright `page.route('**')` aborts every non-localhost request) so offline-readiness is verifiable + can join the doctor. **Tested:** (a) normal synth+909 render → 1.4 MB WAV, all sample packs load; (b) **fully network-blocked** synth render → 1.5 MB / **8.7 s real audio** (256-pt waveform, not silence) *while the dirt-samples CDN fetch was provably aborted* — proving the bundle is 100% local. **Remaining for full offline:** drum/sample **WAVs** still fetch lazily from `raw.githubusercontent.com`, so sampled patterns still need the network — vendoring those is the next step. (Diff independently reviewed via vibe-orchestrator.)
- **Jun 22 — Roadmap: added Phase 3 (Cloudflare migration) + Phase 4 (continuous live stream).** Two new sections, grounded against current Cloudflare docs (via the `cloudflare` skill + a `cloudflare-deployment-expert` pass). **Phase 3 — off the laptop:** maps the local stack to the edge — **Worker** (+ Agents SDK) for the gateway/orchestrator, a per-session **Durable Object** for the modify chain, **Containers** for the headless-Chromium render + ffmpeg (**Browser Rendering is NOT viable for audio** — no custom flags / no audio device / no Blob exfil), **Queues** for render dispatch, Supabase → **D1/R2/Vectorize**, cron → **Cron Triggers**, OpenAI behind **AI Gateway**; Discord via the **Interactions webhook** (defer<3s → `waitUntil` → follow-up REST, retiring the poll-watcher). Hard blockers flagged: container cold-start, **Discord voice = UDP = impossible on CF** (needs an external relay), D1 10 GB cap (retention cron), Agents SDK GA unconfirmed. **Phase 4 — generative radio:** an always-on, continuously-composed, evolving stream via a **lookahead buffer** — a DJ Durable Object (`scheduleEvery`) derives each next SongSpec from the last (evolution engine over the modify vocab, key/tempo-coherent crossfades), renders HLS segments to **R2**, a Worker serves the rolling `.m3u8` with a short edge-cache TTL (rolling-HLS, not the video-centric Cloudflare Stream). **Dead-air protection** (K=2 + fallback ladder: re-loop → evergreen → fill) is the reliability spine. Local-first P0, then lift to CF. Design only — not built.
- **Jun 21 — Verified song composition from a PROMPT (Phase-2 Tier-A, agent level).** Asked the live gpt-5.4 agent for "a full song — intro/verse/chorus/outro — chill house"; it composed a valid 30-line `arrange()` program (`const` sections, correct `.swing(4)`), auto-sized to 24 cycles → **rendered the full ~47 s** song, mean −18.5 dB. So the marquee song feature works prompt→audio, and the soul's existing "Songs" directive drives it correctly (no edit needed). Also confirmed **delivery**: a 48 s song through `strudel-deliver.sh` → a **233 KB Opus/OGG** voice-message payload (well within Discord limits; the soul correctly omits the >2000-char play-link for songs). Pairs with the vocals verification below — both Phase-2 capabilities now confirmed end-to-end.
- **Jun 21 — Verified the two marquee features end-to-end (roadmap).** **(a) Vocals:** `render/voice-deliver.sh` → beat render + **OpenAI TTS** ("ash") of a line → `voice-mix.sh` over the beat → 6 s ogg. Works (`--say` verbatim; `--auto` authors a hook via gpt-5.4-mini). **(b) Phase-2 Tier-A song:** a 4-section `arrange([4,intro],[8,verse],[8,chorus],[4,outro])` auto-sized by `strudel-cycles.sh` to 24 cycles → **rendered the full 48 s** (not cut to the intro), mean −17.7 dB. So the render+deliver pipeline already supports both songs and vocals; the open part is the **agent composing** them (soul directives), which is your in-flight work. README "From a loop to a song" now shows both as copy-paste verified examples.
- **Jun 21 — Pitch deck (`docs/slides.html`).** A self-contained 8-slide deck for the presentation, styled as the Strudel live-coding console (monospace display, `▸` prompt chrome, syntax-highlit code, a generated waveform hero — amber/magenta on dark indigo). Slides: title → the black-box problem → what it does (3-part reply + real code) → the local pipeline → loop→song + the measured section arc → **our process** (soul → gate → model fallback → render → ship) → resilient-by-design → try-it/close. No external assets (CSP-safe); arrow/space nav. Linked from the README; published as a Claude artifact. **PDF fallback** for offline presenting at `docs/slides.pdf` — `scripts/slides-to-pdf.mjs` renders it via the installed headless Chromium (print-CSS paginates one slide per page, dark background preserved; 8 pages).
- **Jun 21 — README: "From a loop to a song" musical model.** New section explaining the build path — a Strudel **loop** → labeled loops as **sections** (intro/verse/chorus/outro, energy via layers+filter not just volume) → **merge/multi-layer** into a song via `arrange()` or rendered stems + `ffmpeg` → **vocals via OpenAI TTS** where wanted (`render/VOICE-LAYER.md`). Anchored with a **measured section-dynamics table from a real ~48 s render** (chorus ~19 dB louder + brighter = the textbook arc), tying the output back to the song-anatomy theory.
- **Jun 21 — README lets anyone try the live bot.** Added a prominent **"🎧 Try it live (Discord)"** section near the top: a one-click **invite link** for `zeromusicbot#0169` (`client_id 1518359851024126132` — public, fetched from `/oauth2/applications/@me`; permissions = view+send+read-history+attach = 101376), how to `@mention` it, and a clear **"⏳ temporary demo — runs on a laptop, may be offline"** caveat. Also fixed lingering stale **"Mistral"** references (Usage + Verified) → gpt-5.4.
- **Jun 21 — Demo runbook for the 20:00 presentation (`docs/DEMO.md`).** The ship-gate is the final presentation, and there was no script for it. Added a tight runbook: 15s pitch, a 2-min pre-demo check (`strudel-doctor.sh` → 16/16, pre-warm the renderer, ready a backup clip), a 4-beat live demo (generate → "it's real code" via the strudel.cc link → modify by talking → the HTTP API one-liner → close), a backup plan for each failure mode (render flake → backup clip / link; Discord hiccup → API; model 429 → fallback; watcher down → kickstart), and the judging emphasis. Verified demo-ready first: **16/16 ✓** (the smoke test also confirms the in-flight cycles/deliver auto-sizing doesn't break the pipeline). Linked from the README.
- **Jun 21 — Fresh-clone setup + pointed all docs at the canonical repo.** Added `scripts/setup.sh` (idempotent: checks node/ffmpeg/python + zeroclaw, `npm install` both render engines, Playwright Chromium, creates `.env` from the template) — so a clone goes setup → edit `.env` → `install-services.sh` → `doctor`. README gained a **Quickstart** + a top "Repository — commit here" banner; this roadmap + the README + the `llms-local` mirror now all point to **https://github.com/gitayam/riff-music-bot** as the place to commit (the monorepo copy is a historical mirror).
- **Jun 21 — Made the launchd services portable (clone-and-run).** The committed plists hardcoded one machine's absolute path, so a cloned repo couldn't start the services. Added `scripts/install-services.sh`, which **generates** the three plists rooted at wherever the repo lives (+ `$HOME`) and loads them — `./scripts/install-services.sh` (or `--uninstall`, or `--generate DIR` to just inspect). Verified: generated plists pass `plutil -lint`, paths are repo-relative, and the live services were untouched (used `--generate`, not a reload). README's launchd section rewritten to the one-command install (covers all three services). Now anyone can clone `riff-music-bot` and bring the stack up on their own machine.
- **Jun 21 — Extracted as a standalone repo + published for the Sundai submission.** `zeroclaw/` is now its own git repo (kept in place so the live launchd services keep working), made self-contained (docs copied in, README links fixed), MIT-licensed. **Secret hygiene:** hard-scanned all tracked content before any commit/push — `.env` stays gitignored (confirmed not on the remote), and the frontend team's Supabase publishable key + project URL were redacted from this copied roadmap. Pushed **public** to **https://github.com/gitayam/riff-music-bot** (default branch `main`). 41 files, no keys committed.
- **Jun 21 — README brought current with the shipped system.** It still said "wired to Mistral" and "① a one-click play link" — stale by ~10 features. Fixed the LLM line (gpt-5.4 + fallback) and the reply description (now auto-delivers a 🎙️ voice message), and added a **"Capabilities & services"** section: the end-to-end chat flow, the HTTP music API (`/generate`, `/render`), the **three launchd services** (table), and the local render pipeline + doctor. A teammate or judge reading `zeroclaw/README.md` now actually sees what was built. (README was clean/committed — no in-flight edits clobbered; the in-flight vocals feature on `strudel-watch.py` left untouched.)
- **Jun 21 — Music API made always-on (launchd) — third persistent service.** `com.zeroclaw.music-api.plist` runs `scripts/api-server.sh` (sources `.env`) so the sync API is up without a terminal — joining the daemon + watcher as a managed service. `MUSIC_API_TOKEN` added to `.env` (reuses the tunnel bearer = one credential for all ZeroClaw access; gitignored, not committed). **Verified through the live service:** `state = running`, `/health` ok, `POST /generate "upbeat funky disco loop"` → 158KB mp3 + code + share_url, unauthenticated POST → 401. `strudel-doctor.sh` now checks all three services (**16/16 ✓**). To reach it externally: `cloudflared tunnel --url http://localhost:8799`.
- **Jun 21 — Built the SYNC music API (`scripts/api-server.py`) — other groups can now generate music over HTTP.** Closes the `/webhook`-times-out gap with a real request/response service (stdlib only, no deps). `POST /generate {prompt}` → gpt-5.4 composes → parse-gate → faithful render → ffmpeg → returns `{strudel_code, share_url, format, audio_base64}` in one call; `POST /render {code}` skips the LLM; `GET /health` + self-documenting `GET /`. Bearer-auth on POST (`$MUSIC_API_TOKEN`; 401 without). **Verified live:** "a chill lofi loop" → 80bpm pattern + 12s mp3; raw code → 157KB mp3; invalid code → 422; missing token → 401. Binds `127.0.0.1:8799` (8787 was held by `workerd`); expose with `cloudflared tunnel --url http://localhost:8799`. Launcher `scripts/api-server.sh` sources `.env`. This is the thing the tunnel needed to be a real music API, not just a trigger.
- **Jun 21 — Exposed ZeroClaw via a protected Cloudflare quick tunnel (external API) + tested it.** New "External API access" section above. The local gateway is now reachable at a public `trycloudflare.com` URL behind `Authorization: Bearer <token>`. **Tested live:** `GET /api/status` / `/api/channels` / `/metrics` / `/health` all work and are bearer-gated (401 without it). **Key finding:** `POST /webhook {"message":…}` processes the prompt **async** (trace: `llm_request → reply delivered`) but the HTTP call **408s at 30s with no body** — the reply goes to the agent's channel, not the caller, so it's not a sync music API. The proven external path is the Discord/SimpleX channels (auto-voice-delivery); `/ws/chat` (WebSocket) is the likely sync interface (untested — no client lib). TODO logged: a dedicated sync `prompt → {code, link, audio}` endpoint. Token kept out of git (referenced as `$ZEROCLAW_API_TOKEN`); quick-tunnel URL is ephemeral.
- **Jun 21 — Auto-delivery confirmed with REAL traffic + doctor hardened.** Verified live: a real user (`@psayduck`) request flowed end-to-end — bot text+code reply (`…915820`) → the watcher auto-posted a 🎙️ voice message (`…094359`, 10.9s) with no manual step. Closed the gap that caused the "didn't work": `strudel-doctor.sh` now checks the **watcher** service too (not just the daemon) and **fails loudly** if it's down (replies-go-text-only was the exact failure mode). Now 15/15 ✓.
- **Jun 21 — FIXED "it didn't work": auto-delivery is now LIVE + persistent.** Root cause: the daemon (gpt-5.4) was replying with valid Strudel (7 queued in-channel) but `strudel-watch.py` was never running with `--send`, so nothing rendered/posted. Fix: **(1)** posted a real voice message for the latest reply — full chain verified live on Discord (gate → faithful Chromium render → Opus/OGG → 3-step upload → **voice message id `…875850`**, a dark-techno A-phrygian clip). **(2)** Made the watcher a launchd service: `com.zeroclaw.strudel-watch.plist` + `scripts/watch.sh` (sources `.env`, `python3 -u` for live logs), mirroring the daemon agent — so every future `@mention` auto-delivers. Armed the high-water past the backlog (no 7-message flood). Confirmed running (`state = running`; log: `watching 1 channel(s) … send=ON` every 8s; manual dry-run = 0 candidates). The bot now does **@mention → text+code → 🎙️ voice message** end-to-end, persistently. *(The missing piece all along was an unstarted process — the pipeline itself was sound.)*
- **Jun 21 — Designed Phase 2: song composition (multi-loop → full song).** New section above ("Phase 2 — Song composition"). Sequenced **after render** (render-to-audio is what unlocks combining/sound-editing). Two realization tiers from one **SongSpec** (extends MusicSpec): **Tier A** = Strudel-native `arrange([bars, section],…)` of reusable loop consts with per-section energy (one render; worked example = `ABABCB`, ~2:08); **Tier B** = render section/stem WAVs → `ffmpeg` assemble (`acrossfade`/`afade`/`amix`/`loudnorm`+`alimiter`) for real crossfades, fade in/out, layering, master — and the only path to blend Strudel renders with Stable Audio renders. Agent decomposition: song-architect → parallel section composers → render → audio-assembler. Reliability notes (compose from render-gated parts, K=2, lock SongSpec first) + the Discord 2000-char limit (full songs deliver as the audio file, not inline code). Design only — not built.
- **Jun 21 — Pipeline health-check (`scripts/strudel-doctor.sh`) — one-command demo-readiness.** Read-only (posts nothing; only `GET /users/@me`). Verifies the whole voice pipeline: node / ffmpeg+libopus / python; both render engines + Chromium; the parse-gate (valid→pass, `[...]`-wrap→reject); soul present + help menu + model fallback; Discord bot auth; daemon running; and a **full-chain smoke test** (gate → faithful Chromium render → ogg → waveform, ~15s). Run: `( set -a; . ./.env; set +a; ./scripts/strudel-doctor.sh )`. **Current: 14/14 ✓ — demo-ready.**
- **Jun 21 — Model fallback chain wired (bot is no longer a single point of failure).** ZeroClaw supports native provider fallback, so `config.toml` `[providers.models.openai.gpt5]` now has `fallback_models = ["gpt-5.4-mini"]` (cheaper/faster, same OpenAI key) + `fallback = ["mistral.hermes"]` (cross-provider last resort — repurposes the previously-dead Mistral block). **Verified live:** normal reply via gpt-5.4; then forced the primary to a bogus model via a one-shot env override and the agent **still answered** — fallback triggers. Reloaded the daemon (config valid, gateway healthy). Resolves the flagged "a single gpt-5.4 hiccup hard-fails the bot" risk. (`config.toml` edited on disk + live; left uncommitted as it's user-managed — commit `zeroclaw/` wholesale when ready.)
- **Jun 21 — Repointed deliver pipeline to the FAITHFUL render (Option A) + fixed a gate regression.** Completed the handoff: `scripts/strudel-deliver.sh` now renders via `render/strudel-render.mjs` (engine of record — real strudel.cc audio: dirt/909/808 samples, piano, true `.room`/`.delay`/`.lpf`), with a `timeout 150` + one retry (Chromium can flake/cold-start) and an `ffmpeg alimiter` true-peak limiter (Option A renders hit 0 dBFS). **Found a regression:** Option A renders *silence* for invalid code instead of failing, so I made the pure-node `scripts/render/render.mjs` the fast pre-render **parse-gate** (exits 1 on `[...]`-wrap / non-pattern) — verified bad code aborts at stage 2a, before the Chromium render/transcode/deliver, while good code renders+delivers (dry-run, auth'd `zeromusicbot`). Reverted my now-moot Option B reverb/delay edits (B's audio is discarded in gate-only use). `swingBy` in the soul was already the prior session's fix — no action. ⚠ **`zeroclaw/render/` is untracked** — commit it (source only; `node_modules` gitignored) so the pipeline is coherent for the team.
- **Jun 21 — Strudel validity + clickable-link fix (team-investigate) → new `docs/strudel-zeroclaw-lessons.md`.** Diagnosed two live failures with evidence. **(a) Mistral** `[mini] parse error … "*" found`: decoded link was `[...]`-wrapped with `.saturate("bass")`, `sound("*hx")` (leading `*` = the parse error), a `G:mxidyd` typo, and base64 that **didn't match the shown code** — all of which the soul *already* bans; a weak model just ignores the rules. **(b) GPT-5.4** `Error: .swingBy() expects 2 inputs but got 1` — root cause was **the soul itself listing `.swingBy(1/3)` (1-arg) as a "valid" example**; `swingBy` needs 2 args. Fixed the soul → `.swing(n)` (3 spots) + hardened the `[...]` ban. **Clickable links restored:** *measured* GPT-5.4 base64 is byte-for-byte exact even at 666 chars (Mistral's wasn't), so the soul now has Riff emit `▶ Play: https://strudel.cc/#<base64>` + the code block as fallback — verified the emitted link decodes to the code exactly; works on Discord + SimpleX with no post-processor. Confirmed **gpt-5.4 is genuinely live** (trace cutover to `openai.gpt5`; key lists it; resolves to snapshot `gpt-5.4-2026-03-05`). Restarted the launchd bot. New companion doc consolidates every field gotcha (banned-fn table, `[...]` trap, mini-notation rules, zeroclaw runtime constraints, the two guards). ⚠ dead `mistral.hermes` block remains in `config.toml` with **no fallback** wired → a gpt-5.4 outage hard-fails; add a `gpt-5.4-mini` fallback.
- **Jun 21 — Built the FAITHFUL render (Option A) → chosen as engine of record.** A second session built the headless-Chromium render in `zeroclaw/render/` that produces the *real* strudel.cc audio (true 909/dirt samples, real `piano`, real `.room()`/`.delay()`/`.lpf`), in parallel with the existing pure-node synth render (`scripts/render/render.mjs`, Option B). **User picked A** — the demo's value prop is "real music, not a black box," which B's synthesized approximation undercuts. Mechanism: Playwright loads `render.html` (imports `@strudel/web@1.3.0`), evaluates the pattern, and `renderPatternAudio()` renders through an `OfflineAudioContext` and emits a WAV via a blob download which the driver **captures with Playwright's `download` event**. Verified audible for synths + dirt drums + 909/808 banks + piano. Solved the non-obvious blockers: 1.3.0 (not 1.2.0) exports `renderPatternAudio`; `evaluate()` returns the Pattern directly; default prebake loads **synths only** (drums silent until `samples(...)`); the drum-machine repo moved (`ritchse`→`geikha`) and strudel.cc's map has no CORS → **vendored `tidal-drum-machines.json` + `piano.json` with `_base` re-pointed at CORS-enabled github raw**. Files: `render/{strudel-render.mjs, render.html, strudel-waveform.mjs, *.json}` (`render/node_modules` gitignored via `render/.gitignore`). **Remaining (handoff to the active session):** repoint `scripts/strudel-deliver.sh` from B to `render/strudel-render.mjs` (CLI: code on stdin, `[cycles]` not seconds); add K=2-retry/timeout around the render; add an ffmpeg limiter for clip safety; vendor/bundle `@strudel/web` for full-offline demo reliability (currently loaded from esm.sh CDN). *(Built in a separate session per the parallel-agent clobber rule — different dir, no shared-file writes; this session is stopping after this handoff.)*
- **Jun 21 — Auto-delivery handoff built — pipeline is end-to-end (pending go-live).** `scripts/strudel-watch.py` polls Discord (REST-only, same bot token, no gateway/config changes) for the bot's own `​```javascript` replies and posts a rendered voice reply via `strudel-deliver.sh`. Per-channel high-water mark = no history replay. Verified live (dry-run) as `zeromusicbot`: auth + channel discovery + message fetch + arming all work; needed a real `User-Agent` header (Discord 403s default urllib UA). Chosen over an agent-tool because the tool wouldn't know the `channel_id` and it needs no zeroclaw internals. To go live: `python3 scripts/strudel-watch.py --loop 8 --send` next to the daemon. Only the final visible `--send` post is unverified (held as outward-facing).
- **Jun 21 — Built the RENDER KEYSTONE + deliver chain (local audio works).** `scripts/render/render.mjs` renders Strudel → WAV **headless, pure-node** — `@strudel/{core,mini,transpiler,tonal}` query the pattern's haps, then a small oscillator/drum synth writes them into `node-web-audio-api`'s `OfflineAudioContext`. No browser. Verified: real non-silent audio (peak ~0.65, mean −27 dB) for lofi/funk/house patterns. **Bonus: it's the real parse-gate** — invalid code (`[...]`-wrap, syntax errors the heuristic linter can't see) exits 1 instead of rendering. `scripts/strudel-deliver.sh` chains lint → render(gate) → ffmpeg Opus/OGG → `discord-voice.sh`; verified end-to-end as a dry-run (auth'd `zeromusicbot`, payload built, nothing posted). **Gotcha logged:** `@strudel/*` must be pinned **exactly `1.1.0`** — 1.2.x imports `SalatRepl` from `@kabelsalat/web` and won't load in node (`npm install` in `scripts/render/`; `node_modules` gitignored). Remaining for full auto-delivery: the zeroclaw→worker handoff (channel_id + queue).
- **Jun 21 — Live bot fixed: switched generation to OpenAI `gpt-5.4`.** The running daemon was 429-ing every request on stale Mistral config. `config.toml` already pointed `agents.hermes` at the `openai.gpt5` provider (`gpt-5.4`) + `run.sh` injects `OPENAI_API` — it just needed `launchctl kickstart -k` to reload. Verified post-reload: generation works (no rate-limit) and emits clean, lint-passing Strudel in the correct paste-and-play format. Resolves the Mistral-quota risk.
- **Jun 21 — Built the Discord voice-message DELIVERY half** (steps 2–4 of the pipeline). `scripts/strudel-waveform.py` (audio → base64 `waveform` ≤256B + `duration_secs`, via ffmpeg→raw PCM since `audioop` is gone in py3.14) and `scripts/discord-voice.sh` (the 3-step REST flow, **dry-run by default**, `--send` to post). Verified end-to-end with an ffmpeg test tone: WAV→Opus/OGG→real waveform→payload, and the bot token **authenticates against the live bot `zeromusicbot`**. Held the visible post (outward-facing — needs a `channel_id` + `--send`). Remaining: the render keystone (`strudel-render`) + the `strudel-deliver` chain + zeroclaw→worker handoff.
- **Jun 21 — Spec'd local render → Discord voice-message delivery** (see section above). Researched both halves: local Strudel→audio render (headless-browser `OfflineAudioContext`, or pure-node `@strudel/*` + `node-web-audio-api`) → `ffmpeg` Opus/OGG; and the verified Discord bot voice-message REST flow (`flags: 8192`, one audio attachment, base64 `waveform` ≤256B + `duration_secs`, no text). Added pipeline, per-step API shapes, a needs-checklist, and MVP→full phasing. Bot stays local. Not yet built — top of the queue.
- **Jun 21 — Strudel validity fix (the bot's output didn't play).** Live bot returned non-playing patterns: hallucinated functions (`.saturate()`, `.reverb(true)`, `sound("newpiano")`, `.ren()`), syntax errors (`.swingBy(0).15` → `Unexpected token`, trailing comma after `setcpm`, `[...]`-array wrapping), and a **hand-fabricated base64 share-link that didn't even match the shown code**. Root cause = a weak model can't be trusted to emit valid code OR encode base64. Fixes: (1) soul now **never writes `#`-links** — it returns clean multi-line code + "paste into strudel.cc"; the link is built deterministically by `scripts/strudel-link.sh` (verified round-trip), (2) hardened Strudel syntax contract — function allowlist, expanded ban list (`saturate`/`reverb`/`ren`/`newpiano`…), template-first, no floating decimals/trailing commas, (3) `scripts/strudel-lint.sh` heuristic guard (catches the real hallucinations; verified against the failed output), (4) researched + confirmed real functions (`.room()` not `.reverb()`, no `.saturate()`) and the share-URL format. **Restarted the launchd bot** (`com.zeroclaw.hermes`) so the fresh soul reaches Discord/SimpleX. ⚠ Live generation verification is **pending** — Mistral hit 429 rate-limits during testing (shared key quota); the running bot is degraded for the same reason until quota recovers.
- **Jun 21 — Bot discoverability / help menu.** The bot had no capability surface — a user mentioning it had no idea it makes music. Added a deterministic **`help` / "what can you do?" menu** to the soul (returns genres · occasions · moods · modify verbs · the 3-part reply format) and a **"What the bot does"** section to `zeroclaw/README.md`. Verified live: `./run.sh agent -a hermes -m "help"` returns the menu. Channel-agnostic (works on Discord + SimpleX since it lives in the soul).
- **Jun 21 — Music brain.** Soul rewritten as "Riff" the music director (3-part reply contract, genre defaults, transform table); tracked `souls/hermes.SOUL.md` synced into the workspace by `run.sh`. Cited theory deep-dive `docs/music-theory-for-zeroclaw.md` (chords/progressions/modes/BPM/structure + per-genre Strudel recipes). Supabase + Modal env wired into `.env`/`.env.example`.
- **Jun 21 — Roadmap.** Architecture, 5 interface contracts, Strudel deep-dive, timeline, demo script.

### Next impact items (candidates)
1. **✅ DONE — Real parse/validate gate + local render.** `scripts/render/render.mjs` parses via `@strudel/{core,mini,transpiler,tonal}` and renders to WAV via `node-web-audio-api` `OfflineAudioContext`; invalid code exits 1 (the gate). **Remaining:** wire it into the reply path so the agent's code is rendered+validated automatically (the zeroclaw→worker handoff below), and an auto-repair retry on gate failure (**✅ DONE Jun 22** in the sync API — `generate_valid()` re-prompts gpt-5.4 with the parse error and retries; see build log).
2. **✅ DONE — model switched to OpenAI `gpt-5.4`** (was 429-ing on Mistral). Emits valid, creative multi-layer Strudel reliably.
2b. **✅ DONE — zeroclaw → worker handoff** via `scripts/strudel-watch.py` (REST-poll the bot's own replies → deliver chain). Chosen over the agent-tool path because (a) the agent tool wouldn't know the `channel_id`, (b) it avoids editing `config.toml`/risk-profiles, and (c) it needs no zeroclaw internals. **Go-live:** `( set -a; . ./.env; set +a; python3 scripts/strudel-watch.py --loop 8 --send )` alongside the daemon — that completes the full automatic loop (@mention → text+code → voice message). One real `--send` post is the only unverified link (held as outward-facing).
3. **Deterministic link in the pipeline.** `scripts/strudel-link.sh` is built; wire the dashboard/bot post-step to encode validated code → `strudel.cc/#` link so users get one-click play without the LLM ever touching base64.
4. **Tier-B render → Supabase** so replies carry a real audio file, not just code+link (uses the node stack from #1).
```
