# Demo runbook — Riff (ZeroClaw music director) · Sundai Hack 128

**The pitch (15s):** Most AI music is a black box. **Riff** is a ZeroClaw agent that turns a
plain-language request into *real, editable music* — it writes the Strudel code, renders it
**locally (fully offline)**, and drops a playable 🎙️ voice message in Discord. You can read the
code, tweak it by talking, get a **clickable play link for every section** of a full song, and
it even runs a **live generative radio you can steer**. Other teams can generate music via one HTTP call.

## Before you present (2 min)
- `cd zeroclaw && ./scripts/strudel-doctor.sh` → expect **22/22 ✓** (3 services up · render works · offline render · offline drums · self-heal · song sizing).
- `./scripts/test.sh` → the regression suite (cycle sizing · soul examples · auto-repair ×2 · radio · steer server · song links) should be **all green** — proves the build, no keys needed (~1–2 min).
- **Pre-warm** the renderer so the first live one is snappy: send one throwaway `@mention`, or render-only (no Discord needed): `printf 'setcpm(120/4)\nstack(sound("bd*4"))' | node render/strudel-render.mjs /tmp/warm.wav 2`.
- Have a **backup clip** (a pre-rendered mp3) + a strudel.cc link handy, the Discord channel open, and (optional) a terminal for the radio + HTTP API.

## The live demo (4–5 min)
1. **Generate.** In Discord, `@mention` the bot: **"make a funky disco loop, 120 bpm"**.
   → It replies with the **Strudel code** + a **strudel.cc** play link, and within ~15–25s a 🎙️ **voice message** appears. Play it.
2. **Real code, not a black box.** Click the strudel.cc link → the *exact* pattern plays in the browser. *"You can read and edit every note — and it tells you why it made each choice."*
3. **Modify by talking.** Reply **"darker, add a bassline"** → updated code + a fresh voice message. *"It edits the pattern; it doesn't re-roll a black box."* (Also: *"give me 3 variations"*, *"use a 909 kick"*.)
4. **A full song — a play link per section.** Ask **"make a full song — intro, verse, chorus, bridge, outro — dark techno, with a vocal"**. → a longer voice message *plus* a follow-up with a clickable **▶ Play link for each section** (intro / verse / chorus / …) and the spoken **🎤 vocal** line. *"Every part is its own playable, shareable link."*
5. **(flex) It's fully offline.** *"This renders with no internet."* Point at the doctor's **offline render / offline drums** checks (or toggle Wi-Fi off and render one) — the `@strudel/web` bundle + the 909/808/dirt/piano samples are all cached locally. Demo-proof against conference Wi-Fi.
6. **(wow) The live generative radio — and you steer it.**
   ```bash
   ./scripts/radio.sh /tmp/radio --serve --window 12      # prints a player URL
   ```
   Open `http://localhost:8123/radio.html`, hit **Play** → an endless, continuously-*evolving* set (every segment a fresh Strudel pattern, tempo/key/mood drifting). Then click **darker** / **faster** / **denser** → the stream **follows from the next segment**. *"A radio station that composes itself live — and the room can steer it."*
7. **(composable) One HTTP call returns the music** (other teams):
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"prompt":"epic victory fanfare"}' https://<tunnel>/generate \
     | python3 -c 'import sys,json,base64;open("out.mp3","wb").write(base64.b64decode(json.load(sys.stdin)["audio_base64"]))' \
     && afplay out.mp3
   ```
8. **Close:** *"Runs entirely locally and offline — ZeroClaw + a headless Strudel render — self-heals
   bad output, gives you the code, and turns into a steerable radio. Real music, real code, in chat,
   over HTTP, or on the air."*

## If something breaks (backup plan)
- **Render/Chromium flakes** → play the backup clip; the **strudel.cc link always works** (it's just the code). The deliver path also **auto-repairs** invalid code, so a bad gen self-corrects.
- **Wi-Fi dies** → no problem — rendering is **fully offline** (bundle + samples cached). Great moment to lean into, not away from.
- **Discord hiccups** → demo the **radio** (`radio.sh --serve`, fully local) or the **HTTP API** (curl above), or render locally: `printf '<code>' | ./scripts/strudel-deliver.sh -`.
- **Model 429/outage** → the fallback (gpt-5.4 → gpt-5.4-mini → mistral) handles it; worst case, show a pre-generated reply.
- **Watcher down** (no voice message) → `launchctl kickstart -k gui/$(id -u)/com.zeroclaw.strudel-watch`; the doctor catches this.

## What to emphasize (judging)
- **Not a black box** — editable Strudel code + a one-line "why" + a per-section play link with every song.
- **Fully offline & resilient** — no cloud render; bundle + samples cached; auto-repair on both the chat and HTTP paths; gpt-5.4 → gpt-5.4-mini → mistral model fallback.
- **A steerable live radio** — an endless, self-composing, evolving stream the audience nudges in real time (darker/faster/denser).
- **Composable & shipped** — Discord/SimpleX chat *and* a synchronous HTTP API; three always-on services; one-command setup (`setup.sh`), health check (`strudel-doctor.sh`, 22/22), and a full regression suite (`test.sh`).
