# Riff music API — Cloudflare Worker (Phase 3 P0 + P2)

Getting Riff **off the laptop** (roadmap Phase 3). This Worker ports the request/response surface of
`scripts/api-server.py` to Cloudflare's edge — **Tier-A**: a prompt becomes valid Strudel code + a
one-click `strudel.cc` play link, and a **per-session modify chain** (`/modify`: "faster" / "darker" /
"add a bassline") backed by a **Durable Object**, returning the code diff. **No audio render yet** — that
needs a Container (Phase 3 P1), so `audio_url` is always `null` here.

Why this shape: it proves the orchestrator — including the **modify loop, the demo's core differentiator**
— runs on a **stable URL, always-on, no laptop** (retiring the ephemeral quick tunnel) without taking on
the hard part (headless-Chromium render in a Container).

## Endpoints

| Method · Path | Body | Returns |
|---|---|---|
| `GET /health` | — | `{ok:true}` |
| `GET /` | — | self-documenting capabilities |
| `POST /generate` | `{prompt, session_id?, repair_attempts?=2}` | `{prompt, session_id, strudel_code, share_url, audio_url:null, version, parent_id, engine}` |
| `POST /modify` | `{session_id, instruction, repair_attempts?=2}` | `{strudel_code, share_url, diff, version, parent_id, …}` — edits the session's latest version |
| `POST /render` | `{code, session_id?}` | same shape (validates + links code you already have; never rewrites it) |
| `POST /similar` | `{text \| track_id, limit?=5}` | `{matches:[…]}` — "more like this" by embedding cosine similarity (bearer-gated) |
| `GET /history` | `?session_id=…&limit=…` | `{tracks:[…]}` — cross-session history from D1, newest first (bearer-gated) |
| `GET /audio/<key>` | — | serves a rendered audio file from R2 (public) |
| `POST /discord/interactions` | Discord Interaction (Ed25519-signed) | PING→PONG; slash command→deferred ack, then a follow-up with code + ▶ link |

`POST` (except `/discord/interactions`) and `GET /history` require `Authorization: Bearer <MUSIC_API_TOKEN>`
(same contract as `api-server.py`). Errors: `400` bad/missing field · `401` unauthorized / bad signature ·
`404` unknown session (modify) · `422` invalid Strudel · `502` LLM upstream/config · `503` history/discord
not configured · `504` LLM timeout.

**Discord-native (P3):** `POST /discord/interactions` is the event-driven replacement for the laptop's
REST-poll `strudel-watch.py` watcher. Discord signs each request (Ed25519); the Worker verifies it with the
app's public key (`DISCORD_PUBLIC_KEY`), answers the PING handshake, and for a slash command **acks within
3 s with a deferred response** then composes the Strudel in `waitUntil()` and **edits the original message**
(via the interaction token — no bot token needed). When the render service is wired it **renders the audio
and attaches the mp3** to the message (plays inline in Discord); otherwise it degrades to code + `strudel.cc`
link. After deploy, set the app's *Interactions Endpoint URL* to `https://<worker>/discord/interactions`.

**Rendered audio (P1 last mile):** set `RENDER_SERVICE_URL` to the render Container (`../container/`) and
bind the `AUDIO` R2 bucket, and the Worker renders real audio: `/render` (and `/generate`/`/modify` with
`render:true`) POST the code to the render service, store the returned audio in R2, and return an
`audio_url` served at `GET /audio/<key>`. Rendering is **best-effort** — on failure the response degrades
to `audio_url:null` + a `render_error` field (you always get the code + play link). Unset
`RENDER_SERVICE_URL` → Tier-A (code + link only). Locally, run `../container/server.mjs` as the backend
and `wrangler dev` provides a local R2 — the whole path is testable without an account.

**"More like this" (P2):** set `EMBED_TRACKS=true` and each new track is embedded (OpenAI
`text-embedding-3-small`, stored in the `tracks.embedding` column). `POST /similar {text}` or
`{track_id}` embeds the query and ranks stored tracks by **cosine similarity** in the Worker, returning
the top matches (e.g. "remix the vibe of that track"). Embedding-on-write is **best-effort** + **opt-in**
(off = the feature is dormant, no per-write API cost). At scale, swap the in-Worker scan for a **Vectorize**
ANN query — the `/similar` contract stays the same; D1 holds the metadata either way.

