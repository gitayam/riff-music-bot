#!/usr/bin/env bash
# voice-deliver.sh — Strudel beat + a SPOKEN vocal layer → one Discord voice message.
#
# The vocal text comes from one of two user flows (matches "quotes of what to say" OR
# "leave it to the bot"):
#   --say "stay focused, you got this"     # verbatim — the quoted line
#   --message 'lofi beat "we ride at dawn"'# extract the first "..." quote from a raw message
#   --message 'make me a hype track' --auto# no quote → the bot AUTHORS a short hook (LLM)
#   --auto --vibe "dark techno"            # author a hook for a vibe
#
# Pipeline:  lint(advisory) → render Strudel→WAV → TTS the line → mix voice over beat
#            → Opus/OGG → waveform meta → deliver (DRY-RUN unless --send + --channel).
#
#   voice-deliver.sh --code beat.js --say "..." [--voice ash] [--style "..."]
#                    [--cycles 4] [--channel <id>] [--send] [--keep DIR]
#   (--code '-' reads Strudel code from stdin)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"     # render/
zc="$(cd "$here/.." && pwd)"                              # zeroclaw/

codesrc="" say="" message="" auto="" vibe="" voice="ash" cycles=""   # empty → auto-sized from code (song = full length, loop = 4)
style="Speak clearly and musically, like a vocal hook over a beat."
channel="" send="" keep="" out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --code)    codesrc="$2"; shift 2;;
    --say)     say="$2"; shift 2;;
    --message) message="$2"; shift 2;;
    --auto)    auto=1; shift;;
    --vibe)    vibe="$2"; shift 2;;
    --voice)   voice="$2"; shift 2;;
    --style)   style="$2"; shift 2;;
    --cycles)  cycles="$2"; shift 2;;
    --channel) channel="$2"; shift 2;;
    --send)    send=1; shift;;
    --keep)    keep="$2"; shift 2;;
    --out)     out="$2"; shift 2;;
    *) echo "voice-deliver.sh: unknown arg '$1'" >&2; exit 2;;
  esac
done
die() { echo "✗ deliver: $*" >&2; exit 1; }
[ -n "$codesrc" ] || die "missing --code <file|->"

# Load env once (OPENAI_API for TTS + authoring; DISCORD_BOT_TOKEN for delivery).
[ -f "$zc/.env" ] && { set -a; . "$zc/.env"; set +a; }

# ── Resolve the vocal text ────────────────────────────────────────────────────
extract_quote() { # first "..." | '...' | “...” span, quotes stripped
  printf '%s' "$1" | grep -oE '"[^"]+"|'\''[^'\'']+'\''|“[^”]+”' | head -1 \
    | sed -E 's/^["'\''“]//; s/["'\''”]$//'
}
author_hook() { # LLM writes a short spoken hook; $1 = vibe/context
  local ctx="$1"
  [ -n "${OPENAI_API:-}" ] || die "--auto needs OPENAI_API"
  local sys="You are a hook writer. Reply with ONE short spoken-word line (max 10 words) to say over a music loop. No quotes, no emojis, no explanation — just the line."
  local body resp line
  body="$(jq -nc --arg s "$sys" --arg u "Vibe/context: ${ctx:-a catchy loop}" \
    '{model:"gpt-5.4-mini", reasoning_effort:"low", max_completion_tokens:60,
      messages:[{role:"system",content:$s},{role:"user",content:$u}]}')"
  resp="$(curl -sS https://api.openai.com/v1/chat/completions \
    -H "Authorization: Bearer $OPENAI_API" -H "Content-Type: application/json" -d "$body")"
  line="$(printf '%s' "$resp" | jq -r '.choices[0].message.content // empty' | tr -d '\r' | sed -E 's/^["“]//; s/["”]$//' | head -1)"
  [ -n "$line" ] || die "authoring failed: $(printf '%s' "$resp" | head -c 200)"
  printf '%s' "$line"
}

text="$say"
if [ -z "$text" ] && [ -n "$message" ]; then text="$(extract_quote "$message")"; fi
if [ -z "$text" ] && [ -n "$auto" ]; then
  text="$(author_hook "${vibe:-$message}")"
  echo "✎ authored hook: \"$text\""
fi
[ -n "$text" ] || die "no vocal text — pass --say, a quoted --message, or --auto"

# ── Work area ─────────────────────────────────────────────────────────────────
if [ -n "$keep" ]; then mkdir -p "$keep"; tmp="$keep"; else tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT; fi
code="$(if [ "$codesrc" = "-" ]; then cat; else cat "$codesrc"; fi)"
# Auto-size the render: an arrange(...) song renders for the SUM of its section bars (else it gets
# cut to the intro); a plain loop = 4. Explicit --cycles still wins.
[ -n "$cycles" ] || cycles="$(printf '%s' "$code" | "$zc/scripts/strudel-cycles.sh" -)"

echo "── 1/6 lint (advisory)"
printf '%s' "$code" | "$zc/scripts/strudel-lint.sh" || echo "   (lint flagged — render is the real gate)"

echo "── 2/6 render Strudel → WAV"
printf '%s' "$code" | node "$here/strudel-render.mjs" "$tmp/beat.wav" "$cycles"

echo "── 3/6 TTS the line"
"$here/tts.sh" --text "$text" --out "$tmp/voice.wav" --voice "$voice" --instructions "$style"

echo "── 4/6 mix voice over beat"
"$here/voice-mix.sh" --music "$tmp/beat.wav" --voice "$tmp/voice.wav" --out "$tmp/mixed.wav"

echo "── 5/6 transcode → Opus/OGG + waveform"
ffmpeg -hide_banner -v error -y -i "$tmp/mixed.wav" \
  -af "alimiter=limit=0.95" -c:a libopus -b:a 32k -ac 1 -ar 48000 "$tmp/voice-message.ogg"
node "$here/strudel-waveform.mjs" "$tmp/mixed.wav" > "$tmp/meta.json"  # WAV parser; same audio as the ogg
echo "   ogg $(wc -c <"$tmp/voice-message.ogg" | tr -d ' ') bytes · $(jq -r '.duration_secs' "$tmp/meta.json")s"
[ -n "$out" ] && { cp "$tmp/voice-message.ogg" "$out"; echo "   saved → $out"; }

echo "── 6/6 deliver"
# Reuse the other session's poster (positional: <ogg> [channel_id] [--send]; it computes
# its own waveform). Only invoke on --send so the local dry-run stays fully offline.
if [ -n "$send" ] && [ -n "$channel" ]; then
  "$zc/scripts/discord-voice.sh" "$tmp/voice-message.ogg" "$channel" --send
elif [ -n "$channel" ]; then
  echo "   DRY-RUN (no --send) — would post to channel $channel."
  echo "   to post:  $zc/scripts/discord-voice.sh '$out' $channel --send   (after --out)"
else
  echo "   DRY-RUN — ogg ready${out:+ at $out} (pass --out to keep it, then --channel/--send to post)"
fi
echo "✓ done: \"$text\""
