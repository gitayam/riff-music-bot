#!/usr/bin/env bash
# health-check.sh — Riff production-stack health probe (R2.2). Checks the four live pieces and, on
# ANY failure, posts an alert to ntfy. Designed to run on the Proxmox host as a systemd timer
# (deploy/riff-health.{service,timer}) — but it is IN-REPO ONLY; installing it on the host is D2.
#
#   bash scripts/health-check.sh            # check + alert on failure (exit 1 if any check failed)
#   bash scripts/health-check.sh --dry-run  # check + PRINT the alert instead of POSTing (read-only)
#
# Checks:
#   1. hermes        — systemctl is-active $HERMES_SERVICE        (SKIP off a systemd host, e.g. a Mac)
#   2. strudel-watch — heartbeat file age <= $WATCH_STALE seconds (SKIP if the file doesn't exist)
#   3. riff-render   — GET $RENDER_HEALTH_URL returns HTTP 200    (/health is open; /render is bearer-gated)
#   4. worker        — GET $WORKER_HEALTH_URL returns 200 + {"ok" ...}
# Everything is overridable by env so the same script works on the host and for a local read-only check.
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HERMES_SERVICE="${HERMES_SERVICE:-zeroclaw-hermes}"
WATCH_HEARTBEAT="${WATCH_HEARTBEAT:-$DIR/data/strudel-watch.heartbeat}"
WATCH_STALE="${WATCH_STALE:-120}"                 # heartbeat age (s) beyond which the watcher loop is hung
RENDER_HEALTH_URL="${RENDER_HEALTH_URL:-https://riff-render.juntogroups.org/health}"
WORKER_HEALTH_URL="${WORKER_HEALTH_URL:-https://riff-music-api.wemea-5ahhf.workers.dev/health}"
NTFY_SERVER="${NTFY_SERVER:-https://ntfy.alfaren.xyz}"
NTFY_TOPIC="${NTFY_TOPIC:-riff-health}"
CURL_TIMEOUT="${CURL_TIMEOUT:-10}"

DRY_RUN=""
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
[ -n "${HEALTH_DRY_RUN:-}" ] && DRY_RUN=1

fails=""   # newline-separated "label: reason" for each failed check
note() { printf '  %-14s %s\n' "$1" "$2"; }
fail() { note "$1" "FAIL — $2"; fails="${fails}${1}: ${2}"$'\n'; }

# Portable mtime (epoch secs): GNU coreutils (Linux host) then BSD/macOS (local verify).
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }

echo "riff health-check @ $(date -u +%FT%TZ)${DRY_RUN:+  (dry-run)}"

# 1) hermes (the Discord @mention agent) — systemd only.
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet "$HERMES_SERVICE"; then note "hermes" "OK (active)"
  else fail "hermes" "$HERMES_SERVICE not active"; fi
else
  note "hermes" "SKIP (no systemctl — not on the Linux host)"
fi

# 2) strudel-watch heartbeat freshness.
if [ -f "$WATCH_HEARTBEAT" ]; then
  age=$(( $(date +%s) - $(mtime "$WATCH_HEARTBEAT") ))
  if [ "$age" -le "$WATCH_STALE" ]; then note "strudel-watch" "OK (heartbeat ${age}s)"
  else fail "strudel-watch" "heartbeat stale ${age}s (> ${WATCH_STALE}s) — loop hung"; fi
else
  note "strudel-watch" "SKIP (no heartbeat file: $WATCH_HEARTBEAT)"
fi

# 3) riff-render /health (open; bearer only gates /render).
rc=$(curl -s -o /dev/null -w '%{http_code}' -m "$CURL_TIMEOUT" "$RENDER_HEALTH_URL" 2>/dev/null || echo 000)
if [ "$rc" = "200" ]; then note "riff-render" "OK (HTTP 200)"; else fail "riff-render" "$RENDER_HEALTH_URL → HTTP $rc"; fi

# 4) Worker /health (must be 200 and report ok).
body=$(curl -s -m "$CURL_TIMEOUT" -w $'\n%{http_code}' "$WORKER_HEALTH_URL" 2>/dev/null || printf '\n000')
wc_code="${body##*$'\n'}"; wc_body="${body%$'\n'*}"
if [ "$wc_code" = "200" ] && printf '%s' "$wc_body" | grep -q '"ok"'; then note "worker" "OK (HTTP 200)"
else fail "worker" "$WORKER_HEALTH_URL → HTTP $wc_code"; fi

# Alert on any failure.
if [ -n "$fails" ]; then
  msg="Riff health check FAILED:"$'\n'"$fails"
  echo "--- FAILURES ---"; printf '%s' "$fails"
  if [ -n "$DRY_RUN" ]; then
    echo "DRY-RUN: would POST to ${NTFY_SERVER}/${NTFY_TOPIC} (Priority: high)"
  else
    curl -fsS -m "$CURL_TIMEOUT" \
      -H "Title: Riff stack unhealthy" -H "Priority: high" -H "Tags: warning,musical_note" \
      -d "$msg" "${NTFY_SERVER}/${NTFY_TOPIC}" >/dev/null 2>&1 \
      || echo "WARN: ntfy POST to ${NTFY_SERVER}/${NTFY_TOPIC} failed"
  fi
  exit 1
fi

echo "all checks passed"
exit 0
