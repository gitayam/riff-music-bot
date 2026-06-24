// render-container.js — Cloudflare Container (Workers Paid) wrapping the headless-Chromium + ffmpeg
// render microservice (container/server.mjs). This is the one piece that CANNOT run in a Worker:
// the faithful Strudel render (real 909/808/dirt samples + effects) → WAV → ffmpeg → mp3/ogg.
//
// The Worker forwards POST /render to a warm container instance via the RENDER binding (see
// renderBytes() in index.js). The image is built from container/Dockerfile at deploy time
// (wrangler.toml [[containers]]). No secrets here — the service is reachable only through the
// binding, never a public URL.
import { Container } from "@cloudflare/containers";

export class RenderContainer extends Container {
  defaultPort = 8800;    // container/server.mjs listens here (PORT=8800 in the Dockerfile)
  sleepAfter = "10m";    // keep a warm instance between renders; idle-stop after 10 min to save cost
}