**History + retention (D1):** every generate/modify/render is logged as a `tracks` row (Contract 5),
queryable via `GET /history` (optionally scoped to a `session_id`). Persistence is **best-effort** — a D1
hiccup is logged but never breaks the music response. A **daily Cron Trigger** (`scheduled()` →
`pruneTracks`) deletes rows older than `RETENTION_DAYS` (default 30) so the log can't grow into D1's
10 GB cap. Schema: `migrations/0001_create_tracks.sql` (also created lazily by `src/store.js`, so local
`wrangler dev` and a fresh deploy both just work).

**The modify loop:** pass a stable `session_id` (e.g. `"discord:user:1234"`) to `/generate`; then
`POST /modify {session_id, instruction:"make it darker"}` loads the last version, asks the model to edit
the code, validates it, stores the new version, and returns the new code + a `diff`. One Durable Object
per `session_id` holds the ordered version chain (`parent_id` links them). Runs locally in `wrangler dev`.

The `share_url` is `https://strudel.cc/#<base64(utf8(code))>` — **byte-identical** to the local Python/Node
systems (a unit test enforces this), so links from the edge play exactly like links from the laptop.

## Run / deploy

```bash
cd worker
cp .dev.vars.example .dev.vars      # then fill OPENAI_API_KEY + MUSIC_API_TOKEN (gitignored)
npm test                            # pure-helper unit tests
./test.sh                           # unit + a live wrangler-dev pass against a mock OpenAI
npx wrangler dev                    # local edge runtime on :8787

# deploy: see DEPLOY.md for the full ordered runbook (create D1/R2, secrets, deploy, wire Discord,
# build the render Container). The short version:
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put MUSIC_API_TOKEN
npx wrangler d1 create riff-tracks            # paste the printed id into wrangler.toml database_id
npx wrangler d1 migrations apply riff-tracks --remote
npx wrangler r2 bucket create riff-audio
npx wrangler deploy

# register the /riff slash command (the Discord webhook is inert until you do — guild id = instant):
DISCORD_APP_ID=… DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… node register-command.mjs
```

Full step-by-step (with the render Container + verification): **[DEPLOY.md](./DEPLOY.md)**.

`OPENAI_MODEL` (default `gpt-5.4`) and `OPENAI_BASE_URL` (default OpenAI; point at a Cloudflare **AI
Gateway** in prod for caching + rate-limit + cost observability) are non-secret `[vars]` in `wrangler.toml`.

## What's deliberately NOT here (next slices)

- **Deploying the render Container.** The Worker↔render-service↔R2 path is built + tested locally (render
  service as a node process, local R2). In prod the render service is a CF **Container** (`../container/`)
  and, for scale, a **Queue** decouples the render from the 3 s response. Building the image needs a Docker
  daemon; the Container/Queue bindings need a Workers Paid account.
- **Native Discord voice-message bubble.** The Discord follow-up attaches the mp3 (plays inline); the
  waveform/scrubber "voice message" bubble (flags 8192 + waveform + Opus/OGG) is a possible polish step.
- **Vectorize for `/similar` at scale.** The feature ships on a D1-backed cosine scan (correct for this
  project's scale); swapping in a Vectorize ANN index is the unbounded-scale path.
- **Registering the slash command** with Discord (one-time `PUT /applications/{id}/commands`) is an operator
  step, not code here — the webhook handler is built + tested.
- **The authoritative `@strudel/transpiler` parse-gate** → P1 (ships with the Container). `validateStrudel()`
  here is a lightweight structural pre-check that catches prose-instead-of-code and the `[ ...whole program... ]`
  wrap bug; it is not a full parse.
- **Embeddings in Vectorize** ("more like this" similarity) → the last Phase 3 P2 piece. (Deferred because
  Vectorize has no real local-dev emulation — it needs a remote binding/account to verify; D1 + DO both run
  locally in `wrangler dev`, which is why they shipped first.)
- **Discord-native Interactions webhook** (retires the daemon + watcher) → Phase 3 P3.
