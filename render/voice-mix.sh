#!/usr/bin/env bash
# voice-mix.sh — lay a spoken voice clip over an instrumental, mixed like a real track.
#
#   voice-mix.sh --music beat.wav --voice voice.wav --out mixed.wav
#                [--delay 0.8] [--tail 1.4] [--music-gain 0.85] [--voice-gain 1.15]
#
# What it does (ffmpeg):
#   • loops the (loop-aligned) instrumental to cover the line + intro + tail
#   • delays the voice so the beat establishes first
#   • DUCKS the music under the voice (sidechain compression) so words stay intelligible
#   • mixes + limits to avoid clipping
# Output: stereo 44.1k WAV (ready for the OGG/Opus transcode in the deliver step).
set -euo pipefail

# TTS output is quiet (~-25 LUFS) vs a rendered beat (~-15 LUFS). We loudness-normalize the
# voice to a target LOUDER than the beat, then duck the beat under it — so the line clearly
# sits on top regardless of how loud any given TTS clip came out.
music="" voice="" out="" delay=0.8 tail=1.4 mgain=0.8 voice_lufs=-14
while [ $# -gt 0 ]; do
  case "$1" in
    --music)      music="$2"; shift 2;;
    --voice)      voice="$2"; shift 2;;
    --out)        out="$2"; shift 2;;
    --delay)      delay="$2"; shift 2;;
    --tail)       tail="$2"; shift 2;;
    --music-gain) mgain="$2"; shift 2;;
    --voice-lufs) voice_lufs="$2"; shift 2;;
    *) echo "voice-mix.sh: unknown arg '$1'" >&2; exit 2;;
  esac
done
die() { echo "✗ mix: $*" >&2; exit 1; }
[ -f "$music" ] || die "missing/!found --music"
[ -f "$voice" ] || die "missing/!found --voice"
[ -n "$out" ]   || die "missing --out"

dur() { ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$1"; }
vdur="$(dur "$voice")"
# target length = intro delay + spoken line + tail, computed with awk (floats).
target="$(awk -v d="$delay" -v v="$vdur" -v t="$tail" 'BEGIN{printf "%.3f", d+v+t}')"
delms="$(awk -v d="$delay" 'BEGIN{printf "%d", d*1000}')"

# -stream_loop -1 loops the instrumental input so atrim always has enough to cover `target`.
# Voice: loudnorm to a target LOUDER than the beat → consistent, intelligible vocal level.
# Beat: ducked under the voice via sidechaincompress so words punch through, then limited.
ffmpeg -hide_banner -v error -y \
  -stream_loop -1 -i "$music" -i "$voice" \
  -filter_complex "
    [0:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${target},asetpts=N/SR/TB,volume=${mgain}[mus];
    [1:a]aresample=44100,aformat=channel_layouts=stereo,loudnorm=I=${voice_lufs}:TP=-1.5:LRA=11,adelay=${delms}|${delms},apad=whole_dur=${target},asplit=2[vkey][vmix];
    [mus][vkey]sidechaincompress=threshold=0.03:ratio=12:attack=5:release=300:makeup=1[duck];
    [duck][vmix]amix=inputs=2:duration=first:normalize=0[mixed];
    [mixed]alimiter=limit=0.95[out]
  " -map "[out]" -ac 2 -ar 44100 -t "${target}" "$out"

[ -s "$out" ] || die "ffmpeg produced no output"
echo "✓ mix: beat + ${vdur}s voice (intro ${delay}s) → $out (${target}s)"
