#!/usr/bin/env bash
# strudel-link.sh — deterministically build a strudel.cc play link from Strudel code.
#
#   ./strudel-link.sh pattern.js     # link from a file
#   pbpaste | ./strudel-link.sh      # link from stdin
#
# strudel.cc encodes the pattern as base64 of the literal code in the URL hash
# (verified: https://strudel.cc/#<base64> decodes to the code). The LLM must NOT
# hand-encode this — it can't do base64 reliably, which is why bot links were broken.
# This does it correctly. Pair with strudel-lint.sh: lint first, then link.
set -euo pipefail
code="$(cat "${1:-/dev/stdin}")"
b64="$(printf '%s' "$code" | base64 | tr -d '\n')"
printf 'https://strudel.cc/#%s\n' "$b64"
