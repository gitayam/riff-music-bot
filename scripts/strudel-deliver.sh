#!/usr/bin/env bash
# strudel-deliver.sh — full pipeline: Strudel code → faithful local render → Discord voice message.
#
#   ./strudel-deliver.sh <codefile|->  [channel_id]  [--send]  [--cycles N]
#
# Reads Strudel code from a file (or '-' for stdin) and:
#   1. lint        (heuristic, advisory)
#   2a parse-gate  (pure-node scripts/render/render.mjs — exits non-zero on invalid code; the
#                   Chromium render renders silence for bad input rather than failing, so gate here)
#   2b render WAV  (render/strudel-render.mjs — the FAITHFUL strudel.cc engine via headless
#                   Chromium: real dirt/909/808 samples, piano, .room/.delay/.lpf. Timeout + 1 retry.)
#   3. transcode   (ffmpeg → Opus/OGG with a true-peak limiter; voice-message format)
#   4. deliver     (discord-voice.sh — DRY RUN unless --send + a channel_id)
#
# To --send (or to let the dry-run auth-check run), load secrets first:
#   ( set -a; . ./.env; set +a; ./scripts/strudel-deliver.sh tune.js <channel_id> --send )
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
render="$root/render/strudel-render.mjs"   # Option A — engine of record
src="${1:?usage: strudel-deliver.sh <codefile|-> [channel_id] [--send] [--cycles N]}"; shift || true

channel=""; send=""; cycles=""   # empty → auto-sized from the code below (song = full length, loop = 4)
while [ $# -gt 0 ]; do
  case "$1" in
    --send) send=1 ;;
    --cycles|--secs) shift; cycles="${1:?--cycles needs a number}" ;;   # --secs kept as alias
    *) channel="$1" ;;
  esac; shift
done

code="$(if [ "$src" = "-" ]; then cat; else cat "$src"; fi)"
# Auto-size the render: an arrange(...) song renders for the SUM of its section bars; a loop = 4.
[ -n "$cycles" ] || cycles="$(printf '%s' "$code" | "$here/strudel-cycles.sh" -)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

echo "── 1/4 lint (advisory):"
printf '%s' "$code" | "$here/strudel-lint.sh" || echo "   (lint flagged — the render gate is the real check)"

echo "── 2a/4 parse-gate (fast pure-node check — aborts on invalid code):"
# Option A (Chromium) renders ~silence for invalid code instead of failing, so gate first
# with the pure-node renderer, which exits non-zero on a non-pattern (e.g. [...]-wrapped).
node "$here/render/render.mjs" "$code" "$tmp/gate.wav" 1 >/dev/null

echo "── 2b/4 render → WAV (faithful strudel.cc engine via headless Chromium):"
render_once() { printf '%s' "$code" | timeout 150 node "$render" "$tmp/tune.wav" "$cycles"; }
render_once || { echo "   render failed — retrying once (Chromium flake / cold start)…"; render_once; }

echo "── 3/4 transcode → Opus/OGG (true-peak limited):"
ffmpeg -hide_banner -v error -y -i "$tmp/tune.wav" -af "alimiter=limit=0.95" \
  -c:a libopus -b:a 32k -ac 1 -ar 48000 "$tmp/voice-message.ogg"
echo "   $(wc -c < "$tmp/voice-message.ogg" | tr -d ' ') bytes"

echo "── 4/4 deliver:"
if [ -n "$send" ] && [ -n "$channel" ]; then
  "$here/discord-voice.sh" "$tmp/voice-message.ogg" "$channel" --send
elif [ -n "$channel" ]; then
  "$here/discord-voice.sh" "$tmp/voice-message.ogg" "$channel"
else
  "$here/discord-voice.sh" "$tmp/voice-message.ogg"
fi
