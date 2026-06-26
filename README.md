# zeroclaw (local)

Local install of [zeroclaw](https://github.com/zeroclaw-labs/zeroclaw) — a Rust
agent runtime / personal AI assistant. Generation runs on **OpenAI GPT-5.4**
(automatic fallback: gpt-5.4-mini → Mistral), reachable over **Discord** (native)
and **SimpleX** (via a local bridge, since zeroclaw has no native SimpleX channel).

> 📦 **Repository — commit / open PRs HERE:** <https://github.com/gitayam/riff-music-bot>
> This is the canonical repo. It was extracted from a monorepo; any copy living under
> `llms-local/` is a historical mirror — **do not commit there.**

## 🎧 Try it live (Discord)

**Add the bot — `zeromusicbot#0169`** — to a server you can post in, then `@mention` it:

**➕ [Add zeromusicbot to your server](https://discord.com/oauth2/authorize?client_id=1518359851024126132&scope=bot&permissions=101376)**

```text
@zeromusicbot make a chill lofi loop
```

It replies with the Strudel code + a strudel.cc play link, and a few seconds later posts a
🎙️ **voice message** of the track. Try follow-ups — *"darker, add a bassline"*,
*"give me 3 variations"* — or **`@zeromusicbot help`** for the menu.

> ▶ **Now hosted off-laptop (2026-06):** the bot moved from the hackathon laptop to a small
> always-on stack — a **Cloudflare Worker** (`riff-music-api`) for compose/orchestration and a
> **self-hosted Proxmox** box for the audio renderer + agent (see *Production topology* below). The
> Quickstart / launchd setup here still works for **self-hosting** on a Mac. If the bot doesn't
> answer it's a transient outage, not "the laptop is closed."

## What the bot does — "Riff", the music director

The `hermes` agent runs a music-director persona — **Riff**, defined in
[`souls/hermes.SOUL.md`](souls/hermes.SOUL.md). Talk to it on Discord or SimpleX and it
turns plain-language requests into music: it replies with the **Strudel code + a
`strudel.cc` play link**, and the auto-delivery watcher renders the track locally and
posts a **🎙️ voice message** of it in the channel (see *Capabilities & services* below).

Say **`help`** (or "what can you do?") in chat to get the menu. In short:

- **a genre** — *"make a chill lofi loop"*, *"funky disco, 120 bpm"*, *"dark techno"*
- **an occasion** — *"a victory fanfare"*, *"intro music for our call"*, *"hype-up track"*
- **a mood** — *"something happy"*, *"sad and slow"*, *"dreamy ambient"*

…then **shape it** in follow-ups: *faster / slower · darker / brighter · add a bassline ·
drop the hats · make it major · use a 909 kick · give me 3 variations*. Ask *"how would you
make a house beat?"* and the annotated code is the lesson.

The music brain is `souls/hermes.SOUL.md` (synced into the agent workspace by `run.sh` on
launch); the full cited theory + per-genre Strudel recipes are in
[`docs/music-theory-for-zeroclaw.md`](docs/music-theory-for-zeroclaw.md). Project plan:
[`docs/sundai-zeroclaw-music-roadmap.md`](docs/sundai-zeroclaw-music-roadmap.md).

## Production topology (2026-06) — hosted off-laptop

The hackathon demo is now a small always-on stack; the laptop is no longer in the request path.
(The Quickstart / launchd setup below still works for **self-hosting** on a Mac.)

- **Cloudflare Worker `riff-music-api`** (`worker/`) — the edge orchestrator: prompt → gpt-5.4 →
  validated Strudel → `strudel.cc` link, the Discord interactions webhook, cross-session history (D1),
  rendered audio (R2), and a per-session modify chain (Durable Object). `GET /health` is live; deploy
  with `cd worker && npx wrangler@4.103.0 deploy`.
- **Render service on Proxmox** (`container/server.mjs`) — headless-Chromium + ffmpeg, called by the
  Worker over a Cloudflare tunnel, bearer-gated on `/render` (open `/health`). It wraps the *same*
  faithful engine (`render/strudel-render.mjs`) used locally. Moved off Cloudflare Containers to cut idle compute.
- **hermes + strudel-watch on Proxmox** (systemd `zeroclaw-hermes` / `zeroclaw-strudel-watch`) — the
  Discord @mention agent and the 🎙️ voice-message delivery watcher, migrated off the Mac launchd services.
- **Render-reliability ratchet** (`scripts/render-corpus.mjs`) — runs a seeded corpus through the real
  offline engine and reports `corpus-render-failures`; a post-compose sanitizer (`worker/src/sanitize.js`),
  a tightened compose prompt, and a render-422 repair loop took that count to 0. See
  [`docs/reliability-roadmap.md`](docs/reliability-roadmap.md).

One line: **Discord → CF Worker (compose) → Proxmox render (audio) → R2 / Discord** — laptop out of the path.

## Quickstart (from a fresh clone · macOS / Apple Silicon)

```bash
git clone https://github.com/gitayam/riff-music-bot && cd riff-music-bot
./scripts/setup.sh              # npm deps (both render engines), Playwright Chromium, ffmpeg check, creates .env
# → edit .env: MISTRAL_API_KEY / OPENAI_API / DISCORD_BOT_TOKEN / DISCORD_GUILD_ID / MUSIC_API_TOKEN
./scripts/install-services.sh   # generate + start the 3 launchd services (daemon + watcher + music-api)
./scripts/strudel-doctor.sh     # verify everything (aim for all ✓)
```

You also need the **zeroclaw runtime** (the Rust binary) on your `PATH` — see
[zeroclaw-labs/zeroclaw](https://github.com/zeroclaw-labs/zeroclaw).

> 🎤 **Presenting / demoing it?** Follow the [**demo runbook**](docs/DEMO.md) — live script, backup plan, and what to emphasize.
> 📊 **Pitch deck:** [`docs/slides.html`](docs/slides.html) (self-contained — open in a browser; arrow keys / space to advance) · [**PDF fallback**](docs/slides.pdf) for offline presenting. Regenerate the PDF with `node scripts/slides-to-pdf.mjs`.

## Capabilities & services

**End-to-end music in chat:** `@mention` (or DM) the bot → it replies with the Strudel
code + a `strudel.cc` play link, and the **auto-delivery watcher renders the track locally
and posts a 🎙️ voice message** in the same channel. Follow-ups ("faster", "darker", "add a
bassline", "give me 3 variations") edit the pattern and re-deliver.

**HTTP music API (other groups' backends):** a synchronous service —
`POST /generate {"prompt":"funky disco loop"}` → `{strudel_code, share_url, audio_base64}`
(mp3/ogg/wav); `POST /render {"code":…}` skips the LLM; `GET /` self-documents. Bearer-auth.
Expose with `cloudflared tunnel --url http://localhost:8799`. See [`scripts/api-server.py`](scripts/api-server.py).

**Three always-on launchd services** (verify all at once with `./scripts/strudel-doctor.sh`):

| Service | Role | Launcher |
|---|---|---|
| `com.zeroclaw.hermes` | the bot daemon (gpt-5.4 + fallback) | `run.sh daemon` |
| `com.zeroclaw.strudel-watch` | renders bot replies → 🎙️ voice messages | `scripts/watch.sh` |
| `com.zeroclaw.music-api` | HTTP `prompt → {code, audio}` for other groups | `scripts/api-server.sh` |

**Local render pipeline** (no cloud): `scripts/strudel-deliver.sh` chains parse-gate →
faithful headless render (`render/strudel-render.mjs`, real strudel.cc samples) → Opus/OGG
→ voice message. `scripts/strudel-doctor.sh` is a one-command pre-demo health check.

## Reliability (built to survive a live demo)

Hardened so the demo works even on flaky conference wifi:

- **Fully-offline rendering.** The `@strudel/web` bundle and the common sample packs (909/808
  drum machines, piano, and core dirt-samples drums) are cached locally — a network blip can't
  blank a render. `(cd render && node cache-samples.mjs)` populates the cache (setup.sh does it);
  proven by rendering with every CDN blocked.
- **Self-healing generation, both surfaces.** If the model emits Strudel that doesn't parse, it's
  auto-repaired — the agent is re-prompted with the exact parse error and retried — on the **HTTP
  API** (`/generate`) *and* the **Discord** path (`strudel-deliver.sh`). Invalid code is never
  delivered; the parse-gate is the wall.
- **Guarded examples & song length.** The soul's own template examples are checked against the
  parse-gate (so the model never learns an invalid pattern), and `arrange()` songs are sized to
  the sum of their section bars (so a song never renders truncated or over-long).

**Verify it:**
- `./scripts/test.sh` — the regression suite (cycle sizing · soul examples · auto-repair ×2),
  deterministic, no keys needed (~30s).
- `./scripts/strudel-doctor.sh` — one-command live demo-readiness check (deps, render engines,
  offline render, services, auth, full-chain smoke).

## From a loop to a song (the musical model)

Riff builds music the way a producer does — **in layers and sections, not one giant blob:**

1. **A loop is the unit.** One `stack(...)` of parts (kick · hats · bass · chords) at a chosen
   key + tempo. The per-genre starting points live in [`docs/music-theory-for-zeroclaw.md`](docs/music-theory-for-zeroclaw.md).
2. **Many loops = sections.** intro · verse · pre-chorus · **chorus** · bridge · outro — each
   a loop tuned to its job. Energy comes from **adding/removing layers and opening the filter**,
   not just volume: a sparse intro (just chords) → drums enter for the verse → the **chorus is
   the peak** (full kit + the hook) → the outro winds down. (Song anatomy is in the theory doc.)
3. **Merge + multi-layer into a song.** Sections are sequenced with Strudel's
   `arrange([bars, section], …)` (one render) or rendered as stems and assembled with `ffmpeg`
   crossfades — giving the track a real arc. Here's that arc **measured from one of Riff's
   renders** (a ~48 s song):

   | Section | mean vol | HF (hats / lead) |
   |---|---|---|
   | intro (0–8 s) | −32.9 dB | −72.5 dB · just chords |
   | verse (8–24 s) | −18.9 dB | −44.0 dB · drums in |
   | **chorus (24–40 s)** | **−14.1 dB** | **−38.9 dB · peak — hook + full kit** |
   | outro (40–48 s) | −32.3 dB | −63.4 dB · winds down |

   That's the textbook shape: a quiet, high-frequency-light intro → energy ramping through the
   verse → the **chorus ~19 dB louder and far brighter** (the payoff) → a calm outro. Full
   song-composition design (Strudel-native `arrange` vs stem-assembly) is in the
   [roadmap](docs/sundai-zeroclaw-music-roadmap.md).
4. **Vocals where it helps.** When a request wants a spoken/sung line, Riff emits a
   `🎤 say: …` directive and the pipeline speaks it over the beat via **OpenAI TTS**, rendered
   and mixed locally (see [`render/VOICE-LAYER.md`](render/VOICE-LAYER.md)) — so a track can
   carry a hook, chant, or callout, not just instruments.

**Both paths are working today** (verified end-to-end):

```bash
# a full multi-section song — arrange() renders all sections (auto-sized: 4+8+8+4 = 24 cycles → 48s)
node render/strudel-render.mjs song.wav "$(scripts/strudel-cycles.sh song.js)" < song.js
#   song.js:  setcpm(120/4)
#             arrange([4, <intro>], [8, <verse>], [8, <chorus>], [4, <outro>])

# a beat + a spoken hook over it (OpenAI TTS, mixed locally) → one voice message
echo '<beat>' | render/voice-deliver.sh --code - --say "stay focused, you got this" --out hook.ogg
```

## Layout

| Path | What |
|------|------|
| `~/.cargo/bin/zeroclaw` | the binary (v0.8.1 prebuilt, darwin arm64) — installed globally, not in this dir |
| `config.toml` | agent + provider + channel config. **Secret-free** (committed) |
| `.env` | real API key + Discord bot token. **gitignored** |
| `.env.example` | template (committed) |
| `run.sh` | launcher: loads `.env`, points zeroclaw at this dir, injects secrets as runtime overrides |
| `data/` | runtime state (sessions, memory, costs) — gitignored |
| `simplex-bridge.py` | SimpleX↔zeroclaw bridge (committed) |
| `simplex.sh` | manage the SimpleX surface: `start`/`stop`/`status`/`link`/`logs` (committed) |
| `~/.local/bin/simplex-chat` | SimpleX Chat CLI v6.5.5 (installed globally) |
| `simplex/` | SimpleX DB (zeroclaw's identity!), venv, sessions, logs — **gitignored** |

## Secret handling

Secrets never touch a committed file. `run.sh` loads `.env` and exports them via
zeroclaw's env-override mechanism:

- `MISTRAL_API_KEY` → `ZEROCLAW_providers__models__mistral__hermes__api_key`
- `DISCORD_BOT_TOKEN` → `ZEROCLAW_channels__discord__default__bot_token`

`config.toml` carries a dummy `bot_token = "set-via-env-override"` only because the
field is schema-required; the real token is overlaid at runtime.

## Usage

```bash
./run.sh agent -a hermes -m "your question"   # one-off chat (gpt-5.4)
./run.sh agent -a hermes                       # interactive chat
./run.sh channel doctor                        # health-check Discord
./run.sh daemon                                # always-on: listen + respond on Discord
./run.sh <any zeroclaw subcommand>
```

## Verified

- LLM round-trip (gpt-5.4): `./run.sh agent -a hermes -m "..."` → reply ✓
- Discord token auth: `./run.sh channel doctor` → "Discord healthy" ✓

## Discord — remaining setup

`channel doctor` only proves the token authenticates. For the bot to actually
read/answer in the server you still need:

1. **Invite the bot** to the server with the `bot` scope (Developer Portal →
   OAuth2 → URL Generator, or:
   `https://discord.com/oauth2/authorize?client_id=<DISCORD_APP_ID>&scope=bot&permissions=274877990912`).
2. **Enable the MESSAGE CONTENT intent** (Developer Portal → Bot → Privileged
   Gateway Intents) — required to read message text. Without it, only @-mentions
   reach the bot.
3. **Run the daemon** so zeroclaw connects to the gateway and listens.
   `agent`/`channel doctor` do not keep a live connection. For always-on, use the
   launchd service below; for a one-off foreground run, `./run.sh daemon`.

Discord is **mention-only** (`mention_only = true`): Riff replies when you `@`-mention
it (or DM it), not to every message. All users are allowed (`[peer_groups.discord_public]
external_peers = ["*"]`) — tighten by replacing `"*"` with specific Discord user IDs.

## Always-on (launchd)

The three services run as user LaunchAgents that start at login and restart on crash:
`com.zeroclaw.hermes` (bot daemon), `com.zeroclaw.strudel-watch` (voice-message delivery),
`com.zeroclaw.music-api` (HTTP API). **One command installs all three for your machine:**

```bash
./scripts/install-services.sh        # generates plists rooted at THIS repo path + loads them
./scripts/strudel-doctor.sh          # verify all three are up + demo-readiness (22/22)
./scripts/install-services.sh --uninstall   # stop + remove
```

launchd plists require absolute paths, so `install-services.sh` **generates** them from
wherever you cloned the repo (and your `$HOME`) — don't hand-edit the committed
`com.zeroclaw.*.plist` files (those are this-machine examples). Manage individual services:

```bash
launchctl print     gui/$(id -u)/com.zeroclaw.hermes | grep state   # status
launchctl kickstart -k gui/$(id -u)/com.zeroclaw.hermes              # restart (after config.toml edit)
launchctl bootout      gui/$(id -u)/com.zeroclaw.hermes              # stop one
```

After editing `config.toml`, `kickstart -k` the affected service to reload.

## SimpleX

zeroclaw has **no native SimpleX channel**, so `simplex-bridge.py` glues a local
`simplex-chat` instance to the agent. Architecture:

```
SimpleX app ──group──▶ simplex-chat (WS :5226) ──▶ simplex-bridge.py ──▶ ./run.sh agent -a hermes ──▶ Mistral
        ◀───────────── reply back into the group ◀──────────────────────────────┘
```

zeroclaw has its **own** SimpleX identity (profile "ZeroClaw") and owns a group
named **zeroclaw**. People join that group via its link and chat with it there.

```bash
./simplex.sh start     # start the simplex-chat daemon + bridge (idempotent)
./simplex.sh link      # print the SimpleX group join link (open in your SimpleX app)
./simplex.sh status    # daemon + bridge up/down
./simplex.sh logs      # tail daemon + bridge logs
./simplex.sh stop      # stop both
```

Per-sender conversation context is kept in `simplex/sessions/`. Replies > ~1800
chars are auto-split into multiple SimpleX messages.

### macOS openssl note

The `simplex-chat` binary hardcodes `…/openssl@3.0/…`, which Homebrew no longer
provides (it ships `openssl@3` = 3.x). A one-time compat symlink fixes it
(`DYLD_*` env vars don't survive SIP-protected launchers like `nohup`, so the
symlink is the robust fix):

```bash
ln -s openssl@3 /opt/homebrew/opt/openssl@3.0   # already created during setup
```

## Verified end-to-end

- Mistral LLM: `./run.sh agent -a hermes -m "..."` → reply ✓
- Discord: connected & listening (`/health` → `channel:discord.default: ok`) ✓
- SimpleX: 2nd client joined the group, sent a message, got zeroclaw's reply ✓
