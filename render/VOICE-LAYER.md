# Voice layer — spoken vocals over the beat

Adds a **spoken** vocal line to a Strudel beat and delivers it as one Discord voice message.
Two user flows:

- **Quote** — the user says what to say: `lofi beat "stay focused, you got this"`
- **Auto** — the user leaves it to the bot: it authors a short hook and speaks it.

> **Spoken, not sung.** OpenAI has no singing model — `gpt-4o-mini-tts` is steerable *speech*,
> which is the right fit for "quotes of what to say" (spoken-word over a beat). For real *sung*
> vocals, the upgrade path is **ACE-Step 1.5** (local, MIT, Apple-Silicon) — but it generates a
> whole song, so it replaces the Strudel beat rather than layering on it. See the model research
> in `docs/sundai-zeroclaw-music-roadmap.md`.

## Files (all in `render/`)

| Script | Does |
|---|---|
| `tts.sh` | `--text … --out voice.wav [--voice ash] [--instructions "…"]` → speech WAV via OpenAI `gpt-4o-mini-tts`. Reads `OPENAI_API` from `../.env`. Voices: alloy ash ballad coral echo fable nova onyx sage shimmer verse marin cedar. |
| `voice-mix.sh` | `--music beat.wav --voice voice.wav --out mixed.wav` → loudness-normalizes the (quiet) TTS to sit **above** the beat, **ducks** the music under it (sidechain compression), loops the loop-aligned beat to cover the line, limits. |
| `voice-deliver.sh` | One command: lint → render Strudel→WAV (`strudel-render.mjs`) → TTS → mix → Opus/OGG → waveform → reuse `../scripts/discord-voice.sh`. **Dry-run by default**; posts only with `--channel <id> --send`. |

## Usage

```bash
cd zeroclaw/render

# Flow 1 — quote inside a raw user message (the quote is extracted automatically)
printf '%s' "$STRUDEL_CODE" | ./voice-deliver.sh --code - \
  --message 'lofi beat "stay focused, you got this"' --voice ash --out /tmp/track.ogg

# Flow 1b — explicit, verbatim
./voice-deliver.sh --code beat.js --say "we ride at dawn" --voice onyx

# Flow 2 — let the bot write the hook (gpt-5.4-mini), then speak it
./voice-deliver.sh --code beat.js --auto --vibe "hype trap anthem" --voice onyx

# Post for real (outward-facing): add --channel + --send
./voice-deliver.sh --code beat.js --say "happy friday, team" --channel <CHANNEL_ID> --send
```

Output is a valid Discord voice-message OGG (Opus, mono, 48 kHz) — verified to read through the
delivery chain's `scripts/strudel-waveform.py`.

## Tuning

- `voice-mix.sh`: `--delay` (intro before the line, default 0.8s), `--tail` (default 1.4s),
  `--music-gain` (bed level, default 0.8), `--voice-lufs` (target loudness, default −14 — louder
  than a typical −15 LUFS beat so the words punch through).
- `tts.sh --instructions` steers delivery ("calm and warm", "hyped, staccato", "deadpan").

## Integration — DONE (code wired); activation pending a service restart

The auto-delivery path now does voice automatically. Both pieces are wired (and verified in
dry-run); they are **backward-compatible** — a reply with no `🎤 say:` line takes the existing
instrumental path unchanged.

1. **Soul (`souls/hermes.SOUL.md`)** — Riff's contract gained an optional item 4: when the user
   quoted a line, or asked for a vocal/hook/lyrics/"a song"/"leave it to you", Riff appends
   `🎤 say: <words>` (verbatim quote, or a short hook it authored; omitted for instrumentals).
2. **Watcher (`scripts/strudel-watch.py`)** — parses `🎤 say:` from the bot reply
   (`VOICE_RE`); if present → `render/voice-deliver.sh --code <tmp> --say "<text>" --channel <ch>
   --send`; else → `strudel-deliver.sh` (unchanged). `--auto` is unused here — Riff already
   decided the text (brain vs. deterministic worker stays separated).

**⚠ ACTIVATION (outward-facing — left deliberate; the bot is live on real traffic):**
```bash
# 1. reload the daemon so Riff picks up the new soul (run.sh re-syncs souls/ → workspace):
launchctl kickstart -k gui/$(id -u)/com.zeroclaw.hermes
# 2. restart the watcher so it runs the new branch code:
launchctl kickstart -k gui/$(id -u)/com.zeroclaw.strudel-watch
```
Until then the running daemon/watcher use the old soul/code (no behavior change). Verify after
with `scripts/strudel-doctor.sh`. First live test: `@mention` Riff with a quote, e.g.
*make a lofi beat "stay focused, you got this"*.
