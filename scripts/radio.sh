#!/usr/bin/env bash
# radio.sh — Phase-4 continuous generative radio. Renders an evolving sequence of Strudel patterns
# (from radio-compose.mjs) into HLS audio segments and appends them to a live .m3u8, so a player
# hears an endless stream that keeps being created and morphs over time. Renders offline from the
# cached sample packs. With --window it keeps a rolling segment window so it can run 24/7.
#
#   scripts/radio.sh <outdir> [--max-segments N] [--cycles C] [--window W] [--serve] [--port P]
#     --max-segments N : stop after N (bounded → playlist closed as VOD). 0/omitted = forever (live).
#     --cycles C       : Strudel cycles per segment (segment length). Default 8.
#     --window W       : keep only the last W segments on disk + in the playlist (rolling window;
#                        bumps EXT-X-MEDIA-SEQUENCE). 0/omitted = keep all. Use W>0 for a 24/7 stream.
#     --serve [--port P]: also serve <outdir> over HTTP (default :8123) with a browser player, so the
#                        radio is one-command demoable. Opens http://localhost:P/radio.html.
#
# Demo:    scripts/radio.sh /tmp/radio --serve --window 12     # then open the printed player URL
# Listen:  ffplay http://localhost:8123/stream.m3u8  (or VLC / Safari).  Ctrl-C stops it.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
render="$root/render/strudel-render.mjs"   # faithful (offline via cached packs)
gate="$here/render/render.mjs"             # pure-node parse-gate

outdir="${1:?usage: radio.sh <outdir> [--max-segments N] [--cycles C]}"; shift || true
max=0; cyc=8; window=0; serve=""; port=8123
while [ $# -gt 0 ]; do case "$1" in
  --max-segments) shift; max="${1:?--max-segments needs a number}" ;;
  --cycles) shift; cyc="${1:?--cycles needs a number}" ;;
  --window) shift; window="${1:?--window needs a number}" ;;
  --serve) serve=1 ;;
  --port) shift; port="${1:?--port needs a number}" ;;
  *) echo "radio.sh: unknown arg '$1'" >&2; exit 2 ;;
esac; shift; done

mkdir -p "$outdir"
m3u8="$outdir/stream.m3u8"
work="$(mktemp -d)"; srv_pid=""
cleanup(){ [ -n "$srv_pid" ] && kill "$srv_pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

# Each segment's pattern comes from the evolution engine (radio-compose.mjs <index>), which walks
# tempo/key/mode/kit/density deterministically so the stream continuously morphs. Cached kits only
# (909/808/dirt/piano) → renders offline. (P1-next: derive from the *previous* segment + agent-gen.)
compose="$here/radio-compose.mjs"

# Rolling live playlist. entries[] holds the kept segments ("file|dur"); media_seq = index of the
# first kept one (EXT-X-MEDIA-SEQUENCE). Rewritten atomically (temp+mv) each segment so a polling
# player never reads a half-written file. No #EXT-X-ENDLIST while live → players keep polling.
entries=(); media_seq=0
write_playlist() { # $1 == "end" appends #EXT-X-ENDLIST (closes a bounded run as a finished VOD)
  { echo "#EXTM3U"; echo "#EXT-X-VERSION:3"; echo "#EXT-X-TARGETDURATION:30"; echo "#EXT-X-MEDIA-SEQUENCE:$media_seq"
    local e; for e in "${entries[@]:-}"; do [ -n "$e" ] && printf '#EXTINF:%s,\n%s\n' "${e#*|}" "${e%%|*}"; done
    if [ "${1:-}" = "end" ]; then echo "#EXT-X-ENDLIST"; fi
  } > "$m3u8.tmp" && mv "$m3u8.tmp" "$m3u8"
}
write_playlist
echo "[radio] writing HLS to $m3u8 (cycles/seg=$cyc, max=$max [0=forever], window=$window [0=keep all])" >&2

# Optional: serve the stream + a browser player so the radio is one-command demoable.
if [ -n "$serve" ]; then
  cp "$here/radio.html" "$outdir/radio.html" 2>/dev/null || true
  ( cd "$outdir" && exec python3 -m http.server "$port" >/dev/null 2>&1 ) & srv_pid=$!
  echo "[radio] ▶ player: http://localhost:$port/radio.html   ·   stream: http://localhost:$port/stream.m3u8" >&2
fi

i=0
while [ "$max" -eq 0 ] || [ "$i" -lt "$max" ]; do
  code="$(node "$compose" "$i")"
  # Each stage skips (not aborts) on failure — a continuous radio must not die on one bad segment.
  if ! node "$gate" "$code" "$work/g.wav" 1 >/dev/null 2>&1; then
    echo "[radio] seed $i failed the gate — skipping" >&2; i=$((i+1)); continue; fi
  if ! { printf '%s' "$code" | timeout 150 node "$render" "$work/seg.wav" "$cyc" >/dev/null 2>&1 \
       || printf '%s' "$code" | timeout 150 node "$render" "$work/seg.wav" "$cyc" >/dev/null 2>&1; }; then
    echo "[radio] render failed for seg $i — skipping" >&2; i=$((i+1)); continue; fi
  seg="$(printf 'seg%05d.ts' "$i")"
  if ! ffmpeg -hide_banner -v error -y -i "$work/seg.wav" -af "alimiter=limit=0.95" \
       -c:a aac -b:a 128k -ar 44100 -f mpegts "$outdir/$seg" 2>/dev/null; then
    echo "[radio] transcode failed for seg $i — skipping" >&2; i=$((i+1)); continue; fi
  dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$outdir/$seg" 2>/dev/null || echo 15.0)"
  entries+=("$seg|${dur:-15.0}")
  # rolling window: drop + delete the oldest segment, bump the media sequence
  if [ "$window" -gt 0 ] && [ "${#entries[@]}" -gt "$window" ]; then
    old="${entries[0]%%|*}"; rm -f "$outdir/$old"; entries=("${entries[@]:1}"); media_seq=$((media_seq+1))
  fi
  write_playlist
  echo "[radio] + $seg (${dur}s)" >&2
  i=$((i+1))
done
# A bounded run is a finished VOD; a live (forever) run is left open for players to keep polling.
[ "$max" -gt 0 ] && write_playlist end
echo "[radio] done — $i segment(s) in $m3u8" >&2
