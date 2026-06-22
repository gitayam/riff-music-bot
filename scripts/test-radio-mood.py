#!/usr/bin/env python3
"""test-radio-mood.py — the channel-mood classifier (Situation D) + the sample→steer-file cycle.
No Discord, no network (the poll fetch is injected). Run: python3 scripts/test-radio-mood.py
"""
import os, sys, tempfile, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("radio_mood", os.path.join(HERE, "radio-mood.py"))
rm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rm)

fails = 0
def check(name, cond):
    global fails
    print(("  \033[32mok\033[0m   " if cond else "  \033[31mFAIL\033[0m ") + name)
    if not cond:
        fails += 1

m = rm.mood_from_messages

# mood axis: dark vs bright
check("sad/tired chatter → 'dark'", "dark" in m(["this is so sad", "i'm exhausted today", "ugh rough week"]))
check("happy/win chatter → 'bright'", "bright" in m(["yay we shipped!", "this is awesome", "love it"]))
check("dark words don't yield 'bright'", "bright" not in m(["sad", "down", "gloomy"]))
check("bright words don't yield 'dark'", "dark" not in m(["great", "awesome", "win"]))

# energy axis: hype → fast+dense, chill → slow+sparse
hype = m(["LETS GO 🔥🔥", "this is INSANE", "pumped 🚀"])
check("hype chatter → 'fast' + 'dense'", "fast" in hype and "dense" in hype)
chill = m(["chill vibes", "just relaxing 😴", "cozy and mellow"])
check("chill chatter → 'slow' + 'sparse'", "slow" in chill and "sparse" in chill)
check("exclamation/caps count as hype energy", "fast" in m(["WOW", "AMAZING", "GO GO GO!!!"]))

# emoji are read (may not split on spaces)
check("dark emoji → 'dark'", "dark" in m(["😢😢😭"]))
check("bright emoji → 'bright'", "bright" in m(["🎉🥳✨"]))

# neutral / empty → no steer (radio falls back to its time-of-day seed)
check("neutral chatter → '' (no steer)", m(["what time is the meeting", "ok sounds good", "see you there"]) == "")
check("empty input → ''", m([]) == "")
check("non-string items are ignored", m([None, 123, "sad sad sad"]) == "dark" or "dark" in m([None, 123, "sad sad sad"]))

# combined: dark + chill
combo = m(["feeling down today 😔", "let's keep it calm and quiet", "tired"])
check("dark + chill → 'dark' and 'slow'/'sparse'", "dark" in combo and ("slow" in combo or "sparse" in combo))

# sample_and_write: injected fetch → classifies → writes the steer file (writes '' to clear, too)
with tempfile.TemporaryDirectory() as td:
    steer = os.path.join(td, "steer")
    fake = lambda ch, lim: [{"content": "this is so sad 😢"}, {"content": "rough day, exhausted"}]
    hint = rm.sample_and_write(fake, steer, "chan1")
    check("sample_and_write returns the hint", "dark" in hint)
    check("sample_and_write writes the steer file", open(steer).read() == hint)
    # a now-neutral channel clears the steer file
    rm.sample_and_write(lambda ch, lim: [{"content": "ok"}], steer, "chan1")
    check("a faded mood clears the steer file (→ '')", open(steer).read() == "")
    # robust to malformed messages
    rm.sample_and_write(lambda ch, lim: [{"no_content": 1}, "notadict", None], steer, "chan1")
    check("malformed messages don't crash → ''", open(steer).read() == "")

print("\nPASS" if fails == 0 else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
