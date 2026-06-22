#!/usr/bin/env bash
# test-song-links.sh — strudel-song-links.mjs must turn a full song into one SELF-CONTAINED,
# gate-passing strudel.cc link per section (intro/verse/chorus/…). Deterministic, no LLM.
# Run: scripts/test-song-links.sh
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fails=0
chk(){ if [ "$2" = 1 ]; then printf '  \033[32mok\033[0m   %s\n' "$1"; else printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); fi; }

cat > "$tmp/song.js" <<'SONG'
setcpm(136/4)
const drums = stack(
  sound("bd*4").bank("RolandTR909").gain(0.95),
  sound("hh*8").gain(0.4).swing(4)
)
const bass = note("a1 a1 g1 e1").sound("sawtooth").lpf(700).gain(0.82)
const chords = n("0 1 2 1").scale("A3:phrygian").sound("piano").room(0.22).gain(0.42)
const hook = n("<7 6 4 3>").scale("A4:phrygian").sound("square").lpf(1800).gain(0.46)
const intro = stack(chords.gain(0.24), bass.gain(0.2))
const verse = stack(drums, bass, chords)
const chorus = stack(drums, bass, chords.gain(0.5), hook)
const outro = stack(chords.gain(0.2).room(0.5))
arrange([4,intro],[8,verse],[8,chorus],[8,verse],[8,chorus],[4,outro])
SONG

node "$here/strudel-song-links.mjs" < "$tmp/song.js" > "$tmp/links.txt"
n=$(wc -l < "$tmp/links.txt" | tr -d ' ')
[ "${n:-0}" -eq 4 ] && chk "one link per distinct section (intro/verse/chorus/outro = 4)" 1 || chk "4 section links (got ${n:-0})" 0
for s in intro verse chorus outro; do
  cut -f1 "$tmp/links.txt" | grep -qx "$s" && chk "has a link for '$s'" 1 || chk "has a link for '$s'" 0
done
gate=1
while IFS=$'\t' read -r name link; do
  b64="${link#*#}"
  python3 -c "import sys,base64;sys.stdout.buffer.write(base64.b64decode(sys.argv[1]))" "$b64" > "$tmp/s.js" 2>/dev/null || gate=0
  node "$here/render/render.mjs" "$(cat "$tmp/s.js")" "$tmp/s.wav" 1 >/dev/null 2>&1 || gate=0
done < "$tmp/links.txt"
chk "every section link decodes + passes the parse-gate (self-contained)" "$gate"
nl=$(printf 'setcpm(120/4)\nstack(sound("bd*4"))\n' | node "$here/strudel-song-links.mjs" | wc -l | tr -d ' ')
[ "${nl:-1}" -eq 0 ] && chk "a plain loop yields no section links" 1 || chk "loop yields no links (got ${nl:-?})" 0
a="$(node "$here/strudel-song-links.mjs" < "$tmp/song.js" | shasum)"; b="$(node "$here/strudel-song-links.mjs" < "$tmp/song.js" | shasum)"
[ "$a" = "$b" ] && chk "deterministic (same song → same links)" 1 || chk "deterministic" 0

echo; [ "$fails" = 0 ] && { echo "PASS — per-section song links"; exit 0; } || { echo "$fails FAILED"; exit 1; }
