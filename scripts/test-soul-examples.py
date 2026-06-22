#!/usr/bin/env python3
"""test-soul-examples.py — every ```javascript example in the soul MUST pass the parse-gate.

The agent is told to copy the soul's "bulletproof templates" verbatim, so an invalid example
there becomes invalid output in the live demo — this is exactly how the .swingBy(1/3) bug
shipped (the soul listed an invalid example and the model imitated it). This extracts each
fenced javascript block from souls/hermes.SOUL.md and runs it through the same pure-node
parse-gate the pipeline uses. No LLM, no Chromium. Run: python3 scripts/test-soul-examples.py
"""
import os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOUL = os.path.join(ROOT, "souls", "hermes.SOUL.md")
GATE = os.path.join(HERE, "render", "render.mjs")   # pure-node parse-gate (exits non-zero on invalid)
# accept ```javascript and ```js (matches the pipeline's CODE_RE) so a js-fenced example
# is never silently skipped; \s*\n absorbs any trailing space after the language tag.
BLOCK_RE = re.compile(r"```(?:javascript|js)\s*\n(.*?)```", re.S)


def gate(code):
    with tempfile.TemporaryDirectory() as td:
        r = subprocess.run(["node", GATE, code, os.path.join(td, "g.wav"), "1"],
                           capture_output=True, text=True, timeout=60)
    return r.returncode == 0, (r.stderr.strip().splitlines() or [""])[-1]


def main():
    src = open(SOUL, encoding="utf-8").read()
    blocks = [b.strip() for b in BLOCK_RE.findall(src)]
    if not blocks:
        print("no ```javascript examples found in soul — nothing to validate")
        return 0
    fails = 0
    for i, code in enumerate(blocks, 1):
        ok, err = gate(code)
        head = (code.splitlines() or ["(empty)"])[0][:64]
        if ok:
            print(f"  \033[32mok\033[0m   example {i}: {head}")
        else:
            print(f"  \033[31mFAIL\033[0m example {i}: {head}\n        gate: {err}")
            fails += 1
    print(f"\n{len(blocks)} examples, {fails} FAILED" if fails else f"\nPASS — all {len(blocks)} soul examples parse")
    return 1 if fails else 0


sys.exit(main())
