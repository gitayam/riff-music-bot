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
| `GET /history` | `?session_id=…&limit=…` | `{tracks:[…]}` — cross-session history from D1, newest first (bearer-gated) |
| `POST /discord/interactions` | Discord Interaction (Ed25519-signed) | PING→PONG; slash command→deferred ack, then a follow-up with code + ▶ link |

`POST` (except `/discord/interactions`) and `GET /history` require `Authorization: Bearer <MUSIC_API_TOKEN>`
(same contract as `api-server.py`). Errors: `400` bad/missing field · `401` unauthorized / bad signature ·
`404` unknown session (modify) · `422` invalid Strudel · `502` LLM upstream/config · `503` history/discord
not configured · `504` LLM timeout.

**Discord-native (P3):** `POST /discord/interactions` is the event-driven replacement for the laptop's
REST-poll `strudel-watch.py` watcher. Discord signs each request (Ed25519); the Worker verifies it with the
app's public key (`DISCORD_PUBLIC_KEY`), answers the PING handshake, and for a slash command **acks within
3 s with a deferred response** then composes the Strudel in `waitUntil()` and **edits the original message**
(via the interaction token — no bot token needed) with the code + `strudel.cc` link. After deploy, set the
app's *Interactions Endpoint URL* to `https://<worker>/discord/interactions`.

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

# deploy (set secrets + create the D1 DB once, then ship):
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put MUSIC_API_TOKEN
npx wrangler d1 create riff-tracks            # paste the printed id into wrangler.toml database_id
npx wrangler d1 migrations apply riff-tracks --remote
npx wrangler deploy
```

`OPENAI_MODEL` (default `gpt-5.4`) and `OPENAI_BASE_URL` (default OpenAI; point at a Cloudflare **AI
Gateway** in prod for caching + rate-limit + cost observability) are non-secret `[vars]` in `wrangler.toml`.

## What's deliberately NOT here (next slices)

- **Audio render** (`audio_url`) → Phase 3 P1: Worker → Queues → **Container** (Node+Playwright+Chromium+ffmpeg) → R2.
  The Discord follow-up (P3) posts code + a play link today; when P1 lands it will attach the rendered audio.
- **Registering the slash command** with Discord (one-time `PUT /applications/{id}/commands`) is an operator
  step, not code here — the webhook handler is built + tested.
- **The authoritative `@strudel/transpiler` parse-gate** → P1 (ships with the Container). `validateStrudel()`
  here is a lightweight structural pre-check that catches prose-instead-of-code and the `[ ...whole program... ]`
  wrap bug; it is not a full parse.
- **Embeddings in Vectorize** ("more like this" similarity) → the last Phase 3 P2 piece. (Deferred because
  Vectorize has no real local-dev emulation — it needs a remote binding/account to verify; D1 + DO both run
  locally in `wrangler dev`, which is why they shipped first.)
- **Discord-native Interactions webhook** (retires the daemon + watcher) → Phase 3 P3.
