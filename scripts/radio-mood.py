#!/usr/bin/env python3
"""radio-mood.py — Situation D: the generative radio reacts to the channel's mood.

Polls a Discord channel's recent messages, classifies the vibe (dark↔bright × calm↔hype), and writes a
steer hint to the radio's steer file — the SAME file radio.sh re-reads each segment and the chat-steer
(`!radio …`) mechanism writes. So the live stream drifts to match what the community is saying right now
("match the vibe of #general"). Opt-in: set RADIO_MOOD_CHANNEL + RADIO_STEER_FILE (+ DISCORD_BOT_TOKEN);
dormant otherwise, so the live bot is unaffected.

The classifier `mood_from_messages()` is pure + deterministic (unit-tested in test-radio-mood.py); the
poll loop is a thin wrapper. REST-only (same bot token, no gateway), mirroring strudel-watch.py.

  RADIO_MOOD_CHANNEL=<id> RADIO_STEER_FILE=/path/to/steer python3 scripts/radio-mood.py [interval_s]
"""
import os, sys, json, time, urllib.request, urllib.error

API = "https://discord.com/api/v10"

# Steer-vocab the radio engine understands (radio-compose.mjs): dark/bright (mode), fast/slow (tempo),
# dense/sparse (density). The classifier emits only these words.
DARK_W   = {"sad", "tired", "exhausted", "rough", "down", "stressed", "anxious", "depressed", "gloomy",
            "rip", "bummed", "drained", "low", "meh", "ugh"}
BRIGHT_W = {"happy", "great", "awesome", "love", "excited", "yay", "win", "won", "shipped", "nice",
            "lfg", "amazing", "stoked", "glad", "celebrate"}
HYPE_W   = {"hype", "lit", "fire", "pumped", "insane", "crazy", "lfg", "wild", "huge", "epic"}
CHILL_W  = {"chill", "relax", "relaxing", "calm", "quiet", "sleepy", "tired", "cozy", "mellow", "slow"}
DARK_E   = {"😢", "😞", "😔", "💀", "😪", "😭", "😩"}
BRIGHT_E = {"🎉", "😄", "😁", "❤️", "🥳", "✨", "😊", "🙌"}
HYPE_E   = {"🔥", "🚀", "⚡", "💥"}
CHILL_E  = {"😴", "🌙", "☕", "🍵"}


def _tokens(text):
    return [t.strip(".,!?;:\"'()[]").lower() for t in str(text).split()]


def mood_from_messages(texts):
    """list[str] → a steer hint over the radio vocab. '' when there's no clear signal (the radio then
    falls back to its time-of-day auto-seed). Deterministic."""
    dark = bright = hype = chill = excls = caps = 0
    for text in texts or []:
        if not isinstance(text, str):
            continue
        toks = _tokens(text)
        dark   += sum(1 for t in toks if t in DARK_W)
        bright += sum(1 for t in toks if t in BRIGHT_W)
        hype   += sum(1 for t in toks if t in HYPE_W)
        chill  += sum(1 for t in toks if t in CHILL_W)
        dark   += sum(text.count(e) for e in DARK_E)
        bright += sum(text.count(e) for e in BRIGHT_E)
        hype   += sum(text.count(e) for e in HYPE_E)
        chill  += sum(text.count(e) for e in CHILL_E)
        excls  += text.count("!")
        caps   += sum(1 for w in text.split() if len(w) >= 3 and w.isupper())

    parts = []
    if dark > bright:
        parts.append("dark")
    elif bright > dark:
        parts.append("bright")
    # energy: explicit hype/chill words/emoji, plus shouting (!!! and ALL-CAPS) as hype signal
    energy_up = hype + excls // 2 + caps
    energy_dn = chill
    if energy_up >= 2 and energy_up > energy_dn:
        parts += ["fast", "dense"]
    elif energy_dn >= 2 and energy_dn > energy_up:
        parts += ["slow", "sparse"]
    return " ".join(parts)


def api(path):
    req = urllib.request.Request(API + path, headers={
        "Authorization": f"Bot {os.environ.get('DISCORD_BOT_TOKEN', '')}",
        "User-Agent": "riff-radio-mood/1.0",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def sample_and_write(fetch_fn, steer_file, channel, limit=30):
    """One cycle: fetch recent messages, classify, write the steer file. Returns the hint written.
    fetch_fn(channel, limit) → list of message dicts (injectable for tests)."""
    msgs = fetch_fn(channel, limit) or []
    texts = [m.get("content", "") for m in msgs if isinstance(m, dict)]
    hint = mood_from_messages(texts)
    # Write even when '' so a mood that fades clears the steer (radio reverts to time-seed).
    with open(steer_file, "w") as f:
        f.write(hint)
    return hint


def main():
    channel = os.environ.get("RADIO_MOOD_CHANNEL", "")
    steer_file = os.environ.get("RADIO_STEER_FILE", "")
    if not channel or not steer_file:
        sys.stderr.write("radio-mood: set RADIO_MOOD_CHANNEL + RADIO_STEER_FILE (dormant otherwise)\n")
        return 0
    interval = float(sys.argv[1]) if len(sys.argv) > 1 else 45.0
    fetch = lambda ch, lim: api(f"/channels/{ch}/messages?limit={lim}")
    while True:
        try:
            hint = sample_and_write(fetch, steer_file, channel)
            print(f"[radio-mood] {channel}: steer={hint!r}", file=sys.stderr)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"[radio-mood] poll failed (non-fatal): {e}", file=sys.stderr)
        time.sleep(interval)
    return 0


if __name__ == "__main__":
    sys.exit(main())
