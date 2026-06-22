#!/usr/bin/env bash
# test-radio.sh — Phase-4 P0: a bounded radio run must produce a valid live HLS stream.
# Deterministic + offline (seed patterns render from the cached sample packs). ~25s (2 renders).
# Run: scripts/test-radio.sh
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fails=0
chk(){ if [ "$2" = 1 ]; then printf '  \033[32mok\033[0m   %s\n' "$1"; else printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); fi; }

timeout 250 "$here/radio.sh" "$tmp/out" --max-segments 2 --cycles 2 >/dev/null 2>&1 || true
m="$tmp/out/stream.m3u8"

[ -f "$m" ] && chk "playlist created" 1 || chk "playlist created" 0
head -1 "$m" 2>/dev/null | grep -q '#EXTM3U' && chk "valid HLS header (#EXTM3U)" 1 || chk "valid HLS header (#EXTM3U)" 0
n=$(ls "$tmp/out"/seg*.ts 2>/dev/null | wc -l | tr -d ' ')
[ "${n:-0}" -eq 2 ] && chk "2 segments generated" 1 || chk "2 segments generated (got ${n:-0})" 0
grep -q '#EXT-X-ENDLIST' "$m" 2>/dev/null && chk "bounded run closed as VOD (#EXT-X-ENDLIST)" 1 || chk "bounded run closed as VOD" 0
{ grep -q 'seg00000.ts' "$m" && grep -q 'seg00001.ts' "$m"; } 2>/dev/null && chk "playlist references both segments" 1 || chk "playlist references both segments" 0
audio=1; for ts in "$tmp/out"/seg*.ts; do
  [ -f "$ts" ] || { audio=0; break; }
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$ts" 2>/dev/null)
  awk "BEGIN{exit !(${d:-0}>0.5)}" || audio=0
done
chk "each segment is real audio (ffprobe dur>0.5s)" "$audio"

echo; [ "$fails" = 0 ] && { echo "PASS — generative radio produces a valid HLS stream"; exit 0; } || { echo "$fails FAILED"; exit 1; }
