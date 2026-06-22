#!/usr/bin/env bash
# strudel-doctor.sh — pre-demo health check for the whole Strudel → Discord voice-message pipeline.
# READ-ONLY: posts nothing to Discord (the only network call is GET /users/@me to verify the token).
#
#   ( set -a; . ./.env; set +a; ./scripts/strudel-doctor.sh )
#
# Exit 0 = all critical checks pass. Non-zero = something a demo would trip on.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
pass=0; fail=0; warn=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
no()   { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
meh()  { printf '  \033[33m•\033[0m %s\n' "$1"; warn=$((warn+1)); }

echo "── prerequisites"
command -v node >/dev/null  && ok "node $(node -v)"                         || no "node missing"
command -v ffmpeg >/dev/null && { ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libopus \
    && ok "ffmpeg + libopus" || no "ffmpeg present but no libopus encoder"; } || no "ffmpeg missing (brew install ffmpeg)"
command -v python3 >/dev/null && ok "python3 $(python3 -V 2>&1 | awk '{print $2}')" || no "python3 missing"

echo "── render engines"
[ -d "$root/render/node_modules" ]         && ok "Option A (faithful) deps installed"      || no "render/: run 'npm install' in zeroclaw/render"
[ -d "$here/render/node_modules" ]         && ok "Option B (parse-gate) deps installed"    || no "scripts/render/: run 'npm install'"
ls "$HOME/Library/Caches/ms-playwright/" 2>/dev/null | grep -qi chromium \
    && ok "Playwright Chromium installed" || no "Chromium missing (npx playwright install chromium)"

echo "── parse-gate (pure-node)"
if node "$here/render/render.mjs" 'stack(sound("bd*4"))' /tmp/_doc_g.wav 1 >/dev/null 2>&1; then ok "gate passes valid code"; else no "gate rejects VALID code"; fi
if node "$here/render/render.mjs" '[stack(sound("bd"))]' /tmp/_doc_b.wav 1 >/dev/null 2>&1; then no "gate ACCEPTS invalid [..]-wrap"; else ok "gate rejects invalid code"; fi
{ [ -x "$here/strudel-repair.sh" ] && grep -q "auto-repair" "$here/strudel-deliver.sh"; } \
  && ok "deliver path self-heals (auto-repair wired)" || meh "deliver auto-repair not wired (gate fail → no voice message)"

echo "── soul / capabilities"
[ -f "$root/souls/hermes.SOUL.md" ] && ok "soul present (souls/hermes.SOUL.md)" || no "soul missing"
grep -q "what can you do" "$root/souls/hermes.SOUL.md" 2>/dev/null && ok "help menu present in soul" || no "help menu missing from soul"
# The model copies the soul's template examples verbatim — an invalid one ships invalid output.
if python3 "$here/test-soul-examples.py" >/dev/null 2>&1; then ok "soul Strudel examples all parse (the model copies these)"
else no "a soul example FAILS the parse-gate → model will copy invalid code (run: python3 scripts/test-soul-examples.py)"; fi
grep -q 'fallback' "$root/config.toml" 2>/dev/null && ok "model fallback configured" || meh "no model fallback in config.toml"

echo "── Discord bot auth (read-only)"
if [ -n "${DISCORD_BOT_TOKEN:-}" ]; then
  u="$(curl -sf -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
        -H 'User-Agent: DiscordBot (strudel-doctor, 0.1)' https://discord.com/api/v10/users/@me 2>/dev/null \
       | python3 -c 'import sys,json;print(json.load(sys.stdin)["username"])' 2>/dev/null)"
  [ -n "$u" ] && ok "bot token authenticates ($u)" || no "bot token set but auth failed"
else meh "DISCORD_BOT_TOKEN not in env (source .env to test auth + delivery)"; fi

echo "── services (both must run for @mention → voice message)"
launchctl print "gui/$(id -u)/com.zeroclaw.hermes" 2>/dev/null | grep -q 'state = running' \
    && ok "daemon running (com.zeroclaw.hermes)" || meh "daemon not running (./run.sh daemon, or launchctl bootstrap)"
# The watcher is what turns bot replies into voice messages. If it's down, the bot
# replies text-only and "nothing happens" — the exact failure we hit. Fail loudly.
if launchctl print "gui/$(id -u)/com.zeroclaw.strudel-watch" 2>/dev/null | grep -q 'state = running'; then
  ok "auto-delivery watcher running (com.zeroclaw.strudel-watch)"
else
  no "watcher DOWN → replies never become voice messages. Start: launchctl kickstart -k gui/$(id -u)/com.zeroclaw.strudel-watch (or ./scripts/watch.sh)"
fi
# Music API (external HTTP prompt→music). Optional for the Discord demo, so warn (not fail).
if curl -sf -m 4 http://127.0.0.1:8799/health >/dev/null 2>&1; then
  ok "music API up (http://127.0.0.1:8799 — expose via cloudflared for other groups)"
elif launchctl print "gui/$(id -u)/com.zeroclaw.music-api" 2>/dev/null | grep -q 'state = running'; then
  meh "music API service loaded but not answering on :8799 yet"
