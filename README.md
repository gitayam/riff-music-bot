# zeroclaw (local)

Local install of [zeroclaw](https://github.com/zeroclaw-labs/zeroclaw) — a Rust
agent runtime / personal AI assistant. Generation runs on **OpenAI GPT-5.4**
(automatic fallback: gpt-5.4-mini → Mistral), reachable over **Discord** (native)
and **SimpleX** (via a local bridge, since zeroclaw has no native SimpleX channel).

> 📦 **Repository — commit / open PRs HERE:** <https://github.com/gitayam/riff-music-bot>
> This is the canonical repo. It was extracted from a monorepo; any copy living under
> `llms-local/` is a historical mirror — **do not commit there.**

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
./run.sh agent -a hermes -m "your question"   # one-off Mistral chat
./run.sh agent -a hermes                       # interactive chat
./run.sh channel doctor                        # health-check Discord
./run.sh daemon                                # always-on: listen + respond on Discord
./run.sh <any zeroclaw subcommand>
```

## Verified

- Mistral LLM round-trip: `./run.sh agent -a hermes -m "..."` → reply ✓
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
./scripts/strudel-doctor.sh          # verify all three are up (16/16)
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
