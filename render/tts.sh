#!/usr/bin/env bash
# tts.sh — speak a line with OpenAI's steerable TTS (gpt-4o-mini-tts) → WAV.
#
#   tts.sh --text "stay focused, you got this" --out voice.wav
#   tts.sh --text "..." --out voice.wav --voice ash --instructions "calm, warm, lo-fi"
#
# This is the *spoken* voice layer for Riff — a quote/hook spoken over the beat (NOT sung;
# OpenAI has no singing model — see docs/sundai-zeroclaw-music-roadmap.md). Reads the key
# from $OPENAI_API (env) or the repo's gitignored .env, same pattern as discord-voice.sh.
# Requests WAV directly so it mixes with the Strudel render without a transcode.
#
# Voices: alloy ash ballad coral echo fable nova onyx sage shimmer verse marin cedar.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # zeroclaw/
API="https://api.openai.com/v1/audio/speech"
MODEL="gpt-4o-mini-tts"

text="" out="" voice="ash" instructions="Speak clearly and musically, with a warm, natural rhythm — like a vocal hook over a beat."
while [ $# -gt 0 ]; do
  case "$1" in
    --text)         text="$2"; shift 2;;
    --out)          out="$2"; shift 2;;
    --voice)        voice="$2"; shift 2;;
    --instructions) instructions="$2"; shift 2;;
    *) echo "tts.sh: unknown arg '$1'" >&2; exit 2;;
  esac
done
die() { echo "✗ tts: $*" >&2; exit 1; }
[ -n "$text" ] || die "missing --text"
[ -n "$out" ]  || die "missing --out"

if [ -z "${OPENAI_API:-}" ] && [ -f "$DIR/.env" ]; then
  set -a; . "$DIR/.env"; set +a
fi
[ -n "${OPENAI_API:-}" ] || die "OPENAI_API not set (env or $DIR/.env)"

body="$(jq -nc --arg m "$MODEL" --arg v "$voice" --arg i "$text" --arg ins "$instructions" \
  '{model:$m, voice:$v, input:$i, instructions:$ins, response_format:"wav"}')"

code="$(curl -sS -o "$out" -w '%{http_code}' "$API" \
  -H "Authorization: Bearer $OPENAI_API" -H "Content-Type: application/json" -d "$body")"

case "$code" in
  200) ;;
  *) echo "✗ tts: OpenAI HTTP $code" >&2; head -c 400 "$out" >&2; echo >&2; rm -f "$out"; exit 1;;
esac
[ "$(wc -c < "$out" | tr -d ' ')" -gt 1000 ] || die "TTS output suspiciously small"
echo "✓ tts: '${text:0:48}' → $out ($(wc -c < "$out" | tr -d ' ') bytes, voice=$voice)"