else
  meh "music API not running (./scripts/api-server.sh, or load com.zeroclaw.music-api) — only needed for external HTTP access"
fi

echo "── offline render (no-CDN guarantee: @strudel/web bundle must load from local node_modules)"
# Renders a synth pattern with ALL non-localhost requests blocked. If the bundle were still
# loaded from a CDN (esm.sh) the page would error and produce no WAV — so a passing render
# here proves the bundle is vendored local and a network blip can't blank the render.
if [ -d "$root/render/node_modules" ]; then
  _off=/tmp/_doc_offline.wav; rm -f "$_off"
  if printf '%s' 'note("c3 eb3 g3").sound("sawtooth").lpf(900)' \
       | STRUDEL_BLOCK_EXTERNAL=1 timeout 150 node "$root/render/strudel-render.mjs" "$_off" 2 >/dev/null 2>&1 \
       && [ -f "$_off" ] && [ "$(wc -c < "$_off" 2>/dev/null || echo 0)" -gt 1000 ]; then
    ok "renders with all CDNs blocked ($(wc -c < "$_off") bytes — bundle is local)"
  else
    no "offline render FAILED → @strudel/web may be loading from a CDN again (network blip = dead render)"
  fi
  rm -f "$_off"
else meh "skipped offline render check (render/ deps missing)"; fi

echo "── offline drums (sample cache: 909/808/piano render with the network blocked)"
# WAV size doesn't distinguish silence (uncompressed PCM), so assert a real waveform peak:
# if the cached _base didn't resolve, the drums are silent and peak stays near 0.
if [ -d "$root/render/samples-cache" ]; then
  _d=/tmp/_doc_drums.wav; rm -f "$_d"
  if printf '%s' 'stack(sound("bd*4").bank("RolandTR909").gain(0.9), sound("hh*8").bank("RolandTR909").gain(0.4))' \
       | STRUDEL_BLOCK_EXTERNAL=1 timeout 150 node "$root/render/strudel-render.mjs" "$_d" 2 >/dev/null 2>&1 \
     && peak=$(node "$root/render/strudel-waveform.mjs" "$_d" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const b=Buffer.from(JSON.parse(s).waveform_b64,"base64");let m=0;for(const v of b)m=v>m?v:m;console.log(m)}catch{console.log(0)}})') \
     && [ "${peak:-0}" -gt 60 ]; then
    ok "909/808 drums render offline from cache (peak ${peak}/255)"
  else
    no "offline drum render silent/failed → run '(cd render && node cache-samples.mjs)' (or the cached _base broke)"
  fi
  rm -f "$_d"
else
  meh "no sample cache → drums still need network. Run: (cd render && node cache-samples.mjs) for offline drums"
fi

echo "── offline dirt drums (bare bd/hh/cp from the cached dirt pack, network blocked)"
if [ -f "$root/render/samples-cache/dirt.json" ]; then
  _dd=/tmp/_doc_dirt.wav; rm -f "$_dd"
  if printf '%s' 'stack(sound("bd*4").gain(0.9), sound("~ cp").gain(0.7), sound("hh*8").gain(0.4))' \
       | STRUDEL_BLOCK_EXTERNAL=1 timeout 150 node "$root/render/strudel-render.mjs" "$_dd" 2 >/dev/null 2>&1 \
     && peak=$(node "$root/render/strudel-waveform.mjs" "$_dd" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const b=Buffer.from(JSON.parse(s).waveform_b64,"base64");let m=0;for(const v of b)m=v>m?v:m;console.log(m)}catch{console.log(0)}})') \
     && [ "${peak:-0}" -gt 60 ]; then
    ok "bare dirt drums render offline from cache (peak ${peak}/255)"
  else
    no "offline dirt render silent/failed → run '(cd render && node cache-samples.mjs)'"
  fi
  rm -f "$_dd"
else
  meh "no dirt cache → bare bd/hh/sd need network. Run: (cd render && node cache-samples.mjs)"
fi

echo "── full chain smoke test (gate → faithful render → ogg → waveform; ~15s, posts nothing)"
if [ -d "$root/render/node_modules" ] && command -v ffmpeg >/dev/null; then
  smoke='setcpm(120/4)
stack(sound("bd*4").bank("RolandTR909"), sound("hh*8").gain(0.4),
      note("c2 c2 eb2 g2").sound("sawtooth").lpf(800),
      n("0 2 4 6").scale("C:minor").sound("piano").room(0.4))'
  if printf '%s' "$smoke" | "$here/strudel-deliver.sh" - 2>&1 | grep -qE 'DRY RUN|audio: [0-9]+ bytes'; then
    ok "full pipeline renders + builds a voice payload"
  else no "full pipeline smoke test failed (run strudel-deliver.sh manually to see why)"; fi
else meh "skipped smoke test (missing render deps or ffmpeg)"; fi

echo
echo "── result: $pass passed, $fail failed, $warn warnings"
[ "$fail" -eq 0 ] && { echo "  pipeline is demo-ready."; exit 0; } || { echo "  fix the ✗ items before demoing."; exit 1; }
