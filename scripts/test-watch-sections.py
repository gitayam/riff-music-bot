#!/usr/bin/env python3
"""test-watch-sections.py — strudel-watch.py's section_messages() must turn a full song into
Discord-ready per-section link messages: one ▶ link per section, the spoken words surfaced, and
every message under Discord's 2000-char limit (the limit that forced songs to drop the link).
No Discord, no LLM (it shells out to strudel-song-links.mjs). Run: python3 scripts/test-watch-sections.py
"""
import os, sys, importlib.util

os.environ.setdefault("DISCORD_BOT_TOKEN", "test-dummy-token")   # watcher exits at import without it
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("strudel_watch", os.path.join(HERE, "strudel-watch.py"))
sw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sw)

SONG = """setcpm(136/4)
const drums = stack(sound("bd*4").bank("RolandTR909").gain(0.95), sound("hh*8").gain(0.4).swing(4))
const bass = note("a1 a1 g1 e1").sound("sawtooth").lpf(700).gain(0.82)
const chords = n("0 1 2 1").scale("A3:phrygian").sound("piano").room(0.22).gain(0.42)
const hook = n("<7 6 4 3>").scale("A4:phrygian").sound("square").lpf(1800).gain(0.46)
const intro = stack(chords.gain(0.24), bass.gain(0.2))
const verse = stack(drums, bass, chords)
const chorus = stack(drums, bass, chords.gain(0.5), hook)
const bridge = stack(sound("bd(3,8)").bank("RolandTR909"), note("a1 g1 f1 e1").sound("sawtooth").lpf(620))
const outro = stack(chords.gain(0.2).room(0.5))
arrange([4,intro],[8,verse],[8,chorus],[8,verse],[8,chorus],[8,bridge],[8,chorus],[4,outro])"""

fails = 0
def check(name, cond):
    global fails
    print(("  \033[32mok\033[0m   " if cond else "  \033[31mFAIL\033[0m ") + name)
    if not cond:
        fails += 1

msgs = sw.section_messages(SONG, say="I bite my tongue till the whole room shakes.", voice="onyx")
check("a song yields section-link message(s)", bool(msgs))
check("every message is under Discord's 2000-char limit", all(len(m) <= 2000 for m in msgs))
joined = "\n".join(msgs)
for s in ["intro", "verse", "chorus", "bridge", "outro"]:
    check(f"includes a ▶ link for '{s}'", f"▶ {s}:" in joined)
check("includes a strudel.cc link per section", joined.count("https://strudel.cc/#") == 5)
check("surfaces the spoken words + voice", "I bite my tongue" in joined and "onyx" in joined)
check("a plain loop yields no section messages", sw.section_messages('setcpm(120/4)\nstack(sound("bd*4"))') == [])

# chat steering: only an explicit !radio/!steer/🎛️ command steers; a normal request must not.
check("'!radio darker faster' → 'darker faster'", sw.steer_from_message("!radio darker faster") == "darker faster")
check("'!steer slow' → 'slow'", sw.steer_from_message("!steer slow") == "slow")
check("'🎛️ dense' → 'dense'", sw.steer_from_message("🎛️ dense") == "dense")
check("'!radio DARKER' lowercased", sw.steer_from_message("!radio DARKER") == "darker")
check("'!radio clear' → '' (explicit clear)", sw.steer_from_message("!radio clear") == "")
check("a normal request is NOT a steer command", sw.steer_from_message("make a darker song") is None)
check("plain chat is NOT a steer command", sw.steer_from_message("hey what's up") is None)

# a section so layer-heavy its own link exceeds the limit is dropped (never an oversized message);
# the normal sections still come through, and a string with brackets must not mis-split it.
fat = ",\n  ".join(f'sound("hh*8").gain(0.{40 + i})' for i in range(70))
fat_song = (f'setcpm(120/4)\nconst big = stack(\n  {fat}\n)\n'
            'const small = stack(sound("bd(3,8)"))\narrange([8,big],[8,small])')
m2 = sw.section_messages(fat_song)
check("oversized run: all messages still under 2000", all(len(x) <= 2000 for x in m2))
check("oversized run: the too-long 'big' section link is dropped", not any("▶ big:" in x for x in m2))
check("oversized run: the normal 'small' section link is kept", any("▶ small:" in x for x in m2))

# idempotent re-scan: skip a code-reply that already has a following bot voice message
B = "bot"
def _m(author, voice=False): return {"author": {"id": author}, "flags": 8192 if voice else 0}
check("already_delivered: code-reply → voice msg ⇒ True (delivered)", sw.already_delivered([_m(B), _m(B, voice=True)], 0, B) is True)
check("already_delivered: code-reply, no following voice ⇒ False (stranded)", sw.already_delivered([_m(B), _m(B)], 0, B) is False)
check("already_delivered: nothing after ⇒ False", sw.already_delivered([_m(B)], 0, B) is False)
check("already_delivered: user chatter then voice ⇒ True", sw.already_delivered([_m(B), _m("u"), _m(B, voice=True)], 0, B) is True)

# channels() also watches active threads (deduped) — a reply in a thread otherwise gets no audio
os.environ["STRUDEL_WATCH_CHANNELS"] = "111,222"; os.environ["DISCORD_GUILD_ID"] = "g1"
_orig_api = sw.api
sw.api = lambda p, *a, **k: ({"threads": [{"id": "333"}, {"id": "222"}]} if "threads/active" in p else [])
_ch = sw.channels()
sw.api = _orig_api
check("channels() merges active threads with the base channels, deduped", _ch == ["111", "222", "333"])

# api(): a transient DNS/URLError blip is retried (not fatal — this is what wedged the watcher)
import urllib.error
_calls = {"n": 0}
class _R:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return b'{"ok": true}'
def _fake(req, timeout=None):
    _calls["n"] += 1
    if _calls["n"] < 3: raise urllib.error.URLError("nodename nor servname provided")
    return _R()
sw.urllib.request.urlopen = _fake; sw.time.sleep = lambda *a: None
check("api() retries a transient DNS/URLError then succeeds", sw.api("/health") == {"ok": True} and _calls["n"] == 3)

print("\nPASS" if fails == 0 else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
