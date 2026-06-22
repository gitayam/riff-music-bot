#!/usr/bin/env bash
# zeroclaw launcher — keeps all config/state in THIS dir and injects secrets
# from the gitignored .env as runtime config overrides (never written to disk).
#
#   ./run.sh agent -a hermes -m "hello"   # one-off Mistral chat
#   ./run.sh agent -a hermes              # interactive chat
#   ./run.sh daemon                       # always-on: serves Discord channel
#   ./run.sh channel doctor               # health-check configured channels
#   ./run.sh <any zeroclaw subcommand>
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${ZEROCLAW_BIN:-$HOME/.cargo/bin/zeroclaw}"

[ -f "$DIR/.env" ] || { echo "error: $DIR/.env not found (holds the API keys)" >&2; exit 1; }
[ -x "$BIN" ]      || { echo "error: zeroclaw binary not found at $BIN" >&2; exit 1; }

# Load secrets
set -a; . "$DIR/.env"; set +a

# All config + runtime state lives in this project dir
export ZEROCLAW_CONFIG_DIR="$DIR"
export ZEROCLAW_DATA_DIR="$DIR"

# Inject secrets via zeroclaw's env-override mechanism (in-memory only).
# Path maps the config dotted-path with '__' for each '.'.
export ZEROCLAW_providers__models__mistral__hermes__api_key="${MISTRAL_API_KEY:?MISTRAL_API_KEY missing in .env}"
export ZEROCLAW_channels__discord__default__bot_token="${DISCORD_BOT_TOKEN:?DISCORD_BOT_TOKEN missing in .env}"
# OpenAI (key is named OPENAI_API in .env) → openai.gpt5 provider for the creative music model
export ZEROCLAW_providers__models__openai__gpt5__api_key="${OPENAI_API:?OPENAI_API missing in .env}"

# Sync tracked soul(s) into each agent's (gitignored) workspace so the runtime
# identity always reflects the version-controlled source. souls/<agent>.SOUL.md
# -> agents/<agent>/workspace/SOUL.md (the file zeroclaw reads for openclaw identity).
for soul in "$DIR"/souls/*.SOUL.md; do
  [ -e "$soul" ] || continue
  agent="$(basename "$soul" .SOUL.md)"
  ws="$DIR/agents/$agent/workspace"
  mkdir -p "$ws"
  cp -f "$soul" "$ws/SOUL.md"
done

exec "$BIN" "$@"
