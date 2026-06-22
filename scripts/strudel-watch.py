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
# liveness heartbeat: touched at the end of each poll cycle so watchdog.sh can detect a ZOMBIE
# (process alive but the poll loop stopped) — launchd KeepAlive only catches a hard crash.
HEARTBEAT = os.environ.get("WATCH_HEARTBEAT") or os.path.join(HERE, os.pardir, "data", "strudel-watch.heartbeat")
CODE_RE = re.compile(r"```(?:javascript|js)?\s*\n(.*?)```", re.S)
# Optional spoken-vocal directive Riff may add: "🎤 say: <words>" or "🎤 say [voice]: <words>"
# (one line). When present, we render the beat AND speak the line over it via voice-deliver.sh
# with the chosen voice; else instrumental. Backward-compatible: the [voice] group is optional.
VOICE_RE = re.compile(r"(?:🎤|🎙️?)\s*say\s*(?:\[\s*([a-z]+)\s*\])?\s*:\s*(.+)", re.I)
VOICES = {"alloy","ash","ballad","coral","echo","fable","nova","onyx","sage","shimmer","verse","marin","cedar"}
SONG_RE = re.compile(r"\barrange\s*\(")          # a full song (vs a single loop)
# chat steering (opt-in): if RADIO_STEER_FILE is set, a message like "!radio darker faster" writes
# that hint to the radio's steer file (radio.sh re-reads it each segment) — letting the community
# steer a running generative radio from Discord. Dormant unless RADIO_STEER_FILE is set in the env.
RADIO_STEER_FILE = os.environ.get("RADIO_STEER_FILE")
STEER_CMD_RE = re.compile(r"^\s*(?:!radio|!steer|🎛️?)\s*(?:steer\s+)?(.+)$", re.I)
TOKEN = os.environ.get("DISCORD_BOT_TOKEN") or sys.exit("DISCORD_BOT_TOKEN not set (source .env)")


def already_delivered(msgs, idx, bot_id):
    """True if the code-reply at msgs[idx] was already delivered — a bot voice message OR a section-links
    message appears after it before the next bot code-reply. Handles either delivery order (section-links
    first, then voice — which is how we post now — or voice-only for a loop). Lets the watcher safely
    re-scan history without re-delivering. msgs is oldest→newest."""
    for x in msgs[idx + 1:]:
        if x["author"]["id"] != bot_id:
            continue
        if int(x.get("flags", 0)) & 8192:                  # a voice message → delivered
            return True
        c = x.get("content", "")
        if "Section links" in c:                           # the watcher's section-links message → delivered
            return True
        if CODE_RE.search(c):                              # another code-reply first → this one is stranded
            return False
    return False


def steer_from_message(content):
    """A chat steer command → the hint to write to the radio steer file; None if not a command,
    or '' to explicitly clear. Only an explicit !radio/!steer/🎛️ prefix triggers (so a normal
    'make a darker song' request is NOT mistaken for a steer)."""
    m = STEER_CMD_RE.match(content or "")
    if not m:
        return None
    hint = " ".join(m.group(1).split())[:120].lower()
    return "" if hint in ("clear", "reset", "off", "stop", "none") else hint


