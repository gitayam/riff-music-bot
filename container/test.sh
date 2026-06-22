#!/usr/bin/env bash
# test.sh — the render microservice, exercised locally as a plain node process (the faithful engine
# runs on this Mac, so it renders for real). This verifies the SERVICE + HTTP contract that the
# container image runs. The Dockerfile build itself is verified separately (`docker build`) when a
# Docker daemon is available — it isn't part of this suite.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"
fails=0
ok(){ printf '  \033[32mok\033[0m   %s\n' "$1"; }
bad(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); }

# Skip cleanly if the engine deps aren't installed (e.g. a fresh clone before render/ `npm install`).
if [ ! -d ../render/node_modules ] || ! command -v ffmpeg >/dev/null 2>&1; then
  echo "  SKIP — render engine deps not present (../render/node_modules or ffmpeg). Run render/ setup first."
  echo "PASS (skipped)"; exit 0
fi

PORT=8801
PORT=$PORT node server.mjs >/tmp/render-svc.$$ 2>&1 & SVC=$!
cleanup(){ kill "$SVC" 2>/dev/null; wait "$SVC" 2>/dev/null; rm -f /tmp/render-svc.$$ /tmp/render-body.$$ /tmp/render-hdr.$$; }
trap cleanup EXIT

base="http://127.0.0.1:$PORT"
up=""; for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$base/health" 2>/dev/null)" = "200" ] && { up=1; break; }
  kill -0 "$SVC" 2>/dev/null || break; sleep 1
done
[ -z "$up" ] && { echo "  service did not start:"; sed 's/^/    /' /tmp/render-svc.$$ | tail -8; echo "FAIL"; exit 1; }
ok "GET /health → 200"

# helper: POST /render, capture status + Content-Type + body size
render(){ # $1=json  -> $CODE $CT $SZ ; body in /tmp/render-body.$$
  CODE=$(curl -s -X POST "$base/render" -H "Content-Type: application/json" --data "$1" \
         -D /tmp/render-hdr.$$ -o /tmp/render-body.$$ -w '%{http_code}')
  CT=$(grep -i '^content-type:' /tmp/render-hdr.$$ | tr -d '\r' | awk '{print $2}')
  SZ=$(wc -c < /tmp/render-body.$$ | tr -d ' ')
}

render '{"code":"setcpm(120/4)\nstack(sound(\"bd*4\").bank(\"RolandTR909\"))","cycles":2,"format":"mp3"}'
{ [ "$CODE" = 200 ] && [ "$CT" = "audio/mpeg" ] && [ "$SZ" -gt 2000 ]; } \
  && ok "POST /render valid → 200 audio/mpeg ($SZ bytes)" || bad "render mp3 (code=$CODE ct=$CT sz=$SZ)"

render '{"code":"setcpm(120/4)\nstack(sound(\"hh*8\"))","cycles":2,"format":"wav"}'
{ [ "$CODE" = 200 ] && [ "$CT" = "audio/wav" ] && head -c4 /tmp/render-body.$$ | grep -q "RIFF"; } \
  && ok "POST /render format=wav → 200 RIFF audio ($SZ bytes)" || bad "render wav (code=$CODE ct=$CT sz=$SZ)"

render '{"code":"[stack(sound(\"bd*4\"))]"}'
[ "$CODE" = 422 ] && ok "POST /render [..]-wrap → 422 (fast structural reject)" || bad "render invalid-wrap (code=$CODE)"

render '{"code":"this is not strudel at all, just prose"}'
[ "$CODE" = 422 ] && ok "POST /render non-Strudel → 422 (engine rejects)" || bad "render prose (code=$CODE sz=$SZ)"

render '{"format":"mp3"}'
[ "$CODE" = 400 ] && ok "POST /render missing code → 400" || bad "render no-code (code=$CODE)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$base/nope")
[ "$CODE" = 404 ] && ok "unknown path → 404" || bad "404 ($CODE)"

echo
if [ "$fails" -eq 0 ]; then echo "PASS"; else echo "$fails FAILED"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
