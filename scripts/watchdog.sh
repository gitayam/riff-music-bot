#!/usr/bin/env bash
# watchdog.sh — self-heal the zeroclaw bot daemon.
#
# WHY: launchd KeepAlive only restarts on a *crash*. The failure we hit was a ZOMBIE —
# the process stayed alive and the gateway heartbeat looked "ok", but the Discord
# connection silently stopped delivering messages (restart_count never incremented, so
# zeroclaw's own reconnect never fired). KeepAlive can't see that. This can.
#
# Checks (cheap; run on a launchd StartInterval, default 120s). Restart on ANY:
#   1. daemon process not running
#   2. gateway /health unreachable
#   3. discord channel status != "ok"
#   4. discord channel "last_ok" older than STALE_MAX seconds (dead heartbeat = zombie)
# Every action is logged to watchdog.log with a reason. Restart = launchctl kickstart -k
# (sessions persist in sqlite, so conversation context survives the bounce).
set -uo pipefail

LABEL="com.zeroclaw.hermes"
UID_N="$(id -u)"
PORT="${ZC_GATEWAY_PORT:-42617}"
GW="http://127.0.0.1:${PORT}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$DIR/watchdog.log"
STATE="$DIR/.watchdog-fails"            # consecutive-failure counter (avoids boot-window false trips)
STALE_MAX="${STALE_MAX:-240}"           # discord last_ok age (s) beyond which we treat as a dead gateway
GRACE="${GRACE:-45}"                    # don't judge a daemon younger than this (still booting)
FAIL_THRESHOLD="${FAIL_THRESHOLD:-2}"   # restart only after N consecutive bad checks

log()     { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
restart() { log "RESTART — reason: $1"; : >"$STATE"; launchctl kickstart -k "gui/$UID_N/$LABEL" >>"$LOG" 2>&1 || log "  kickstart failed (exit $?)"; }
healthy() { [ -s "$STATE" ] && : >"$STATE"; exit 0; }   # reset counter, stay quiet

# A failing check increments the counter; we only restart once it persists, so a transient
# blip or the daemon's own ~10s boot doesn't trigger a restart loop.
soft_fail() {
  n=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$STATE"
  if [ "$n" -ge "$FAIL_THRESHOLD" ]; then restart "$1 (x$n)"; else log "unhealthy: $1 ($n/$FAIL_THRESHOLD — watching)"; fi
  exit 0
}

# 1) process alive? (hard fail — but KeepAlive usually beats us to it)
pgrep -f "zeroclaw daemon" >/dev/null 2>&1 || soft_fail "daemon process not running"

# 2) /health reachable? + 3/4) discord status, last_ok age, and uptime grace (one python pass)
health="$(curl -s -m 5 "$GW/health" 2>/dev/null || true)"
[ -n "$health" ] || soft_fail "/health unreachable on :$PORT"

verdict="$(printf '%s' "$health" | STALE_MAX="$STALE_MAX" GRACE="$GRACE" python3 -c '
import sys, json, os
from datetime import datetime, timezone
try:
    d = json.load(sys.stdin); rt = d["runtime"]
    if rt.get("uptime_seconds", 1e9) < float(os.environ["GRACE"]):
        print("OK"); sys.exit(0)                       # just booted — give it a moment
    c = rt["components"].get("channel:discord.default", {})
    status = c.get("status", "missing")
    if status != "ok": print(f"discord status={status}"); sys.exit(0)
    last_ok = c.get("last_ok")
    if not last_ok: print("discord last_ok missing"); sys.exit(0)
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(last_ok)).total_seconds()
    if age > float(os.environ["STALE_MAX"]): print(f"discord stale: last_ok {int(age)}s ago"); sys.exit(0)
    print("OK")
except Exception as e:
    print(f"health parse error: {e}")
' 2>/dev/null || echo "health parse failed")"

[ "$verdict" = "OK" ] && healthy
soft_fail "$verdict"
