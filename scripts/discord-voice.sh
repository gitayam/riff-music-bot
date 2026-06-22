#!/usr/bin/env bash
# discord-voice.sh — post a Strudel render to Discord as a native VOICE MESSAGE.
#
#   ./discord-voice.sh tune.ogg                 # DRY RUN (default): verify token + show payload, post nothing
#   ./discord-voice.sh tune.ogg <channel_id> --send   # actually post the voice message
#
# Needs DISCORD_BOT_TOKEN in env. Load it from the gitignored .env first, e.g.:
#   ( set -a; . ./.env; set +a; ./scripts/discord-voice.sh tune.ogg )
#
# Voice messages = a message with flags 8192 (IS_VOICE_MESSAGE), exactly ONE audio
# attachment carrying duration_secs + a base64 waveform, and NO text/embeds. Upload is a
# 3-step REST flow (reserve upload URL -> PUT bytes -> create message). Audio must be
# Opus-in-OGG. The bot needs Send Messages + Attach Files in the target channel.
set -euo pipefail

ogg="${1:?usage: discord-voice.sh <audio.ogg> [channel_id] [--send]}"
channel="${2:-}"
mode="${3:-}"
: "${DISCORD_BOT_TOKEN:?DISCORD_BOT_TOKEN not set — source zeroclaw/.env first}"
API="https://discord.com/api/v10"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
jget() { python3 -c 'import sys,json;print(json.load(sys.stdin)'"$1"')'; }

[ -f "$ogg" ] || { echo "no such file: $ogg" >&2; exit 1; }
size=$(wc -c < "$ogg" | tr -d ' ')
meta="$(python3 "$here/strudel-waveform.py" "$ogg")"
wf="$(printf '%s' "$meta" | jget '["waveform"]')"
dur="$(printf '%s' "$meta" | jget '["duration_secs"]')"

# Always-safe: prove the token authenticates and identify the bot (read-only).
echo "── auth (GET /users/@me):"
curl -sf -H "Authorization: Bot $DISCORD_BOT_TOKEN" "$API/users/@me" \
  | jget '["username"]' | sed 's/^/  bot user: /' || { echo "  ✗ token rejected"; exit 1; }
echo "  audio: $size bytes · duration ${dur}s · waveform ${#wf} b64 chars"

if [ "$mode" != "--send" ]; then
  echo "── DRY RUN — nothing posted. To post: $0 $ogg <channel_id> --send"
  exit 0
fi
[ -n "$channel" ] || { echo "✗ --send needs a <channel_id>" >&2; exit 1; }

echo "── step 1/3: reserve upload slot"
up="$(curl -sf -H "Authorization: Bot $DISCORD_BOT_TOKEN" -H 'Content-Type: application/json' \
      -X POST "$API/channels/$channel/attachments" \
      -d "{\"files\":[{\"filename\":\"voice-message.ogg\",\"file_size\":$size,\"id\":\"2\"}]}")"
url="$(printf '%s' "$up" | jget '["attachments"][0]["upload_url"]')"
ufn="$(printf '%s' "$up" | jget '["attachments"][0]["upload_filename"]')"

echo "── step 2/3: upload bytes"
curl -sf -X PUT -H 'Content-Type: audio/ogg' --data-binary "@$ogg" "$url"

echo "── step 3/3: create voice message"
curl -sf -H "Authorization: Bot $DISCORD_BOT_TOKEN" -H 'Content-Type: application/json' \
  -X POST "$API/channels/$channel/messages" \
  -d "{\"flags\":8192,\"attachments\":[{\"id\":\"0\",\"filename\":\"voice-message.ogg\",\"uploaded_filename\":\"$ufn\",\"duration_secs\":$dur,\"waveform\":\"$wf\"}]}" \
  | jget '["id"]' | sed 's/^/✓ posted voice message id /'
