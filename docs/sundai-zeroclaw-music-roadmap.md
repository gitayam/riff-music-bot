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
5. `render.html` loads `@strudel/web` from the **esm.sh CDN**, so a network blip breaks rendering. Full-offline hardening (vendor/bundle the web bundle + cache the wavs) is the top TODO for demo reliability.
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

## Build log
*Running record of what's shipped, newest first. Updated each work iteration.*

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
1. **✅ DONE — Real parse/validate gate + local render.** `scripts/render/render.mjs` parses via `@strudel/{core,mini,transpiler,tonal}` and renders to WAV via `node-web-audio-api` `OfflineAudioContext`; invalid code exits 1 (the gate). **Remaining:** wire it into the reply path so the agent's code is rendered+validated automatically (the zeroclaw→worker handoff below), and optionally an auto-repair retry on gate failure.
2. **✅ DONE — model switched to OpenAI `gpt-5.4`** (was 429-ing on Mistral). Emits valid, creative multi-layer Strudel reliably.
2b. **✅ DONE — zeroclaw → worker handoff** via `scripts/strudel-watch.py` (REST-poll the bot's own replies → deliver chain). Chosen over the agent-tool path because (a) the agent tool wouldn't know the `channel_id`, (b) it avoids editing `config.toml`/risk-profiles, and (c) it needs no zeroclaw internals. **Go-live:** `( set -a; . ./.env; set +a; python3 scripts/strudel-watch.py --loop 8 --send )` alongside the daemon — that completes the full automatic loop (@mention → text+code → voice message). One real `--send` post is the only unverified link (held as outward-facing).
3. **Deterministic link in the pipeline.** `scripts/strudel-link.sh` is built; wire the dashboard/bot post-step to encode validated code → `strudel.cc/#` link so users get one-click play without the LLM ever touching base64.
4. **Tier-B render → Supabase** so replies carry a real audio file, not just code+link (uses the node stack from #1).
```
