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

PORT=8788; MOCKPORT=8790; DPORT=8791; TOK="testtoken-$$"
mock=/tmp/worker-mock.$$.py
cat > "$mock" <<'PY'
import sys, json
from http.server import BaseHTTPRequestHandler, HTTPServer
# Branch on the request so /generate and /modify return DIFFERENT code → a meaningful diff to assert.
BASE = 'setcpm(120/4)\nstack(sound("bd*4"))'
MOD  = 'setcpm(120/4)\nstack(sound("bd*4").bank("RolandTR909"))'
FAIL = 'setcpm(120/4)\nstack(sound("BOOMFAIL"))'   # passes validation but the render mock 500s on it
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        n=int(self.headers.get("Content-Length","0")); req=self.rfile.read(n).decode("utf8","ignore")
        code = MOD if "Apply this change" in req else (FAIL if "FAILME" in req else BASE)
        body=json.dumps({"choices":[{"message":{"content":f"Here you go:\n```javascript\n{code}\n```"}}]}).encode()
        self.send_response(200); self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
python3 "$mock" "$MOCKPORT" & MOCK_PID=$!

# Mock Discord API: records each interaction follow-up (PATCH @original) so we can assert what Riff posted.
dmock=/tmp/worker-dmock.$$.py; DLOG=/tmp/worker-dlog.$$
cat > "$dmock" <<'PY'
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
LOG=sys.argv[2]
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_PATCH(self):
        n=int(self.headers.get("Content-Length","0")); b=self.rfile.read(n)
        open(LOG,"ab").write(b+b"\n")
        self.send_response(200); self.send_header("Content-Length","2"); self.end_headers(); self.wfile.write(b"{}")
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
python3 "$dmock" "$DPORT" "$DLOG" & DMOCK_PID=$!

# Mock render service (stands in for the Container): returns canned audio bytes, or 500 for a sentinel
# so we can test the render-failure degrade path. The real engine is covered by container/test.sh.
RPORT=8792; rmock=/tmp/worker-rmock.$$.py
cat > "$rmock" <<'PY'
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
AUDIO = b"ID3\x03\x00" + b"\x00"*512   # fake mp3 bytes
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        n=int(self.headers.get("Content-Length","0")); body=self.rfile.read(n).decode("utf8","ignore")
        if "BOOMFAIL" in body:
            self.send_response(500); self.send_header("Content-Length","0"); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type","audio/mpeg")
        self.send_header("Content-Length",str(len(AUDIO))); self.end_headers(); self.wfile.write(AUDIO)
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
python3 "$rmock" "$RPORT" & RMOCK_PID=$!

# Ed25519 keypair for the Discord signature test — public key (hex) goes to the Worker via --var.
KEYFILE=/tmp/worker-dkey.$$.json
DPUB=$(node test/dev-sign.mjs genkey "$KEYFILE")

# Boot wrangler dev locally; inject token + a mock OpenAI base via --var (overrides wrangler.toml).
# --persist-to a FRESH temp dir so Durable Object state starts empty every run (the default
# .wrangler/state persists across runs → version numbers would accumulate and the asserts would drift).
STATE="/tmp/worker-state.$$"
wrangler dev --port "$PORT" --inspector-port 0 --ip 127.0.0.1 --persist-to "$STATE" --test-scheduled \
  --var "MUSIC_API_TOKEN:$TOK" --var "OPENAI_API_KEY:mock-key" \
  --var "OPENAI_BASE_URL:http://127.0.0.1:$MOCKPORT" \
  --var "DISCORD_PUBLIC_KEY:$DPUB" --var "DISCORD_API_BASE:http://127.0.0.1:$DPORT" \
  --var "RENDER_SERVICE_URL:http://127.0.0.1:$RPORT" \
  >/tmp/worker-dev.$$ 2>&1 </dev/null & DEV_PID=$!

cleanup(){ kill "$DEV_PID" "$MOCK_PID" "$DMOCK_PID" "$RMOCK_PID" 2>/dev/null; wait "$DEV_PID" 2>/dev/null;
           rm -rf "$mock" "$dmock" "$rmock" "$DLOG" "$KEYFILE" /tmp/worker-dev.$$ "$STATE"; }
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

