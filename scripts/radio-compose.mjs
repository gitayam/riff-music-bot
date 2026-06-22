#!/usr/bin/env node
// radio-compose.mjs <index> — Phase-4 evolution engine + live steering. Emits the Strudel code for
// radio segment <index>, deterministically. Tempo/key/mode/kit/hat-density/filter evolve *smoothly*
// with the index; an optional STEER hint (env RADIO_STEER, e.g. "darker faster") biases them so a
// listener can nudge the live stream. Deterministic in (index, steer) → reproducible + testable.
// Only allowlisted Strudel verbs + cached kits (909/808/dirt/piano), so every segment parses and
// renders fully offline. radio.sh calls this per segment, re-reading <outdir>/steer each time.
const idx = Math.max(0, parseInt(process.argv[2] || '0', 10) || 0);
const steer = (process.env.RADIO_STEER || '').toLowerCase();
// auto-seed by time of day when there's no manual steer — a 24/7 radio should drift with the day.
// Opt-in via RADIO_AUTOSEED (radio.sh sets it); a manual steer always overrides; RADIO_HOUR pins
// the clock for tests. Kept opt-in so the bare engine stays time-independent (deterministic) for tests.
function timeSeed(h) {
  if (h >= 22 || h < 6) return 'darker chill';      // late night → dark + mellow
  if (h < 9)            return 'brighter sparse';   // early morning → light + airy
  if (h < 17)           return 'brighter';          // daytime → bright
  return 'warm';                                     // evening → warm (bright-ish)
}
let effective = steer;
if (!effective && process.env.RADIO_AUTOSEED) {
  const h = process.env.RADIO_HOUR != null ? (parseInt(process.env.RADIO_HOUR, 10) || 0) : new Date().getHours();
  effective = timeSeed(h);
}
const has = (...w) => w.some((x) => effective.includes(x));

const DARK   = ['phrygian', 'aeolian', 'minor'];
const BRIGHT = ['lydian', 'mixolydian', 'major', 'dorian'];
const ALL    = ['minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'major'];
const ROOTS  = ['C', 'A', 'D', 'G', 'F', 'E'];
const KITS   = ['RolandTR909', 'RolandTR808'];          // both cached → offline + audible
const HATS   = ['hh*8', 'hh*16', 'hh*4', '[hh ~ hh hh]'];

// steer flags
const dark   = has('dark', 'tense', 'minor', 'evil', 'moody', 'phrygian');
const bright = has('bright', 'happy', 'major', 'uplift', 'sunny', 'warm');
const fast   = has('fast', 'hype', 'energet', 'high', 'drive', 'banger');
const slow   = has('slow', 'chill', 'calm', 'mellow', 'low', 'down');
const dense  = has('dense', 'busy', 'hard', 'heavy', 'more', 'bigger');
const sparse = has('sparse', 'minimal', 'soft', 'empty', 'less', 'stripped');

const modePool = dark ? DARK : bright ? BRIGHT : ALL;
const mode = modePool[Math.floor(idx / 2) % modePool.length];
const root = ROOTS[idx % ROOTS.length];
const kit  = KITS[idx % KITS.length];

let bpm = 88 + Math.round(42 * (0.5 + 0.5 * Math.sin(idx / 3)));     // ~88..130 smooth drift
if (fast) bpm = Math.min(168, bpm + 24);
if (slow) bpm = Math.max(68, bpm - 24);

let hats = HATS[idx % HATS.length];
if (dense) hats = 'hh*16';
else if (sparse) hats = 'hh*4';

const baseLpf = dark ? 700 : bright ? 1600 : (600 + (idx % 5) * 220);
const lpf = (idx % 4 === 0 && !dark) ? 'lpf(sine.range(400,1800).slow(8))' : `lpf(${baseLpf})`;

const layers = [];
layers.push(`sound("bd*4").bank("${kit}").gain(${dense ? '0.98' : '0.9'})`);
if (idx % 2 === 0 || dense) layers.push(`sound("~ cp ~ cp").bank("${kit}").gain(0.6)`);
layers.push(`sound("${hats}").gain(0.4)`);
layers.push(`n("0 ~ <0 3> 0").scale("${root}2:${mode}").sound("sawtooth").${lpf}.gain(0.7)`);
const wantMelody = sparse ? (idx % 4 === 0) : (idx % 3 !== 0);
if (wantMelody) layers.push(`n("0 2 4 <6 5>").scale("${root}4:${mode}").sound("piano").gain(0.4).room(0.3)`);
else            layers.push(`n("0 2 4").scale("${root}3:${mode}").sound("piano").gain(0.35).room(0.3)`);

process.stdout.write(`setcpm(${bpm}/4)\nstack(\n  ${layers.join(',\n  ')}\n)\n`);