def section_messages(code, say=None, voice=None):
    """For a full song, return per-section play links as Discord-ready messages (each < 2000 chars).

    A full song's whole-program base64 link is too long to post, so we give one SELF-CONTAINED
    strudel.cc link per section (intro/verse/chorus/…) — generated deterministically by
    strudel-song-links.mjs, never hand-written — plus the spoken vocal line. Returns [] for a
    single loop or if generation fails (delivery still works; this is additive)."""
    if not SONG_RE.search(code):
        return []
    try:
        r = subprocess.run(["node", os.path.join(HERE, "strudel-song-links.mjs")],
                           input=code, capture_output=True, text=True, timeout=30)
    except Exception:
        return []
    links = [ln.split("\t", 1) for ln in (r.stdout or "").splitlines() if "\t" in ln]
    if len(links) < 2:
        return []
    # drop any single link too long to post on its own (a section link can't be split across messages)
    link_lines = [f"▶ {n.strip()}: {l.strip()}" for n, l in links]
    link_lines = [ln for ln in link_lines if len(ln) <= 1900]
    if not link_lines:
        return []
    lines = ["🎶 **Section links** — click to play each part:"] + link_lines
    if say:
        lines.append(f'🎤 vocal ({voice or "ash"}): "{say}"')
    msgs, cur = [], ""                                # pack lines into < 2000-char messages
    for ln in lines:
        if cur and len(cur) + len(ln) + 1 > 1900:
            msgs.append(cur); cur = ""
        cur += ("\n" if cur else "") + ln
    if cur:
        msgs.append(cur)
    return msgs

