#!/usr/bin/env node
// strudel-render — evaluate a Strudel pattern headlessly and render it to a WAV file.
// Doubles as a parse/validate gate: invalid code throws (non-zero exit) instead of rendering.
//   node render.mjs '<strudel code>' out.wav [seconds]
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { evaluate } from '@strudel/transpiler';
import { OfflineAudioContext } from 'node-web-audio-api';
import { writeFileSync } from 'node:fs';

const SR = 44100;
const codeIn = process.argv[2];
const outPath = process.argv[3] || 'out.wav';
const seconds = Number(process.argv[4] || 12);
if (!codeIn) { console.error('usage: render.mjs "<code>" out.wav [seconds]'); process.exit(2); }

await core.evalScope(core, mini, tonal, core.controls);

// --- tempo: strip setcpm/setcps (not in headless scope), derive cps ---
let cps = 0.5;
const mcpm = codeIn.match(/setcpm\(([^)]+)\)/);
const mcps = codeIn.match(/setcps\(([^)]+)\)/);
try { if (mcpm) cps = eval(mcpm[1]) / 60; else if (mcps) cps = eval(mcps[1]); } catch {}
const code = codeIn.replace(/setc(pm|ps)\([^)]*\)\s*[\n;,]?/g, '');

let pattern;
try { ({ pattern } = await evaluate(code)); }
catch (e) { console.error('PARSE/EVAL ERROR:', e.message); process.exit(1); }
if (!pattern || typeof pattern.queryArc !== 'function') {
  console.error('NOT A PATTERN: code did not evaluate to a Strudel pattern (e.g. wrapped in [ ], or top level is not stack/note/sound).');
  process.exit(1);
}

const cycles = seconds * cps;
const haps = pattern.queryArc(0, cycles).filter(h => (h.hasOnset ? h.hasOnset() : true) && h.whole);

// --- synth helpers ---
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function noteToFreq(n) {
  if (n == null) return null;
  if (typeof n === 'number') return 440 * 2 ** ((n - 69) / 12);       // midi
  const m = String(n).match(/^([a-gA-G])([#sb]*)(-?\d+)?$/);
  if (!m) return null;
  let semi = PC[m[1].toLowerCase()];
  for (const c of m[2]) { if (c === '#' || c === 's') semi++; else if (c === 'b') semi--; }
  const oct = m[3] !== undefined ? parseInt(m[3], 10) : 3;
  return 440 * 2 ** (((oct + 1) * 12 + semi - 69) / 12);
}
const DRUMS = new Set(['bd', 'kick', 'sd', 'sn', 'snare', 'cp', 'clap', 'hh', 'oh', 'hat', 'rim', 'lt', 'mt', 'ht', 'rd', 'cr', 'perc']);
const OSC = { sawtooth: 'sawtooth', saw: 'sawtooth', square: 'square', sqr: 'square', triangle: 'triangle', tri: 'triangle', sine: 'sine', piano: 'triangle', rhodes: 'sine', epiano: 'triangle' };

const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);

// shared white-noise buffer for percussion
const nb = ctx.createBuffer(1, SR, SR);
const nd = nb.getChannelData(0);
for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
function noise() { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; return s; }

function env(g, t, dur, peak) {            // click-free AD envelope
  const a = 0.005, r = Math.min(0.08, dur * 0.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.02, dur - r) + r);
}

function drum(name, t, gain) {
  const g = ctx.createGain(); g.connect(master);
  if (name === 'bd' || name === 'kick') {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    env(g, t, 0.18, gain); o.connect(g); o.start(t); o.stop(t + 0.2);
  } else if (name === 'hh' || name === 'oh' || name === 'hat' || name === 'rd' || name === 'cr') {
    const open = name === 'oh' || name === 'rd' || name === 'cr';
    const n = noise(), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
    env(g, t, open ? 0.25 : 0.05, gain * 0.5); n.connect(f); f.connect(g); n.start(t); n.stop(t + (open ? 0.3 : 0.07));
  } else { // snare/clap/rim/perc
    const n = noise(), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    env(g, t, 0.16, gain * 0.7); n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.2);
  }
}

let voiced = 0;
for (const h of haps) {
  const v = h.value || {};
  const t = h.whole.begin.valueOf() / cps;
  const dur = Math.max(0.05, (h.whole.end.valueOf() - h.whole.begin.valueOf()) / cps);
  const gain = (v.gain ?? 0.8) * 0.8;
  if (t >= seconds) continue;
  const s = v.s || v.sound;
  const freq = noteToFreq(v.note ?? v.n);
  if (s && DRUMS.has(String(s).toLowerCase()) && freq == null) { drum(String(s).toLowerCase(), t, gain); voiced++; continue; }
  if (freq == null) continue;                       // nothing pitched to play
  const g = ctx.createGain(); g.connect(master);
  const o = ctx.createOscillator(); o.type = OSC[String(s || 'sine').toLowerCase()] || 'sine';
  o.frequency.setValueAtTime(freq, t);
  let tail = g;
  const cut = v.cutoff ?? v.lpf;
  if (cut) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = +cut; o.connect(f); f.connect(g); }
  else o.connect(g);
  env(g, t, Math.min(dur, 1.2), gain);
  o.start(t); o.stop(t + Math.min(dur, 1.2) + 0.1); voiced++;
}

const buf = await ctx.startRendering();
// --- WAV (16-bit PCM stereo) ---
const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
const n = L.length, data = Buffer.alloc(44 + n * 4);
data.write('RIFF', 0); data.writeUInt32LE(36 + n * 4, 4); data.write('WAVE', 8);
data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
data.write('data', 36); data.writeUInt32LE(n * 4, 40);
let off = 44, peak = 0;
for (let i = 0; i < n; i++) {
  for (const ch of [L, R]) {
    let s = Math.max(-1, Math.min(1, ch[i])); peak = Math.max(peak, Math.abs(s));
    data.writeInt16LE((s * 32767) | 0, off); off += 2;
  }
}
writeFileSync(outPath, data);
console.error(`rendered ${haps.length} haps (${voiced} voiced) -> ${outPath}  ${seconds}s @ ${(cps*60).toFixed(0)}cpm  peak=${peak.toFixed(3)}`);
if (peak < 0.001) { console.error('WARNING: output is silent'); process.exit(3); }
