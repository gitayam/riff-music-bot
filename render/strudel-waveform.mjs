#!/usr/bin/env node
// strudel-waveform.mjs — compute a Discord voice-message preview from a WAV.
//
//   node strudel-waveform.mjs tune.wav            # -> {"waveform_b64":"…","duration_secs":8.0}
//
// Discord renders the scrub-bar from a byte array: ≤256 datapoints, 1 byte each (0–255),
// base64-encoded; duration_secs is float seconds. We parse the PCM, bucket frames into
// ≤256 windows, take the peak amplitude per window (looks punchier than RMS for drums),
// scale 0–255, and base64-encode. Handles 16-bit and 32-bit-float PCM, any channel count.
import fs from 'node:fs';

const MAX_POINTS = 256;

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a RIFF/WAVE file');
  let fmt = null, dataOff = -1, dataLen = 0;
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),       // 1 = PCM int, 3 = IEEE float
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = Math.min(size, buf.length - body); // tolerate a truncated/overstated size
    }
    p = body + size + (size & 1); // chunks are word-aligned
  }
  if (!fmt) throw new Error('no fmt chunk');
  if (dataOff < 0) throw new Error('no data chunk');
  return { fmt, dataOff, dataLen };
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: strudel-waveform.mjs <file.wav>'); process.exit(2); }
  const buf = fs.readFileSync(file);
  const { fmt, dataOff, dataLen } = parseWav(buf);
  const { channels, sampleRate, bitsPerSample, audioFormat } = fmt;
  const bytesPerSample = bitsPerSample / 8;
  const frameBytes = bytesPerSample * channels;
  const frames = Math.floor(dataLen / frameBytes);
  if (frames === 0) throw new Error('empty audio data');

  const durationSecs = frames / sampleRate;

  // Read one normalized amplitude per frame (max abs across channels).
  const readSample = (off) => {
    if (audioFormat === 3 && bitsPerSample === 32) return buf.readFloatLE(off);
    if (bitsPerSample === 16) return buf.readInt16LE(off) / 32768;
    if (bitsPerSample === 32) return buf.readInt32LE(off) / 2147483648;
    if (bitsPerSample === 8) return (buf.readUInt8(off) - 128) / 128; // 8-bit PCM is unsigned
    throw new Error(`unsupported bit depth ${bitsPerSample}`);
  };

  const points = Math.min(MAX_POINTS, frames);
  const out = Buffer.alloc(points);
  let globalPeak = 0;
  const peaks = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    const start = Math.floor((i * frames) / points);
    const end = Math.max(start + 1, Math.floor(((i + 1) * frames) / points));
    let peak = 0;
    for (let f = start; f < end; f++) {
      const base = dataOff + f * frameBytes;
      for (let c = 0; c < channels; c++) {
        const a = Math.abs(readSample(base + c * bytesPerSample));
        if (a > peak) peak = a;
      }
    }
    peaks[i] = peak;
    if (peak > globalPeak) globalPeak = peak;
  }
  // Normalize to the loudest bucket so quiet renders still show a full bar.
  const norm = globalPeak > 0 ? 1 / globalPeak : 0;
  for (let i = 0; i < points; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(peaks[i] * norm * 255)));
  }

  process.stdout.write(JSON.stringify({
    waveform_b64: out.toString('base64'),
    duration_secs: Number(durationSecs.toFixed(3)),
  }) + '\n');
}

main();
