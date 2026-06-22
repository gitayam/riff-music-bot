#!/usr/bin/env bash
# watchdog.sh — self-heal the zeroclaw bot. launchd KeepAlive only restarts on a *crash*; this also
# catches ZOMBIES (process alive but not doing its job, which KeepAlive can't see). Runs on a launchd
# StartInterval (default 120s) and checks each service independently, restarting only the one that's bad:
#   • daemon  (com.zeroclaw.hermes)        — /health + discord channel status + last_ok staleness
#   • watcher (com.zeroclaw.strudel-watch) — process + a heartbeat file it touches each poll cycle
#                                            (a stale heartbeat = the loop hung → replies stop becoming
#                                             voice messages, the exact "it didn't work" failure)
#   • music-api (com.zeroclaw.music-api)   — process + /health
# Each service gets its own consecutive-fail counter; we restart only after FAIL_THRESHOLD bad checks
# so a boot blip doesn't loop. Restart = launchctl kickstart -k (sessions persist in sqlite).
# WATCHDOG_DRY_RUN=1 logs decisions without restarting (tests). All actions logged with a reason.
set -uo pipefail
UID_N="$(id -u)"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${WATCHDOG_LOG:-$DIR/watchdog.log}"
STATE_DIR="${WATCHDOG_STATE_DIR:-$DIR}"
PORT="${ZC_GATEWAY_PORT:-42617}";   GW="http://127.0.0.1:${PORT}"
MUSIC_PORT="${MUSIC_API_PORT:-8799}"
HEARTBEAT="${WATCH_HEARTBEAT:-$DIR/data/strudel-watch.heartbeat}"
STALE_MAX="${STALE_MAX:-240}"          # daemon discord last_ok age (s) beyond which = dead gateway
GRACE="${GRACE:-45}"                   # don't judge a daemon younger than this (still booting)
WATCH_STALE="${WATCH_STALE:-120}"      # watcher heartbeat age (s) beyond which = zombie (polls ~every 8s)
FAIL_THRESHOLD="${FAIL_THRESHOLD:-2}"  # restart only after N consecutive bad checks

log()     { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
proc_up() { [ -n "${WATCHDOG_SKIP_PGREP:-}" ] && return 0; pgrep -f "$1" >/dev/null 2>&1; }   # SKIP_PGREP=tests
sf_file() { echo "$STATE_DIR/.watchdog-fails-$1"; }
ok_svc()  { : >"$(sf_file "$1")" 2>/dev/null || true; }     # reset counter, stay quiet
bad_svc() {  # <label> <reason> — bump the counter; restart once it persists
  local label="$1" reason="$2" sf n; sf="$(sf_file "$label")"
  n=$(( $(cat "$sf" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$sf"
  if [ "$n" -ge "$FAIL_THRESHOLD" ]; then
    log "RESTART $label — reason: $reason (x$n)"; : >"$sf"
    if [ -n "${WATCHDOG_DRY_RUN:-}" ]; then log "  dry-run: would kickstart $label"
    else launchctl kickstart -k "gui/$UID_N/$label" >>"$LOG" 2>&1 || log "  kickstart $label failed (exit $?)"; fi
  else
    log "unhealthy $label: $reason ($n/$FAIL_THRESHOLD — watching)"
  fi
}

check_daemon() {  # crash + zombie (dead discord heartbeat), via the gateway /health
  proc_up "zeroclaw daemon" || { bad_svc com.zeroclaw.hermes "daemon process not running"; return; }
  local health; health="$(curl -s -m 5 "$GW/health" 2>/dev/null || true)"
  [ -n "$health" ] || { bad_svc com.zeroclaw.hermes "/health unreachable on :$PORT"; return; }
  local verdict; verdict="$(printf '%s' "$health" | STALE_MAX="$STALE_MAX" GRACE="$GRACE" python3 -c '
import sys, json, os
from datetime import datetime, timezone
try:
    d=json.load(sys.stdin); rt=d["runtime"]
    if rt.get("uptime_seconds",1e9) < float(os.environ["GRACE"]): print("OK"); sys.exit(0)
    c=rt["components"].get("channel:discord.default",{}); status=c.get("status","missing")
    if status!="ok": print(f"discord status={status}"); sys.exit(0)
    last_ok=c.get("last_ok")
    if not last_ok: print("discord last_ok missing"); sys.exit(0)
    age=(datetime.now(timezone.utc)-datetime.fromisoformat(last_ok)).total_seconds()
    if age>float(os.environ["STALE_MAX"]): print(f"discord stale: last_ok {int(age)}s ago"); sys.exit(0)
    print("OK")
except Exception as e: print(f"health parse error: {e}")
' 2>/dev/null || echo "health parse failed")"
  [ "$verdict" = "OK" ] && ok_svc com.zeroclaw.hermes || bad_svc com.zeroclaw.hermes "$verdict"
}

check_watcher() {  # process + heartbeat freshness (the loop must keep completing cycles)
  proc_up "strudel-watch.py" || { bad_svc com.zeroclaw.strudel-watch "watcher process not running"; return; }
  if [ ! -f "$HEARTBEAT" ]; then
    log "watcher: no heartbeat yet ($HEARTBEAT) — process up, skipping staleness this cycle"; ok_svc com.zeroclaw.strudel-watch; return
  fi
  local age; age=$(( $(date +%s) - $(stat -f %m "$HEARTBEAT" 2>/dev/null || echo 0) ))
  if [ "$age" -gt "$WATCH_STALE" ]; then bad_svc com.zeroclaw.strudel-watch "heartbeat stale ${age}s (loop hung)"; else ok_svc com.zeroclaw.strudel-watch; fi
}

check_music_api() {  # process + /health (the external prompt→music endpoint)
  proc_up "api-server.py" || { bad_svc com.zeroclaw.music-api "music-api process not running"; return; }
  curl -sf -m 5 "http://127.0.0.1:${MUSIC_PORT}/health" >/dev/null 2>&1 \
    && ok_svc com.zeroclaw.music-api || bad_svc com.zeroclaw.music-api "music-api /health unreachable on :$MUSIC_PORT"
}

check_daemon
check_watcher
check_music_api
exit 0
