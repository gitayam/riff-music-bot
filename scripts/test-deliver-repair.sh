#!/usr/bin/env bash
# test-deliver-repair.sh — deterministic test of strudel-deliver.sh's auto-repair branch.
# Stubs the repair command (STRUDEL_REPAIR_CMD) so NO LLM is needed: feeds deliver.sh invalid
# code and verifies (1) a repair that returns VALID code → deliver re-gates and proceeds to
# render, and (2) a repair that returns INVALID code → deliver aborts WITHOUT delivering.
# Needs node + render deps (it does one real ~8s render in case 1). Run: scripts/test-deliver-repair.sh
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deliver="$here/strudel-deliver.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fails=0
chk(){ if [ "$2" = 1 ]; then printf '  \033[32mok\033[0m   %s\n' "$1"; else printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); fi; }

INVALID='[stack(sound("bd*4"))]'                       # [..]-wrap → the gate rejects it
VALID='stack(sound("bd*4").bank("RolandTR909"))'

printf '#!/usr/bin/env bash\nprintf "%%s\\n" %q\n' "$VALID"   > "$tmp/repair_ok.sh"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" %q\n' "$INVALID" > "$tmp/repair_bad.sh"
chmod +x "$tmp/repair_ok.sh" "$tmp/repair_bad.sh"

echo "case 1 — repair returns VALID code (deliver should re-gate + render):"
out1="$(printf '%s' "$INVALID" | STRUDEL_REPAIR_CMD="$tmp/repair_ok.sh" "$deliver" - 2>&1 || true)"
echo "$out1" | grep -q "auto-repair produced valid code" && a=1 || a=0;  chk "detects gate failure and repairs" "$a"
echo "$out1" | grep -qE "2b/4 render|transcode"          && b=1 || b=0;  chk "proceeds to render the fixed code" "$b"

echo "case 2 — repair returns INVALID code (deliver must abort):"
out2="$(printf '%s' "$INVALID" | STRUDEL_REPAIR_CMD="$tmp/repair_bad.sh" "$deliver" - 2>&1 || true)"
echo "$out2" | grep -q "auto-repair failed"              && c=1 || c=0;  chk "aborts with 'auto-repair failed'" "$c"
echo "$out2" | grep -qE "2b/4 render|transcode|4/4 deliver" && d=0 || d=1; chk "does NOT render or deliver invalid code" "$d"

echo; [ "$fails" = 0 ] && { echo "PASS — deliver auto-repair flow correct"; exit 0; } || { echo "$fails FAILED"; exit 1; }