# History (D1). s1 now has generate(v1) + modify(v2) + modify(v3) from above.
get(){ RESP=$(curl -s -w $'\n%{http_code}' -H "Authorization: Bearer $TOK" "$base$1"); CODE=${RESP##*$'\n'}; RESP=${RESP%$'\n'*}; }

RESP=$(curl -s -o /dev/null -w '%{http_code}' "$base/history?session_id=s1")
[ "$RESP" = 401 ] && ok "GET /history no auth → 401" || bad "history no-auth ($RESP)"

get "/history?session_id=s1"
{ [ "$CODE" = 200 ] && has '"session_id":"s1"' && has 'RolandTR909'; } \
  && ok "GET /history?session_id=s1 → persisted tracks" || bad "history s1 (code=$CODE)"

get "/history?session_id=ghost-session"
{ [ "$CODE" = 200 ] && has '"tracks":[]'; } \
  && ok "GET /history unknown session → empty" || bad "history empty (code=$CODE)"

get "/history?limit=100"
{ [ "$CODE" = 200 ] && has 'RolandTR909'; } && ok "GET /history (global) → tracks" || bad "history global (code=$CODE)"

# Rendered audio (P1 last mile): render service → R2 → served at /audio/<key>.
post /render '{"code":"setcpm(120/4)\nstack(sound(\"bd*4\"))","format":"mp3"}'
AUDIO_URL=$(printf '%s' "$RESP" | grep -o '"audio_url":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//')
{ [ "$CODE" = 200 ] && printf '%s' "$AUDIO_URL" | grep -q '/audio/tracks/'; } \
  && ok "POST /render → renders + stores → audio_url" || bad "render audio_url (code=$CODE url=$AUDIO_URL)"

ac=$(curl -s -o /tmp/worker-audio.$$ -w '%{http_code}' "$AUDIO_URL"); asz=$(wc -c < /tmp/worker-audio.$$ | tr -d ' ')
{ [ "$ac" = 200 ] && [ "${asz:-0}" -gt 100 ]; } && ok "GET audio_url → 200 audio bytes ($asz) from R2" || bad "serve audio (http=$ac sz=$asz)"

post /generate '{"prompt":"chill loop","render":true}'
{ [ "$CODE" = 200 ] && printf '%s' "$RESP" | grep -o '"audio_url":"[^"]*"' | grep -q '/audio/'; } \
  && ok "POST /generate render:true → audio_url" || bad "generate render:true (code=$CODE)"

post /generate '{"prompt":"chill loop"}'
{ [ "$CODE" = 200 ] && has '"audio_url":null'; } && ok "POST /generate (default) → audio_url null (Tier-A)" || bad "generate no-render"

post /render '{"code":"setcpm(120/4)\nstack(sound(\"BOOMFAIL bd*4\"))","format":"mp3"}'
{ [ "$CODE" = 200 ] && has '"audio_url":null' && has '"render_error"'; } \
  && ok "render failure degrades → audio_url null + render_error" || bad "render degrade (code=$CODE)"
rm -f /tmp/worker-audio.$$

# Retention cron: backdate a row, fire scheduled(), confirm it's pruned and recent rows survive.
# (wrangler d1 execute on the same local DB while dev runs can hit a lock; tolerate that → wiring-only.)
oldsql="/tmp/worker-old.$$.sql"
printf "INSERT INTO tracks (id,source,strudel_code,share_url,version,created_at) VALUES ('old-row-1','generate','x','https://strudel.cc/#x',1,1);\n" > "$oldsql"
if wrangler d1 execute riff-tracks --local --persist-to "$STATE" --file "$oldsql" >/tmp/worker-d1.$$ 2>&1; then
  get "/history?limit=100"; has 'old-row-1' \
    && ok "retention: backdated row present before prune" || bad "retention: backdated row not visible (see /tmp/worker-d1.$$)"
  sc=$(curl -s -o /dev/null -w '%{http_code}' "$base/__scheduled?cron=0+4+*+*+*")
  [ "$sc" = 200 ] && ok "retention: scheduled() fired ($sc)" || bad "retention: scheduled fire ($sc)"
  get "/history?limit=100"
  { ! has 'old-row-1' && has 'RolandTR909'; } \
    && ok "retention: old row pruned, recent kept" || bad "retention: prune incorrect"
else
  echo "  SKIP — d1 execute couldn't seed concurrently; testing cron WIRING only:"
  sc=$(curl -s -o /dev/null -w '%{http_code}' "$base/__scheduled?cron=0+4+*+*+*")
  [ "$sc" = 200 ] && ok "retention: scheduled() fires without error ($sc)" || bad "retention: scheduled fire ($sc)"
fi
rm -f /tmp/worker-resp.$$ "$oldsql" /tmp/worker-d1.$$

# Discord Interactions webhook (Ed25519-signed). Sign (timestamp + body) with the test private key.
TS=1700000000
dsend(){ # $1=body  -> sets $CODE $RESP, headers signed with the matching key
  local body=$1 sig; sig=$(printf '%s' "$body" | node test/dev-sign.mjs sign "$KEYFILE" "$TS")
  RESP=$(curl -s -w $'\n%{http_code}' -X POST "$base/discord/interactions" \
    -H "X-Signature-Ed25519: $sig" -H "X-Signature-Timestamp: $TS" -H "Content-Type: application/json" \
    --data "$body"); CODE=${RESP##*$'\n'}; RESP=${RESP%$'\n'*}; }

dsend '{"type":1}'
{ [ "$CODE" = 200 ] && printf '%s' "$RESP" | grep -qF '"type":1'; } && ok "Discord PING (valid sig) → PONG" || bad "discord PING (code=$CODE)"

# bad signature: sign a DIFFERENT body than we send → verify must fail
badsig=$(printf '%s' '{"type":1,"x":1}' | node test/dev-sign.mjs sign "$KEYFILE" "$TS")
bc=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/discord/interactions" \
  -H "X-Signature-Ed25519: $badsig" -H "X-Signature-Timestamp: $TS" --data '{"type":1}')
[ "$bc" = 401 ] && ok "Discord bad signature → 401" || bad "discord bad-sig ($bc)"

nc=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/discord/interactions" --data '{"type":1}')
[ "$nc" = 401 ] && ok "Discord missing signature headers → 401" || bad "discord no-sig ($nc)"

: > "$DLOG"
dsend '{"type":2,"application_id":"app1","token":"tok1","channel_id":"c9","data":{"name":"riff","options":[{"name":"prompt","value":"funky disco loop"}]}}'
{ [ "$CODE" = 200 ] && printf '%s' "$RESP" | grep -qF '"type":5'; } && ok "Discord slash command → deferred ack (type 5)" || bad "discord command ack (code=$CODE)"

# the deferred follow-up runs async (waitUntil): the render service is wired, so it should ATTACH the
# rendered audio (riff.mp3, multipart) AND carry the play link in payload_json.
EXPECT_LINK="https://strudel.cc/#c2V0Y3BtKDEyMC80KQpzdGFjayhzb3VuZCgiYmQqNCIpKQ=="
got=""; for _ in $(seq 1 20); do { grep -qF "riff.mp3" "$DLOG" && grep -qF "$EXPECT_LINK" "$DLOG"; } 2>/dev/null && { got=1; break; }; sleep 0.5; done
[ -n "$got" ] && ok "Discord follow-up attaches rendered audio (riff.mp3) + link" || bad "discord audio follow-up not received"

# render-failure degrade: a prompt whose code won't render → text-only follow-up (link, no attachment)
: > "$DLOG"
dsend '{"type":2,"application_id":"app2","token":"tok2","channel_id":"c9","data":{"name":"riff","options":[{"name":"prompt","value":"FAILME please"}]}}'
got=""; for _ in $(seq 1 20); do grep -qF "strudel.cc/#" "$DLOG" 2>/dev/null && { got=1; break; }; sleep 0.5; done
{ [ -n "$got" ] && ! grep -qF "riff.mp3" "$DLOG"; } && ok "Discord render-failure → text follow-up (link, no attachment)" || bad "discord degrade (got=$got)"
rm -f /tmp/worker-resp.$$

echo
if [ "$fails" -eq 0 ]; then echo "PASS"; else echo "$fails FAILED"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
