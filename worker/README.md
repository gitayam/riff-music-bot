# Riff music API — Cloudflare Worker (Phase 3 P0)

The first vertical slice of getting Riff **off the laptop** (roadmap Phase 3). This Worker ports the
request/response surface of `scripts/api-server.py` to Cloudflare's edge — **Tier-A only**: a prompt
becomes valid Strudel code + a one-click `strudel.cc` play link. **No audio render yet** — that needs a
Container (Phase 3 P1), so `audio_url` is always `null` here.

Why this first: it proves the orchestrator runs on a **stable URL, always-on, no laptop** — retiring the
ephemeral quick tunnel — without taking on the hard part (headless-Chromium render in a Container).

## Endpoints

| Method · Path | Body | Returns |
|---|---|---|
| `GET /health` | — | `{ok:true}` |
| `GET /` | — | self-documenting capabilities |
| `POST /generate` | `{prompt, repair_attempts?=2}` | `{prompt, strudel_code, share_url, audio_url:null, version, engine}` |
| `POST /render` | `{code}` | same shape (validates + links code you already have; never rewrites it) |

`POST` requires `Authorization: Bearer <MUSIC_API_TOKEN>` (same contract as `api-server.py`). Errors:
`400` bad/missing field · `401` unauthorized · `422` invalid Strudel · `502` LLM upstream/config · `504` LLM timeout.

The `share_url` is `https://strudel.cc/#<base64(utf8(code))>` — **byte-identical** to the local Python/Node
systems (a unit test enforces this), so links from the edge play exactly like links from the laptop.

## Run / deploy

```bash
cd worker
cp .dev.vars.example .dev.vars      # then fill OPENAI_API_KEY + MUSIC_API_TOKEN (gitignored)
npm test                            # pure-helper unit tests
./test.sh                           # unit + a live wrangler-dev pass against a mock OpenAI
npx wrangler dev                    # local edge runtime on :8787

# deploy (set secrets once, then ship):
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put MUSIC_API_TOKEN
npx wrangler deploy
```

`OPENAI_MODEL` (default `gpt-5.4`) and `OPENAI_BASE_URL` (default OpenAI; point at a Cloudflare **AI
Gateway** in prod for caching + rate-limit + cost observability) are non-secret `[vars]` in `wrangler.toml`.

## What's deliberately NOT here (next slices)

- **Audio render** (`audio_url`) → Phase 3 P1: Worker → Queues → **Container** (Node+Playwright+Chromium+ffmpeg) → R2.
- **The authoritative `@strudel/transpiler` parse-gate** → P1 (ships with the Container). `validateStrudel()`
  here is a lightweight structural pre-check that catches prose-instead-of-code and the `[ ...whole program... ]`
  wrap bug; it is not a full parse.
- **Per-session modify state / history** → Phase 3 P2 (Durable Object) · **`tracks` in D1** · **embeddings in Vectorize**.
- **Discord-native Interactions webhook** (retires the daemon + watcher) → Phase 3 P3.
