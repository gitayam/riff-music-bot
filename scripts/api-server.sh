#!/usr/bin/env bash
# api-server.sh — launch the synchronous music API (POST /generate, /render ; GET /health).
# Sources the gitignored .env so MUSIC_API_TOKEN (auth) + OPENAI_API (the agent) are present.
#   ./scripts/api-server.sh                 # binds 127.0.0.1:8787 (set MUSIC_API_PORT to change)
# Expose to other groups with a Cloudflare tunnel pointed at $MUSIC_API_PORT, e.g.:
#   cloudflared tunnel --url http://localhost:8787
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$DIR/.env" ] && { set -a; . "$DIR/.env"; set +a; }
exec python3 -u "$DIR/scripts/api-server.py"
