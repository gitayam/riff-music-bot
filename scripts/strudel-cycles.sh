#!/usr/bin/env bash
# strudel-cycles.sh — how many cycles should the renderer run for this Strudel program?
#
#   strudel-cycles.sh <file|->  [default_loop_cycles]
#
# A loop (`setcpm(...) + stack(...)`) renders for a fixed default (it just repeats).
# A song (`arrange([n, sectionA], [m, sectionB], …)`) must render for the SUM of its
# section bar-counts, or it gets cut off / loops. This sums the leading integer of each
# `[N, …]` pair in the arrange() call (mini-notation like `[2 4]` has no leading `N,` so
# it's not matched). Wire into the deliver/watch step:  --cycles "$(strudel-cycles.sh code.js)"
set -euo pipefail
code="$(cat "${1:-/dev/stdin}")"
def="${2:-4}"
if printf '%s' "$code" | grep -q 'arrange('; then
  # Count only true arrange pairs `[bars, section]`: the char after the comma is the section
  # (an identifier/expression = non-digit), which excludes mini-notation chords like `[0,4,7]`
  # that would otherwise inflate the length (→ over-long renders).
  sum=$(printf '%s' "$code" | grep -oE '\[[[:space:]]*[0-9]+[[:space:]]*,[[:space:]]*[^0-9[:space:]]' | grep -oE '[0-9]+' | awk '{s+=$1} END{print s+0}')
  if [ "${sum:-0}" -gt 0 ]; then echo "$sum"; else echo "$def"; fi
else
  echo "$def"
fi
