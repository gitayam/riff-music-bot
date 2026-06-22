# Going live — Riff on Cloudflare (deploy runbook)

Everything in `worker/` + `container/` is built and tested locally. This is the ordered, copy-paste path
to take it live. It needs two things this repo can't provide for you: a **Cloudflare Workers Paid** account
(Containers/Queues are paid) and a **Docker host** (to build the render image). Until then the whole stack
runs locally via `worker/test.sh` + `container/test.sh`.

## 0. Prereqs
```bash
npm i -g wrangler        # already present in this dev env (v4)
wrangler login           # auth to your Cloudflare account
```

## 1. Create the stateful resources (once)
```bash
cd worker
wrangler d1 create riff-tracks          # paste the printed database_id into wrangler.toml [[d1_databases]]
wrangler d1 migrations apply riff-tracks --remote
wrangler r2 bucket create riff-audio     # binding AUDIO (already in wrangler.toml)
# Durable Object (Session) + the daily cron are declared in wrangler.toml — no manual step.
```

## 2. Set secrets (never commit these)
```bash
wrangler secret put OPENAI_API_KEY       # the gpt-5.4 key (locally: zeroclaw/.env OPENAI_API)
wrangler secret put MUSIC_API_TOKEN      # the bearer other groups send on every POST + GET /history
wrangler secret put DISCORD_PUBLIC_KEY   # Discord Dev Portal → General Information → Public Key
```
Optional vars (in `wrangler.toml [vars]`, or set as secrets): `EMBED_TRACKS=true` (enables `/similar`),
`PUBLIC_BASE_URL=https://<your-worker-host>` (records absolute audio_url for the Discord path).

## 3. Deploy the Worker
```bash
wrangler deploy
curl https://<your-worker-host>/health          # → {"ok":true}
```
This is the **Tier-A** stack live: `/generate`, `/modify`, `/render` (code+link), `/history`, `/similar`,
Discord interactions. `audio_url` stays null until step 5.

## 4. Wire Discord
1. Discord Dev Portal → your app → **Interactions Endpoint URL** = `https://<your-worker-host>/discord/interactions`
   (Discord verifies it with a signed PING — the Worker answers PONG, so it saves immediately).
2. Register the slash command (inert until you do this):
   ```bash
   # guild-scoped = instant (use a test server id); omit DISCORD_GUILD_ID for global (~1h propagation)
   DISCORD_APP_ID=<app-id> DISCORD_BOT_TOKEN=<bot-token> DISCORD_GUILD_ID=<guild-id> \
     node register-command.mjs
   ```
3. In Discord: `/riff prompt: funky disco loop, 120bpm` → a deferred ack, then code + a ▶ play link
   (and the attached mp3 once step 5 is done).

## 5. Render audio off-laptop (the Container)
On a Docker host:
```bash
cd ..                                            # zeroclaw/ repo root (render/ must be in context)
docker build -f container/Dockerfile -t riff-render .
# Push to a registry your Worker account can pull, then either:
#  (a) add a [[containers]] binding (see container/README.md) and set RENDER_SERVICE_URL to it, or
#  (b) run it anywhere reachable and set RENDER_SERVICE_URL to its URL:
wrangler secret put RENDER_SERVICE_URL           # e.g. https://render.your-host
```
Now `/render` (and `/generate|/modify` with `render:true`, and the Discord follow-up) return real audio:
rendered → stored in R2 → served at `GET /audio/<key>`.

## 6. Verify live (always do this)
```bash
H="Authorization: Bearer $MUSIC_API_TOKEN"
curl -s https://<host>/health                                                  # {"ok":true}
curl -s -H "$H" -d '{"prompt":"chill lofi loop"}' https://<host>/generate       # code + share_url
curl -s -H "$H" -d '{"prompt":"chill lofi loop","render":true}' https://<host>/generate | jq .audio_url
```

## Rollback
`wrangler deployments list` → `wrangler rollback [<id>]`. D1/R2 data is unaffected by a Worker rollback.
