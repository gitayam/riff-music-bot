#!/usr/bin/env python3
"""Compute a Discord voice-message waveform + duration from any audio file.

    strudel-waveform.py tune.wav      # -> {"waveform": "<base64>", "duration_secs": 8.0}

Discord shows the voice-message preview bar from a byte array: <=256 datapoints,
1 byte each (0-255 peak amplitude), base64-encoded; duration_secs is float seconds.
We decode the audio to raw mono 16-bit PCM via ffmpeg (handles wav/ogg/mp3, and
avoids the stdlib `audioop`/`wave` quirks — `audioop` is gone in Python 3.14), then
bucket into <=256 peak-amplitude samples.
"""
import sys, json, base64, subprocess, array

SR = 8000          # plenty for a preview bar; keeps it light
MAX_POINTS = 256

def main():
    if len(sys.argv) < 2:
        sys.exit("usage: strudel-waveform.py <audio-file>")
    path = sys.argv[1]
    # decode -> raw signed 16-bit little-endian, mono, 8kHz
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "pipe:1"],
        check=True, stdout=subprocess.PIPE).stdout
    samples = array.array("h")
    samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
    n = len(samples)
    if n == 0:
        print(json.dumps({"waveform": "", "duration_secs": 0.0})); return
    duration = round(n / SR, 2)
    points = min(MAX_POINTS, n)
    step = n / points
    out = bytearray()
    for i in range(points):
        lo = int(i * step); hi = int((i + 1) * step) if i < points - 1 else n
        peak = 0
        for s in samples[lo:hi]:
            a = -s if s < 0 else s
            if a > peak: peak = a
        out.append(min(255, peak * 255 // 32768))
    print(json.dumps({"waveform": base64.b64encode(bytes(out)).decode(), "duration_secs": duration}))

if __name__ == "__main__":
    main()
