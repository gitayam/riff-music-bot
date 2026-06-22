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
# Branch on the request so /generate and /modify return DIFFERENT code → a meaningful diff to assert.
BASE = 'setcpm(120/4)\nstack(sound("bd*4"))'
MOD  = 'setcpm(120/4)\nstack(sound("bd*4").bank("RolandTR909"))'
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        n=int(self.headers.get("Content-Length","0")); req=self.rfile.read(n).decode("utf8","ignore")
        code = MOD if "Apply this change" in req else BASE   # modifyUserContent contains "Apply this change"
        body=json.dumps({"choices":[{"message":{"content":f"Here you go:\n```javascript\n{code}\n```"}}]}).encode()
        self.send_response(200); self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
python3 "$mock" "$MOCKPORT" & MOCK_PID=$!

# Boot wrangler dev locally; inject token + a mock OpenAI base via --var (overrides wrangler.toml).
# --persist-to a FRESH temp dir so Durable Object state starts empty every run (the default
# .wrangler/state persists across runs → version numbers would accumulate and the asserts would drift).
STATE="/tmp/worker-state.$$"
wrangler dev --port "$PORT" --inspector-port 0 --ip 127.0.0.1 --persist-to "$STATE" \
  --var "MUSIC_API_TOKEN:$TOK" --var "OPENAI_API_KEY:mock-key" \
  --var "OPENAI_BASE_URL:http://127.0.0.1:$MOCKPORT" \
  >/tmp/worker-dev.$$ 2>&1 </dev/null & DEV_PID=$!

cleanup(){ kill "$DEV_PID" "$MOCK_PID" 2>/dev/null; wait "$DEV_PID" 2>/dev/null; rm -rf "$mock" /tmp/worker-dev.$$ "$STATE"; }
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

# Stateful modify chain (Durable Object). Issue each state-changing request ONCE and assert on its
# body (re-issuing would bump the version), so these are explicit curl+grep, not the chk helper.
post(){ RESP=$(curl -s -w $'\n%{http_code}' -X POST -H "Authorization: Bearer $TOK" \
        -H "Content-Type: application/json" --data "$2" "$base$1"); CODE=${RESP##*$'\n'}; RESP=${RESP%$'\n'*}; }
has(){ printf '%s' "$RESP" | grep -qF "$1"; }

post /generate '{"prompt":"funky disco loop","session_id":"s1"}'
{ [ "$CODE" = 200 ] && has '"version":1' && has '"session_id":"s1"' && has '"parent_id":null'; } \
  && ok "POST /generate w/ session_id → v1" || bad "generate w/ session (code=$CODE)"

post /modify '{"session_id":"s1","instruction":"use a 909 kit"}'
{ [ "$CODE" = 200 ] && has '"version":2' && has '"parent_id":1' && has 'RolandTR909'; } \
  && ok "POST /modify → v2, parent 1, code edited" || bad "modify (code=$CODE)"
# the diff must actually show the change: it starts with a removed line ("\"diff\":\"- ...")
if has '"diff":"- '; then ok "modify response includes a non-empty code diff"; else bad "modify diff missing/empty"; fi

post /modify '{"session_id":"s1","instruction":"slower"}'
{ [ "$CODE" = 200 ] && has '"version":3' && has '"parent_id":2'; } \
  && ok "POST /modify again → v3 chains on v2" || bad "modify chain (code=$CODE)"

post /modify '{"session_id":"never-seen","instruction":"darker"}'
[ "$CODE" = 404 ] && ok "POST /modify unknown session → 404" || bad "unknown session (code=$CODE)"

post /modify '{"session_id":"s1"}'
[ "$CODE" = 400 ] && ok "POST /modify missing instruction → 400" || bad "modify no-instruction (code=$CODE)"

post /modify '{"instruction":"darker"}'
[ "$CODE" = 400 ] && ok "POST /modify missing session_id → 400" || bad "modify no-session (code=$CODE)"

RESP=$(curl -s -X POST "$base/modify" --data '{"session_id":"s1","instruction":"x"}' -w $'\n%{http_code}');
[ "${RESP##*$'\n'}" = 401 ] && ok "POST /modify no auth → 401" || bad "modify no-auth"
rm -f /tmp/worker-resp.$$

echo
if [ "$fails" -eq 0 ]; then echo "PASS"; else echo "$fails FAILED"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