def api(path, method="GET", body=None, _try=0):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
        headers={"Authorization": f"Bot {TOKEN}", "Content-Type": "application/json",
                 "User-Agent": "DiscordBot (https://github.com/zeroclaw-labs/zeroclaw, 0.1) strudel-watch"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            time.sleep(float(e.headers.get("Retry-After", "2")) + 0.5); return api(path, method, body, _try)
        raise
    except (urllib.error.URLError, TimeoutError) as e:
        # transient network/DNS blip (e.g. a resolver hiccup after a VPN/network change) — retry with
        # backoff so a brief outage can't kill the whole poll cycle, which previously stranded deliveries.
        if _try < 4:
            time.sleep(min(2 ** _try, 8)); return api(path, method, body, _try + 1)
        raise

def load_state():
    try:
        with open(STATE) as f: return json.load(f)
    except Exception: return {}

def save_state(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f: json.dump(s, f)

def channels():
    # Watch every text/announcement channel + active thread in EVERY guild the bot is in, so a reply is
    # delivered wherever the bot is @mentioned — not just a hand-picked subset (the bug: the bot lived in
    # 27 channels but only 3 were watched, so replies elsewhere never became voice messages).
    # STRUDEL_WATCH_CHANNELS adds extra ids on top. Inaccessible channels just 403-and-skip per cycle.
    explicit = [c.strip() for c in os.environ.get("STRUDEL_WATCH_CHANNELS", "").split(",") if c.strip()]
    discovered = []
    try:
        for guild in api("/users/@me/guilds"):
            gid = guild["id"]
            try:
                discovered += [c["id"] for c in api(f"/guilds/{gid}/channels") if c.get("type") in (0, 5)]
                discovered += [t["id"] for t in (api(f"/guilds/{gid}/threads/active") or {}).get("threads", [])]
            except Exception:
                continue
    except Exception:
        pass
    base = explicit + discovered
    if not base:                                          # discovery failed + no explicit list → fall back
        g = os.environ.get("DISCORD_GUILD_ID", "").strip()
        if g: base = [c["id"] for c in api(f"/guilds/{g}/channels") if c.get("type") in (0, 5)]
        else: sys.exit("bot is in no guild and STRUDEL_WATCH_CHANNELS/DISCORD_GUILD_ID are unset")
    seen, out = set(), []
    for c in base:
        if c not in seen: seen.add(c); out.append(c)
    if len(out) > 60:
        print(f"  note: watching {len(out)} channels — set STRUDEL_WATCH_CHANNELS to restrict if rate-limited")
    return out

# channels the bot can't read (403/401) — cached in-memory so we stop re-polling them every cycle
# (we now watch every channel the bot is in; many are private/mod-only). Reset on restart, which
# re-checks them (catches a later permission grant).
_INACCESSIBLE = set()

def cycle(send):
    me = api("/users/@me"); bot_id = me["id"]
    state = load_state()
    chans = [c for c in channels() if c not in _INACCESSIBLE]
    extra = f", {len(_INACCESSIBLE)} skipped (no access)" if _INACCESSIBLE else ""
    print(f"watching {len(chans)} channel(s){extra} as {me['username']} (send={'ON' if send else 'DRY RUN'})")
    for ch in chans:
        last = state.get(ch)
        try:
            msgs = api(f"/channels/{ch}/messages?limit=25" + (f"&after={last}" if last else ""))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):                                # no read access → cache, stop re-polling it
                _INACCESSIBLE.add(ch); print(f"  ch {ch}: no access ({e.code}) — won't re-poll until restart")
            else:
                print(f"  ch {ch}: skip ({e.code})")
            continue
        msgs = sorted(msgs, key=lambda m: int(m["id"]))            # oldest -> newest
        if last is None:                                            # first sight: arm to latest, DON'T replay.
            # We now watch ~every channel the bot is in, so replaying backlog would bulk-deliver old
            # stranded replies across dozens of channels (a spam burst). New replies after arming deliver
            # normally; the idempotency check below still makes any deliberate re-scan safe.
            if msgs: state[ch] = msgs[-1]["id"]
            continue
        for idx_m, m in enumerate(msgs):
            state[ch] = m["id"]
            if RADIO_STEER_FILE:                       # chat steering (any author) for a running radio
                sh = steer_from_message(m.get("content", ""))
                if sh is not None:
                    try:
                        with open(RADIO_STEER_FILE, "w") as f: f.write(sh)
                        print(f"  ch {ch} msg {m['id']}: radio steer → {sh or '(cleared)'}")
                    except Exception as e:
                        print(f"    steer write failed: {e}")
            if m["author"]["id"] != bot_id: continue
            if int(m.get("flags", 0)) & 8192: continue             # already a voice message
            mm = CODE_RE.search(m.get("content", ""))
            if not mm: continue
            if already_delivered(msgs, idx_m, bot_id): continue    # voice/links already follow → skip
            code = mm.group(1).strip()
            vm = VOICE_RE.search(m.get("content", ""))
            say = vm.group(2).strip().strip('"“”\'') if vm else None
            voice = (vm.group(1) or "").lower() if vm else ""
            voice = voice if voice in VOICES else "ash"        # validate; default warm 'ash'
            secmsgs = section_messages(code, say, voice)   # per-section links for a full song (else [])
            kind = f'voice[{voice}]+"{say[:32]}"' if say else "instrumental"
            extra = f" (+{len(secmsgs)} section-link msg)" if secmsgs else ""
            print(f"  ch {ch} msg {m['id']}: Strudel block ({len(code)} chars, {kind}){extra} -> "
                  + ("delivering" if send else "WOULD deliver"))
            if send:
                for msg in secmsgs:   # post the per-section links FIRST — instant, so a slow full-song
                    try:              # render still gives the user playable links in seconds (not ~60s)
                        api(f"/channels/{ch}/messages", "POST", {"content": msg})
                    except Exception as e:
                        print(f"    section-link post failed: {e}")
                with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as tf:
                    tf.write(code); path = tf.name
                try:
                    if say:   # render beat + speak the line over it (chosen voice)
                        cmd = [os.path.join(HERE, os.pardir, "render", "voice-deliver.sh"),
                               "--code", path, "--say", say, "--voice", voice, "--channel", ch, "--send"]
                    else:     # instrumental
                        cmd = [os.path.join(HERE, "strudel-deliver.sh"), path, ch, "--send"]
                    subprocess.run(cmd, check=True)   # then the rendered voice message (slow for a full song)
                except subprocess.CalledProcessError as e:
                    print(f"    deliver failed (likely render gate) — skipped: {e}")
                finally:
                    os.unlink(path)
    save_state(state)
    try:                                              # heartbeat: a completed cycle = loop is alive
        os.makedirs(os.path.dirname(HEARTBEAT), exist_ok=True)
        with open(HEARTBEAT, "w") as f:
            f.write(str(int(time.time())))
    except Exception:
        pass

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
