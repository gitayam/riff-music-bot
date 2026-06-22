#!/usr/bin/env bash
# watch.sh — launcher for the Strudel → Discord voice-message auto-delivery watcher.
# Sources the gitignored .env (bot token + guild) then runs strudel-watch.py in
# --loop --send mode, so every reply the bot posts with a Strudel block becomes a
# rendered voice message. Run alongside the daemon (or via the launchd agent).
#   ./scripts/watch.sh [poll_seconds]   # default 8s
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # zeroclaw dir
[ -f "$DIR/.env" ] || { echo "error: $DIR/.env not found (bot token + guild)" >&2; exit 1; }
set -a; . "$DIR/.env"; set +a
exec python3 -u "$DIR/scripts/strudel-watch.py" --loop "${1:-8}" --send   # -u: unbuffered → log shows each poll
