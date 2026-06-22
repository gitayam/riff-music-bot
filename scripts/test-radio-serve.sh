#!/usr/bin/env bash
# test-radio-serve.sh — radio-serve.py must serve the HLS output AND accept POST /steer (writing the
# steer file radio.sh reads) + GET /steer. Deterministic, no LLM. Uses curl's own --retry (no sleep).
# Run: scripts/test-radio-serve.sh
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"; spid=""
trap '[ -n "$spid" ] && kill "$spid" 2>/dev/null; rm -rf "$tmp"' EXIT
fails=0
chk(){ if [ "$2" = 1 ]; then printf '  \033[32mok\033[0m   %s\n' "$1"; else printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); fi; }

printf '#EXTM3U\n' > "$tmp/stream.m3u8"
cp "$here/radio.html" "$tmp/radio.html"
P=8141
python3 "$here/radio-serve.py" "$tmp" --port "$P" >/dev/null 2>&1 & spid=$!

curl -sf --retry 40 --retry-delay 1 --retry-connrefused "http://localhost:$P/stream.m3u8" -o "$tmp/got" 2>/dev/null || true
grep -q '#EXTM3U' "$tmp/got" 2>/dev/null && chk "serves static stream.m3u8" 1 || chk "serves static stream.m3u8" 0
curl -sf "http://localhost:$P/radio.html" 2>/dev/null | grep -qi 'stream.m3u8' && chk "serves the player page" 1 || chk "serves the player page" 0

curl -sf -X POST --data 'darker faster' "http://localhost:$P/steer" >/dev/null 2>&1
[ "$(cat "$tmp/steer" 2>/dev/null)" = "darker faster" ] && chk "POST /steer writes <root>/steer" 1 || chk "POST /steer writes <root>/steer" 0
[ "$(curl -sf "http://localhost:$P/steer" 2>/dev/null)" = "darker faster" ] && chk "GET /steer returns the current steer" 1 || chk "GET /steer returns current steer" 0
curl -sf -X POST --data '' "http://localhost:$P/steer" >/dev/null 2>&1
[ -z "$(cat "$tmp/steer" 2>/dev/null)" ] && chk "POST /steer with empty body clears it" 1 || chk "empty POST clears steer" 0
# newlines collapsed / length-capped (no shell-meta survives into the file as multi-line)
printf 'line1\nline2' | curl -sf -X POST --data-binary @- "http://localhost:$P/steer" >/dev/null 2>&1
[ "$(cat "$tmp/steer" 2>/dev/null | wc -l | tr -d ' ')" = "0" ] && chk "steer body is single-line (newlines collapsed)" 1 || chk "steer single-line" 0

kill "$spid" 2>/dev/null || true; wait "$spid" 2>/dev/null || true
echo; [ "$fails" = 0 ] && { echo "PASS — steerable radio server"; exit 0; } || { echo "$fails FAILED"; exit 1; }
