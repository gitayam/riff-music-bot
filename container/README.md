# Riff render microservice — Cloudflare Container (Phase 3 P1)

The piece of the edge migration that **can't** live in a Worker: headless-Chromium render + ffmpeg.
The Worker (`../worker/`) does orchestration + the LLM compose (Strudel code); **this service does the
render** — `code → WAV (faithful engine) → ffmpeg → mp3/ogg/wav`. It wraps the proven engine in
`../render/strudel-render.mjs`, so the audio is the *real* strudel.cc output (true 909/808/dirt samples +
effects), not a synth approximation.

## API

| Method · Path | Body | Returns |
|---|---|---|
| `GET /health` | — | `{ok:true}` |
| `POST /render` | `{code, cycles?=4, format?=mp3}` | audio bytes (`Content-Type: audio/*`); `422` if it won't render |

No LLM here. Dep-free (stdlib `http`); shells out to the render engine + ffmpeg (same path as
`scripts/api-server.py`), with a timeout + one retry (headless audio can flake).

## Run / test locally

It runs as a plain node process — no Docker needed for dev (the engine works on macOS):

```bash
cd container
PORT=8800 node server.mjs                 # uses ../render as the engine (RENDER_DIR to override)
./test.sh                                  # boots the service + renders real audio over HTTP
curl -s -X POST localhost:8800/render -H 'content-type: application/json' \
  -d '{"code":"setcpm(120/4)\nstack(sound(\"bd*4\").bank(\"RolandTR909\"))","format":"mp3"}' -o out.mp3
```

## Build the image (linux/amd64)

```bash
# from the zeroclaw/ repo root (render/ must be in the build context):
docker build -f container/Dockerfile -t riff-render .
docker run --rm -p 8800:8800 riff-render
```

The base image (`mcr.microsoft.com/playwright`) carries Chromium + its system libs; the Dockerfile adds
ffmpeg and the engine. ⚠ The image build is **not** part of `./test.sh` (it needs a Docker daemon) — the
*service* is what the suite verifies; build the image when a daemon is available.

## Wiring it to the Worker (deploy-time — needs a Workers Paid account)

Two topologies, simplest first:

1. **Direct (synchronous).** A Container binding on the Worker; the Worker forwards a render request to a
   container instance and streams back the audio. Good for one-off renders; an ~8 s `OfflineAudioContext`
   render is within budget. `wrangler.toml`:
   ```toml
   [[containers]]
   image = "./container/Dockerfile"
   class_name = "RenderContainer"      # a Durable-Object-backed container class
   instances = 2
   ```
2. **Queued (scalable) — the roadmap target.** Worker enqueues `{code, cycles, format, track_id}` to
   **Queues**; a consumer Worker spins the Container, renders, uploads the audio to **R2**, and updates the
   D1 `tracks` row's `audio_url`. Decouples the 3 s Worker response from the multi-second render and absorbs
   bursts. This is how `audio_url` (today always `null`) gets filled, and how the Discord follow-up (P3)
   gets upgraded from "code + link" to an attached audio file.

⚠ **Verify early at deploy:** container cold-provisioning takes minutes — keep a warm instance for a demo,
and keep the existing timeout + K=2 retry wrapper (renders flake / cold-start). Browser Rendering is NOT a
substitute (no custom Chromium flags, no audio path, no way to exfiltrate the WAV) — Containers only.
