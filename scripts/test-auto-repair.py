#!/usr/bin/env python3
"""Deterministic test for api-server.py's auto-repair loop.

No LLM and no live agent — it injects a fake generator and uses the REAL pure-node
parse-gate, so the repair control-flow is tested deterministically. It also renders one
pattern through render_code (real Chromium) to prove the gate refactor didn't break
rendering. Requires node + the render deps (same as the doctor's parse-gate check).

  python3 scripts/test-auto-repair.py        # exit 0 = all pass
"""
import importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("api_server", os.path.join(HERE, "api-server.py"))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)   # safe: the HTTP server only starts under `if __name__ == "__main__"`

VALID = 'stack(sound("bd*4"))'
INVALID = '[stack(sound("bd*4"))]'   # [..]-wrap → the gate rejects it (matches strudel-doctor)

fails = 0
def check(name, cond):
    global fails
    print(("  \033[32mok\033[0m   " if cond else "  \033[31mFAIL\033[0m ") + name)
    if not cond:
        fails += 1

# 1. the real gate classifies these as expected (baseline both other tests rely on)
check("gate accepts valid code", api.gate_code(VALID) is None)
check("gate rejects [..]-wrapped code", api.gate_code(INVALID) is not None)

# 2. repair: invalid first, valid second → returns the corrected code, error fed back
seq = iter([INVALID, VALID])
prompts = []
def fake_gen(p):
    prompts.append(p)
    return next(seq)
out = api.generate_valid("make a beat", attempts=2, _gen=fake_gen)
check("repair returns the corrected code", out == VALID)
check("repair re-prompted with the parse error + broken code",
      len(prompts) == 2 and "did not parse" in prompts[1] and INVALID in prompts[1])

# 3. valid-first short-circuits — exactly one generation, no needless repair
calls = []
def gen_valid_first(p):
    calls.append(p)
    return VALID
out2 = api.generate_valid("x", attempts=2, _gen=gen_valid_first)
check("valid-first returns after 1 generation", out2 == VALID and len(calls) == 1)

# 4. exhausted: always invalid → ValueError after exactly `attempts` generations
n = [0]
def gen_always_bad(p):
    n[0] += 1
    return INVALID
try:
    api.generate_valid("x", attempts=2, _gen=gen_always_bad)
    check("exhausted raises ValueError", False)
except ValueError:
    check("exhausted raises ValueError after N attempts", n[0] == 2)

# 5. render_code end-to-end (real Chromium) — both gated and pre_gated paths still render
try:
    audio, share = api.render_code(VALID, 1, "wav")
    check("render_code renders + builds share link",
          len(audio) > 1000 and share.startswith("https://strudel.cc/#"))
    audio2, _ = api.render_code(VALID, 1, "wav", pre_gated=True)
    check("render_code pre_gated path renders", len(audio2) > 1000)
except Exception as e:
    check(f"render_code raised: {e}", False)

print("\nPASS" if fails == 0 else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
