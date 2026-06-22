#!/usr/bin/env bash
# test-radio.sh — Phase-4 generative radio: valid live HLS, a working rolling window, and a stream
# that actually evolves. Deterministic + offline (seed renders from the cached packs). ~25s.
# Run: scripts/test-radio.sh
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fails=0
chk(){ if [ "$2" = 1 ]; then printf '  \033[32mok\033[0m   %s\n' "$1"; else printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); fi; }

# ── rolling window: 3 segments, window 2 → keep segs 1,2 (evict 0), MEDIA-SEQUENCE 1 ──
timeout 250 "$here/radio.sh" "$tmp/w" --max-segments 3 --window 2 --cycles 1 >/dev/null 2>&1 || true
m="$tmp/w/stream.m3u8"
[ -f "$m" ] && head -1 "$m" | grep -q '#EXTM3U' && chk "rolling: valid HLS playlist" 1 || chk "rolling: valid HLS playlist" 0
n=$(ls "$tmp/w"/seg*.ts 2>/dev/null | wc -l | tr -d ' ')
[ "${n:-0}" -eq 2 ] && chk "rolling: window keeps 2 segments on disk (got ${n:-0})" 1 || chk "rolling: window keeps 2 (got ${n:-0})" 0
[ ! -f "$tmp/w/seg00000.ts" ] && chk "rolling: oldest segment (seg00000.ts) evicted from disk" 1 || chk "rolling: oldest evicted" 0
grep -q '#EXT-X-MEDIA-SEQUENCE:1' "$m" 2>/dev/null && chk "rolling: EXT-X-MEDIA-SEQUENCE bumped to 1" 1 || chk "rolling: media-sequence bumped" 0
{ grep -q 'seg00001.ts' "$m" && grep -q 'seg00002.ts' "$m" && ! grep -q 'seg00000.ts' "$m"; } 2>/dev/null \
  && chk "rolling: playlist references only the kept segments" 1 || chk "rolling: playlist references kept only" 0
grep -q '#EXT-X-ENDLIST' "$m" 2>/dev/null && chk "rolling: bounded run closed as VOD" 1 || chk "rolling: VOD close" 0
audio=1; for ts in "$tmp/w"/seg*.ts; do d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$ts" 2>/dev/null); awk "BEGIN{exit !(${d:-0}>0.3)}" || audio=0; done
chk "rolling: kept segments are real audio" "$audio"

# ── keep-all (no --window): 2 segments, both kept, MEDIA-SEQUENCE 0 ──
timeout 200 "$here/radio.sh" "$tmp/k" --max-segments 2 --cycles 1 >/dev/null 2>&1 || true
mk="$tmp/k/stream.m3u8"
nk=$(ls "$tmp/k"/seg*.ts 2>/dev/null | wc -l | tr -d ' ')
{ [ "${nk:-0}" -eq 2 ] && grep -q '#EXT-X-MEDIA-SEQUENCE:0' "$mk"; } 2>/dev/null \
  && chk "keep-all: both segments kept, media-sequence 0" 1 || chk "keep-all: both kept, seq 0" 0

# ── evolution engine: every segment parses, the set actually varies, deterministic ──
gate_ok=1
for k in 0 1 2 3 4 5 6 7; do
  c="$(node "$here/radio-compose.mjs" "$k" 2>/dev/null)"
  node "$here/render/render.mjs" "$c" "$tmp/c.wav" 1 >/dev/null 2>&1 || gate_ok=0
done
chk "evolution: every segment (idx 0-7) passes the parse-gate" "$gate_ok"
distinct=$(for k in 0 1 2 3 4 5 6 7; do node "$here/radio-compose.mjs" "$k" 2>/dev/null | shasum | cut -d' ' -f1; done | sort -u | wc -l | tr -d ' ')
[ "${distinct:-0}" -ge 5 ] && chk "evolution: ≥5 distinct patterns / 8 segments (got $distinct)" 1 || chk "evolution: ≥5 distinct (got ${distinct:-0})" 0
d1="$(node "$here/radio-compose.mjs" 3 2>/dev/null)"; d2="$(node "$here/radio-compose.mjs" 3 2>/dev/null)"
[ "$d1" = "$d2" ] && chk "evolution: deterministic (same index → same pattern)" 1 || chk "evolution: deterministic" 0

echo; [ "$fails" = 0 ] && { echo "PASS — radio: evolving, rolling-window, valid HLS"; exit 0; } || { echo "$fails FAILED"; exit 1; }
