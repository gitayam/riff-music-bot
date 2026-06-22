#!/usr/bin/env bash
# setup.sh — prepare a fresh clone to run (macOS / Apple Silicon). Idempotent.
#   ./scripts/setup.sh
# Then: edit .env with your keys → ./scripts/install-services.sh → ./scripts/strudel-doctor.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
miss=0

echo "▶ 1/5 system tools"
for t in node ffmpeg python3; do
  if command -v "$t" >/dev/null; then echo "  ✓ $t ($($t --version 2>&1 | head -1))"
  else echo "  ✗ $t missing — 'brew install $t'"; miss=1; fi
done
command -v zeroclaw >/dev/null \
  && echo "  ✓ zeroclaw ($(zeroclaw --version 2>/dev/null | head -1))" \
  || echo "  • zeroclaw not on PATH — it's the runtime; install from https://github.com/zeroclaw-labs/zeroclaw"

echo "▶ 2/6 faithful-render deps (render/)"
( cd render && npm install --no-audit --no-fund >/dev/null 2>&1 ) && echo "  ✓ render/node_modules" || { echo "  ✗ npm install failed in render/"; miss=1; }

echo "▶ 3/6 parse-gate deps (scripts/render/)"
( cd scripts/render && npm install --no-audit --no-fund >/dev/null 2>&1 ) && echo "  ✓ scripts/render/node_modules" || { echo "  ✗ npm install failed in scripts/render/"; miss=1; }

echo "▶ 4/6 headless Chromium (Playwright)"
( cd render && npx --yes playwright install chromium >/dev/null 2>&1 ) && echo "  ✓ chromium" \
  || echo "  • run manually: (cd render && npx playwright install chromium)"

echo "▶ 5/6 offline sample cache (909/808/piano → render/samples-cache/)"
( cd render && node cache-samples.mjs >/dev/null 2>&1 ) && echo "  ✓ sample cache ready (drums render offline)" \
  || echo "  • sample cache incomplete (network?) — rerun: (cd render && node cache-samples.mjs); renders still work online"

echo "▶ 6/6 .env"
if [ -f .env ]; then echo "  ✓ .env exists (leaving it)"
else cp .env.example .env && echo "  ✓ created .env from .env.example — FILL IN your keys"; fi

echo
[ "$miss" = 0 ] && echo "setup OK." || echo "setup finished with missing tools (see ✗ above)."
cat <<'NEXT'
next:
  1) edit .env  →  MISTRAL_API_KEY / OPENAI_API / DISCORD_BOT_TOKEN / DISCORD_GUILD_ID / MUSIC_API_TOKEN
  2) ./scripts/install-services.sh   # start the 3 launchd services (daemon + watcher + music-api)
  3) ./scripts/strudel-doctor.sh     # verify everything (aim for all ✓)
NEXT
