# Demo runbook — Riff (ZeroClaw music director) · Sundai Hack 128

**The pitch (15s):** Most AI music is a black box. **Riff** is a ZeroClaw agent that turns a
plain-language request into *real, editable music* — it writes the Strudel code, renders it
**locally**, and drops a playable 🎙️ voice message in Discord. You can read the code, tweak
it by talking, and other groups can generate music through one HTTP call.

## Before you present (2 min)
- `cd zeroclaw && ./scripts/strudel-doctor.sh` → expect **16/16 ✓** (all 3 services up, render works).
- **Pre-warm** the renderer so the first live one is snappy: send one throwaway `@mention` (or `./scripts/strudel-deliver.sh - <<<'setcpm(120/4) stack(sound("bd*4"))'`).
- Have a **backup clip** ready (a pre-rendered mp3) and the strudel.cc link handy in case Wi-Fi/Chromium flakes.
- Have the Discord channel open where the bot is, and (optional) a terminal for the HTTP API.

## The live demo (3–4 min)
1. **Generate.** In Discord, `@mention` the bot: **"make a funky disco loop, 120 bpm"**.
   → It replies with the **Strudel code** + a **strudel.cc** play link, and within ~15–25s a 🎙️ **voice message** appears. Play it.
2. **Real code, not a black box.** Click the strudel.cc link → the *exact* pattern plays in the browser. *"You can read and edit every note — and it tells you why it made each choice."*
3. **Modify by talking.** Reply **"darker, add a bassline"** → updated code + a fresh voice message. *"It edits the pattern; it doesn't re-roll a black box."* (Also try: *"give me 3 variations"*, *"use a 909 kick"*.)
4. **(wow) Other groups can use it too — one HTTP call returns the music:**
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"prompt":"epic victory fanfare"}' https://<tunnel>/generate \
     | python3 -c 'import sys,json,base64;open("out.mp3","wb").write(base64.b64decode(json.load(sys.stdin)["audio_base64"]))' \
     && afplay out.mp3
   ```
5. **Close:** *"Runs entirely locally — ZeroClaw + a headless Strudel render — with a model
   fallback so it stays up. Real music, real code, in chat or over HTTP."*

## If something breaks (backup plan)
- **Render/Chromium flakes** → play the backup clip; the **strudel.cc link always works** (it's just the code).
- **Discord hiccups** → demo the **HTTP API** (curl above), or render locally: `./scripts/strudel-deliver.sh - <<<'<code>'`.
- **Model 429/outage** → the fallback (gpt-5.4 → gpt-5.4-mini → mistral) handles it; worst case, show a pre-generated reply.
- **Watcher down** (no voice message) → `launchctl kickstart -k gui/$(id -u)/com.zeroclaw.strudel-watch`; the doctor catches this.

## What to emphasize (judging)
- **Not a black box** — editable Strudel code + a one-line "why" with every track.
- **Local & resilient** — no cloud render; gpt-5.4 with gpt-5.4-mini → mistral fallback.
- **Composable** — works in Discord/SimpleX chat *and* via a synchronous HTTP API other teams can call.
- **Shipped** — three always-on services, one-command setup (`setup.sh`) + health check (`strudel-doctor.sh`).
