#!/usr/bin/env bash
# strudel-lint.sh — heuristic guard that a Strudel snippet uses only known functions.
#
#   ./strudel-lint.sh pattern.js        # lint a file
#   pbpaste | ./strudel-lint.sh         # lint stdin
#
# Exit 0 = clean, 1 = unknown function(s) found. This is a CHEAP guard, not a real
# parser: it strips string literals, pulls every `name(` call, and checks it against
# the list of real Strudel functions below. It reliably catches the common Mistral
# hallucinations (.base/.gtrain/.repeat/...). The real fix is a node-based
# @strudel/transpiler parse gate — see docs/sundai-zeroclaw-music-roadmap.md.
set -euo pipefail

# Real Strudel functions (broad — errs toward accepting valid code).
ALLOW="sound note n s freq stack cat slowcat fastcat seq superimpose layer \
setcpm setcps scale transpose add sub mul bank gain velocity pan \
lpf hpf cutoff hcutoff lpq resonance lpenv lpattack lpdecay lpsustain lprelease \
room roomsize roomfade roomlp roomdim size orbit delay delaytime delayfeedback delayfb \
crush distort dist shape coarse vowel \
fast slow rev iter ply hurry early late off rot palindrome \
struct euclid euclidLegato euclidInv mask swingBy swing \
every when sometimes someCycles often rarely almostAlways degradeBy undegradeBy \
range rangex sine cosine saw isaw tri square perlin rand irand run arrange chunk \
voicings voicing chord arp arpeggiate jux juxBy press legato clip attack release sustain hold \
gh begin end speed loopAt chop striate segment slice splice"

code="$(cat "${1:-/dev/stdin}")"
# strip string literals so contents like "bd c3" aren't parsed as calls
stripped="$(printf '%s' "$code" | sed -E 's/"[^"]*"//g' | sed -E "s/'[^']*'//g")"
calls="$(printf '%s' "$stripped" | grep -oE '[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*\(' \
        | sed -E 's/[[:space:]]*\($//' | sort -u || true)"

unknown=""
for c in $calls; do
  case " $ALLOW " in *" $c "*) ;; *) unknown="$unknown $c" ;; esac
done

if [ -n "$unknown" ]; then
  echo "✗ UNKNOWN Strudel function(s):$unknown"
  exit 1
fi
echo "✓ OK — only known Strudel functions"
