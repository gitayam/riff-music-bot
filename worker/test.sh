#!/usr/bin/env bash
# test.sh — Worker P0 test suite. (1) pure-helper unit tests, then (2) a live integration pass:
# boot `wrangler dev` (local workerd) against a MOCK OpenAI so the whole /generate path
# (auth → fetch → extract → validate → share_url) is exercised deterministically, offline, with
# no real key and no cost. Unit failures are fatal; if wrangler can't boot (no workerd/network),
# the integration pass SKIPs (so a cron loop isn't broken by an env quirk) but never silently passes.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"
fails=0
ok(){ printf '  \033[32mok\033[0m   %s\n' "$1"; }
bad(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); }

echo "== unit (pure helpers) =="
if node --test test/*.test.mjs >/tmp/worker-unit.$$ 2>&1; then
  ok "node --test ($(grep -c '^✔' /tmp/worker-unit.$$ ) assertions)"
else
  bad "node --test — see below"; sed 's/^/    /' /tmp/worker-unit.$$ | tail -25
fi
rm -f /tmp/worker-unit.$$
[ "$fails" -ne 0 ] && { echo; echo "$fails FAILED (unit)"; exit 1; }

echo "== integration (wrangler dev + mock OpenAI) =="
command -v wrangler >/dev/null 2>&1 || npx wrangler --version >/dev/null 2>&1 || { echo "  SKIP — wrangler not installed"; echo; echo "PASS (unit only)"; exit 0; }

PORT=8788; MOCKPORT=8790; TOK="testtoken-$$"
mock=/tmp/worker-mock.$$.py
cat > "$mock" <<'PY'
import sys, json
from http.server import BaseHTTPRequestHandler, HTTPServer
CODE = 'setcpm(120/4)\nstack(sound("bd*4"))'
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        n=int(self.headers.get("Content-Length","0")); self.rfile.read(n)
        body=json.dumps({"choices":[{"message":{"content":f"Here you go:\n```javascript\n{CODE}\n```"}}]}).encode()
        self.send_response(200); self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
python3 "$mock" "$MOCKPORT" & MOCK_PID=$!

# Boot wrangler dev locally; inject token + a mock OpenAI base via --var (overrides wrangler.toml).
wrangler dev --port "$PORT" --inspector-port 0 --ip 127.0.0.1 \
  --var "MUSIC_API_TOKEN:$TOK" --var "OPENAI_API_KEY:mock-key" \
  --var "OPENAI_BASE_URL:http://127.0.0.1:$MOCKPORT" \
  >/tmp/worker-dev.$$ 2>&1 </dev/null & DEV_PID=$!

cleanup(){ kill "$DEV_PID" "$MOCK_PID" 2>/dev/null; wait "$DEV_PID" 2>/dev/null; rm -f "$mock" /tmp/worker-dev.$$; }
trap cleanup EXIT

base="http://127.0.0.1:$PORT"
up=""; for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$base/health" 2>/dev/null)" = "200" ] && { up=1; break; }
  kill -0 "$DEV_PID" 2>/dev/null || break
  sleep 1
done
if [ -z "$up" ]; then
  echo "  SKIP — wrangler dev did not come up in 60s (workerd/network); dev log tail:"
  sed 's/^/    /' /tmp/worker-dev.$$ | tail -8
  echo; echo "PASS (unit only; integration skipped)"; exit 0
fi

# helper: assert HTTP status (and optional body substring). args: name method path status [auth] [data] [needle]
chk(){ local name=$1 m=$2 p=$3 want=$4 auth=${5:-} data=${6:-} needle=${7:-}
  local args=(-s -X "$m" -o /tmp/worker-resp.$$ -w '%{http_code}')
  [ -n "$auth" ] && args+=(-H "Authorization: Bearer $auth")
  [ -n "$data" ] && args+=(-H "Content-Type: application/json" --data "$data")
  local got; got=$(curl "${args[@]}" "$base$p")
  if [ "$got" != "$want" ]; then bad "$name (want $want got $got)"; return; fi
  if [ -n "$needle" ] && ! grep -qF "$needle" /tmp/worker-resp.$$; then bad "$name (body missing: $needle)"; return; fi
  ok "$name"
}
EXPECT_LINK="https://strudel.cc/#c2V0Y3BtKDEyMC80KQpzdGFjayhzb3VuZCgiYmQqNCIpKQ=="

chk "GET /health → 200 {ok}"                 GET    /health   200 "" "" '"ok":true'
chk "GET / → 200 self-doc"                   GET    /         200 "" "" "Riff music API"
chk "OPTIONS /generate → 204 (CORS)"         OPTIONS /generate 204
chk "POST /generate no auth → 401"           POST   /generate 401 ""    '{"prompt":"x"}'
chk "POST /generate bad token → 401"         POST   /generate 401 wrong '{"prompt":"x"}'
chk "POST /generate missing prompt → 400"    POST   /generate 400 "$TOK" '{}'
chk "POST /generate → 200 code+link (mock)"  POST   /generate 200 "$TOK" '{"prompt":"funky disco loop"}' "$EXPECT_LINK"
chk "POST /generate → audio_url null (P0)"   POST   /generate 200 "$TOK" '{"prompt":"x"}' '"audio_url":null'
chk "POST /render valid → 200 link"          POST   /render   200 "$TOK" '{"code":"setcpm(120/4)\nstack(sound(\"bd*4\"))"}' "$EXPECT_LINK"
chk "POST /render prose → 422"               POST   /render   422 "$TOK" '{"code":"a chill beat please"}'
chk "POST /render [..]-wrap → 422"           POST   /render   422 "$TOK" '{"code":"[stack(sound(\"bd*4\"))]"}'
chk "POST /render missing code → 400"        POST   /render   400 "$TOK" '{}'
rm -f /tmp/worker-resp.$$

echo
if [ "$fails" -eq 0 ]; then echo "PASS"; else echo "$fails FAILED"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
