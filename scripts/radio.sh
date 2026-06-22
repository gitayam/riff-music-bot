#!/usr/bin/env bash
# radio.sh — Phase-4 P0: a continuous generative radio. Renders a sequence of Strudel patterns
# into HLS audio segments and appends them to a live .m3u8, so a player hears an endless stream
# that keeps being created. P0 cycles a seed set, rendered offline from the cached sample packs;
# the evolution engine (derive each next pattern from the last) and agent-generated segments are P1.
#
#   scripts/radio.sh <outdir> [--max-segments N] [--cycles C]
#     --max-segments N : stop after N (bounded → playlist closed as VOD). 0/omitted = forever (live).
#     --cycles C       : Strudel cycles per segment (segment length). Default 8.
#
# Listen:  ( cd <outdir> && python3 -m http.server 8123 )
#          then open http://localhost:8123/stream.m3u8 in ffplay / VLC / Safari.  Ctrl-C stops it.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
render="$root/render/strudel-render.mjs"   # faithful (offline via cached packs)
gate="$here/render/render.mjs"             # pure-node parse-gate

outdir="${1:?usage: radio.sh <outdir> [--max-segments N] [--cycles C]}"; shift || true
max=0; cyc=8
while [ $# -gt 0 ]; do case "$1" in
  --max-segments) shift; max="${1:?--max-segments needs a number}" ;;
  --cycles) shift; cyc="${1:?--cycles needs a number}" ;;
  *) echo "radio.sh: unknown arg '$1'" >&2; exit 2 ;;
esac; shift; done

mkdir -p "$outdir"
m3u8="$outdir/stream.m3u8"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

# Each segment's pattern comes from the evolution engine (radio-compose.mjs <index>), which walks
# tempo/key/mode/kit/density deterministically so the stream continuously morphs. Cached kits only
# (909/808/dirt/piano) → renders offline. (P1-next: derive from the *previous* segment + agent-gen.)
compose="$here/radio-compose.mjs"

# (Re)start the live playlist. No #EXT-X-ENDLIST while generating → players keep polling for more.
{ echo "#EXTM3U"; echo "#EXT-X-VERSION:3"; echo "#EXT-X-TARGETDURATION:30"; echo "#EXT-X-MEDIA-SEQUENCE:0"; } > "$m3u8"
echo "[radio] writing HLS to $m3u8 (cycles/seg=$cyc, max=$max [0=forever])" >&2

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
  { printf '#EXTINF:%s,\n' "${dur:-15.0}"; printf '%s\n' "$seg"; } >> "$m3u8"
  echo "[radio] + $seg (${dur}s)" >&2
  i=$((i+1))
done
# A bounded run is a finished VOD; a live (forever) run is left open for players to keep polling.
[ "$max" -gt 0 ] && echo "#EXT-X-ENDLIST" >> "$m3u8"
echo "[radio] done — $i segment(s) in $m3u8" >&2
