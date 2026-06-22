#!/usr/bin/env bash
# strudel-repair.sh — ask the agent (Riff / gpt-5.4) to fix invalid Strudel code and print the
# corrected code to stdout. Used by strudel-deliver.sh's parse-gate: when the agent's posted
# reply doesn't parse, the Discord voice-message path self-heals instead of silently dropping
# the reply (the same guarantee the sync API's /generate gives). Exits non-zero if no code
# block comes back. Mirrors api-server.py's generate()+gate, for the channel/delivery path.
#
#   strudel-repair.sh "<broken code>" "<parse error>"
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
code="${1:?usage: strudel-repair.sh <code> [error]}"
err="${2:-it failed to parse}"

prompt="This Strudel code failed to parse. Error: ${err}
Return ONLY corrected, valid Strudel in a single \`\`\`javascript code block — no prose. Keep the
musical intent; change only what's invalid (and never wrap the whole program in [ ])."$'\n\n'"${code}"

# Capture stdout+stderr (the reply block may surface in either, as in api-server.py).
out="$(timeout 175 "$root/run.sh" agent -a hermes -m "$prompt" 2>&1)" || true
# Extract the first ```javascript|js ... ``` block.
fixed="$(printf '%s\n' "$out" | awk '/```/{ if(f){exit}; if($0 ~ /javascript|js/){f=1}; next } f{print}')"
[ -n "${fixed//[[:space:]]/}" ] || { echo "strudel-repair: agent returned no code block" >&2; exit 1; }
printf '%s\n' "$fixed"
