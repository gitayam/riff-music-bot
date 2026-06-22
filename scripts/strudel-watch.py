#!/usr/bin/env python3
"""strudel-watch — auto-deliver voice messages for the bot's Strudel replies.

Decoupled from zeroclaw: REST-only (same bot token, no gateway connection, no config
changes, no zeroclaw internals). It polls the configured channels for the bot's OWN
recent messages that contain a ```javascript Strudel block, and replies to each with a
rendered voice message (via strudel-deliver.sh). zeroclaw keeps doing the text reply;
this turns each one into playable audio.

  strudel-watch.py --once             # one poll cycle, DRY RUN (report candidates, post nothing)
  strudel-watch.py --once --send      # one cycle, actually post
  strudel-watch.py --loop 8 --send    # poll every 8s and post

Env: DISCORD_BOT_TOKEN (required). Channels: STRUDEL_WATCH_CHANNELS (csv of channel ids)
or DISCORD_GUILD_ID (auto-discovers text channels). State (high-water mark per channel)
in data/strudel-watch-state.json so old history is never replayed.
"""
import os, sys, re, json, time, subprocess, tempfile, urllib.request, urllib.error

API = "https://discord.com/api/v10"
HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, os.pardir, "data", "strudel-watch-state.json")
CODE_RE = re.compile(r"```(?:javascript|js)?\s*\n(.*?)```", re.S)
# Optional spoken-vocal directive Riff may add: "🎤 say: <words>" or "🎤 say [voice]: <words>"
# (one line). When present, we render the beat AND speak the line over it via voice-deliver.sh
# with the chosen voice; else instrumental. Backward-compatible: the [voice] group is optional.
VOICE_RE = re.compile(r"(?:🎤|🎙️?)\s*say\s*(?:\[\s*([a-z]+)\s*\])?\s*:\s*(.+)", re.I)
VOICES = {"alloy","ash","ballad","coral","echo","fable","nova","onyx","sage","shimmer","verse","marin","cedar"}
TOKEN = os.environ.get("DISCORD_BOT_TOKEN") or sys.exit("DISCORD_BOT_TOKEN not set (source .env)")

def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
        headers={"Authorization": f"Bot {TOKEN}", "Content-Type": "application/json",
                 "User-Agent": "DiscordBot (https://github.com/zeroclaw-labs/zeroclaw, 0.1) strudel-watch"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            time.sleep(float(e.headers.get("Retry-After", "2")) + 0.5); return api(path, method, body)
        raise

def load_state():
    try:
        with open(STATE) as f: return json.load(f)
    except Exception: return {}

def save_state(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f: json.dump(s, f)

def channels():
    env = os.environ.get("STRUDEL_WATCH_CHANNELS", "").strip()
    if env: return [c.strip() for c in env.split(",") if c.strip()]
    g = os.environ.get("DISCORD_GUILD_ID") or sys.exit("set STRUDEL_WATCH_CHANNELS or DISCORD_GUILD_ID")
    return [c["id"] for c in api(f"/guilds/{g}/channels") if c.get("type") in (0, 5)]  # text + announcement

def cycle(send):
    me = api("/users/@me"); bot_id = me["id"]
    state = load_state()
    chans = channels()
    print(f"watching {len(chans)} channel(s) as {me['username']} (send={'ON' if send else 'DRY RUN'})")
    for ch in chans:
        last = state.get(ch)
        try:
            msgs = api(f"/channels/{ch}/messages?limit=25" + (f"&after={last}" if last else ""))
        except urllib.error.HTTPError as e:
            print(f"  ch {ch}: skip ({e.code})"); continue
        msgs = sorted(msgs, key=lambda m: int(m["id"]))            # oldest -> newest
        if last is None:                                            # first sight: arm, don't replay history
            if msgs: state[ch] = msgs[-1]["id"]
            continue
        for m in msgs:
            state[ch] = m["id"]
            if m["author"]["id"] != bot_id: continue
            if int(m.get("flags", 0)) & 8192: continue             # already a voice message
            mm = CODE_RE.search(m.get("content", ""))
            if not mm: continue
            code = mm.group(1).strip()
            vm = VOICE_RE.search(m.get("content", ""))
            say = vm.group(2).strip().strip('"“”\'') if vm else None
            voice = (vm.group(1) or "").lower() if vm else ""
            voice = voice if voice in VOICES else "ash"        # validate; default warm 'ash'
            kind = f'voice[{voice}]+"{say[:32]}"' if say else "instrumental"
            print(f"  ch {ch} msg {m['id']}: Strudel block ({len(code)} chars, {kind}) -> "
                  + ("delivering" if send else "WOULD deliver"))
            if send:
                with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as tf:
                    tf.write(code); path = tf.name
                try:
                    if say:   # render beat + speak the line over it (chosen voice)
                        cmd = [os.path.join(HERE, os.pardir, "render", "voice-deliver.sh"),
                               "--code", path, "--say", say, "--voice", voice, "--channel", ch, "--send"]
                    else:     # instrumental (unchanged path)
                        cmd = [os.path.join(HERE, "strudel-deliver.sh"), path, ch, "--send"]
                    subprocess.run(cmd, check=True)
                except subprocess.CalledProcessError as e:
                    print(f"    deliver failed (likely render gate) — skipped: {e}")
                finally:
                    os.unlink(path)
    save_state(state)

def main():
    send = "--send" in sys.argv
    if "--loop" in sys.argv:
        i = sys.argv.index("--loop"); interval = float(sys.argv[i+1]) if i+1 < len(sys.argv) else 8.0
        while True:
            try: cycle(send)
            except Exception as e: print("cycle error:", e)
            time.sleep(interval)
    else:
        cycle(send)

if __name__ == "__main__":
    main()
