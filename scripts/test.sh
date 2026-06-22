#!/usr/bin/env bash
# test.sh — run the whole reliability regression suite in one command.
#
#   ./scripts/test.sh
#
# Deterministic: no LLM, no Discord, no .env needed (the auto-repair suites stub the agent and
# do real local Chromium renders, ~30s total). This answers "is the CODE correct"; the separate
# strudel-doctor.sh answers "is the LIVE system demo-ready" (services, auth, deps). Exits
# non-zero if any suite fails — wire into pre-commit / CI / pre-demo.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0; fail=0; failed=""
run() { # <name> <cmd...>
  local name="$1"; shift
  printf '\n\033[1m▶ %s\033[0m\n' "$name"
  if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed $name"; fi
}

run "cycle sizing"          bash    "$here/test-cycles.sh"
run "soul examples parse"   python3 "$here/test-soul-examples.py"
run "sync-API auto-repair"  python3 "$here/test-auto-repair.py"
run "deliver auto-repair"   bash    "$here/test-deliver-repair.sh"
run "generative radio (HLS)" bash   "$here/test-radio.sh"
run "steerable radio server" bash   "$here/test-radio-serve.sh"
run "radio channel-mood seed" python3 "$here/test-radio-mood.py"
run "song section links"     bash    "$here/test-song-links.sh"
run "watcher section msgs"   python3 "$here/test-watch-sections.py"
run "self-heal watchdog"     bash    "$here/test-watchdog.sh"
run "cloudflare worker (P0)" bash    "$here/../worker/test.sh"
run "render service (P1)"    bash    "$here/../container/test.sh"

echo
echo "═══════════════════════════════════════════"
if [ "$fail" = 0 ]; then
  printf '\033[32m✓ ALL %d test suites passed\033[0m\n' "$pass"; exit 0
else
  printf '\033[31m✗ %d/%d suites FAILED:%s\033[0m\n' "$fail" "$((pass+fail))" "$failed"; exit 1
fi
