#!/usr/bin/env bash
# test-cycles.sh — strudel-cycles.sh must size a song by the SUM of its arrange() bars (so the
# render isn't truncated or over-long) and must NOT be fooled by mini-notation chords [a,b,c]
# that look like arrange pairs. Deterministic, no LLM. Run: scripts/test-cycles.sh
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cyc="$here/strudel-cycles.sh"
fails=0
chk(){ if [ "$2" = "$3" ]; then printf '  \033[32mok\033[0m   %s = %s\n' "$1" "$2"; else printf '  \033[31mFAIL\033[0m %s: got %s want %s\n' "$1" "$2" "$3"; fails=$((fails+1)); fi; }
got(){ printf '%s' "$1" | "$cyc" - "${2:-4}"; }

chk "soul SONG = sum of bars" \
  "$(got 'arrange([4,intro],[8,verse],[8,chorus],[8,verse],[8,chorus],[8,bridge],[8,chorus],[4,outro])')" 56
chk "plain loop → default 4"        "$(got 'setcpm(120/4)
stack(sound("bd*4"))')" 4
chk "loop honours custom default"   "$(got 'stack(sound("bd*4"))' 8)" 8
chk "chord [2,7,11] NOT counted"    "$(got 'arrange([4,intro],[8, n("[2,7,11]").sound("piano")],[4,outro])')" 16
chk "spaced pairs [ 2 , a ]"        "$(got 'arrange([ 2 , a ],[ 6 , b ])')" 8
chk "short ABAB song"               "$(got 'arrange([4,a],[4,b])')" 8

echo; [ "$fails" = 0 ] && { echo "PASS — cycle sizing correct"; exit 0; } || { echo "$fails FAILED"; exit 1; }
