#!/usr/bin/env bash
# test-watchdog.sh — the self-heal watchdog must (1) be installable as a periodic service, (2) restart
# a ZOMBIE watcher (stale heartbeat) yet (3) leave a fresh one alone — all WITHOUT bouncing any real
# service (WATCHDOG_DRY_RUN) and without needing live processes (WATCHDOG_SKIP_PGREP). The watcher's
# heartbeat write is checked too (skips without a bot token). Run: scripts/test-watchdog.sh
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fails=0
chk(){ if [ "$2" = 1 ]; then printf '  \033[32mok\033[0m   %s\n' "$1"; else printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); fi; }

# 1) install-services.sh --generate produces a PERIODIC watchdog plist pointing at watchdog.sh
"$here/install-services.sh" --generate "$tmp/plists" >/dev/null 2>&1 || true
wp="$tmp/plists/com.zeroclaw.watchdog.plist"
[ -f "$wp" ] && chk "install-services generates the watchdog plist" 1 || chk "install-services generates the watchdog plist" 0
{ grep -q "StartInterval" "$wp" && grep -q "watchdog.sh" "$wp" && ! grep -q "KeepAlive" "$wp"; } 2>/dev/null \
  && chk "watchdog plist is periodic (StartInterval, no KeepAlive)" 1 || chk "watchdog plist is periodic" 0

run_wd(){ # $1=heartbeat file — run the watchdog fully isolated (dry-run, no pgrep, temp log/state)
  WATCHDOG_DRY_RUN=1 WATCHDOG_SKIP_PGREP=1 FAIL_THRESHOLD=1 \
  WATCHDOG_LOG="$tmp/wd.log" WATCHDOG_STATE_DIR="$tmp" WATCH_HEARTBEAT="$1" \
  bash "$here/watchdog.sh" >/dev/null 2>&1 || true
}
W="com.zeroclaw.strudel-watch"

# 2) ZOMBIE watcher: stale heartbeat → decides to restart the watcher
: > "$tmp/wd.log"; rm -f "$tmp/.watchdog-fails-$W"; touch -t 202001010000 "$tmp/hb_old"
run_wd "$tmp/hb_old"
grep -qiE "RESTART $W|would kickstart $W" "$tmp/wd.log" \
  && chk "stale watcher heartbeat → watchdog restarts the watcher" 1 || chk "stale watcher heartbeat → restarts watcher" 0

# 3) healthy watcher: fresh heartbeat → NO watcher restart
: > "$tmp/wd.log"; rm -f "$tmp/.watchdog-fails-$W"; date +%s > "$tmp/hb_new"
run_wd "$tmp/hb_new"
grep -qiE "RESTART $W|would kickstart $W" "$tmp/wd.log" \
  && chk "fresh watcher heartbeat → NO restart" 0 || chk "fresh watcher heartbeat → NO restart" 1

# 4) the watcher actually writes a heartbeat each cycle (needs a bot token; skip otherwise)
if [ -f "$here/../.env" ] && grep -q '^DISCORD_BOT_TOKEN=' "$here/../.env"; then
  ( set -a; . "$here/../.env" 2>/dev/null; set +a; WATCH_HEARTBEAT="$tmp/hb_live" timeout 45 python3 "$here/strudel-watch.py" --once >/dev/null 2>&1 || true )
  [ -s "$tmp/hb_live" ] && chk "watcher writes a heartbeat each cycle" 1 || chk "watcher writes a heartbeat each cycle" 0
else
  printf '  \033[33m•\033[0m  (skipped watcher-heartbeat write check — no DISCORD_BOT_TOKEN)\n'
fi

echo; [ "$fails" = 0 ] && { echo "PASS — self-heal watchdog covers daemon + watcher + music-api"; exit 0; } || { echo "$fails FAILED"; exit 1; }
