#!/usr/bin/env node
// radio-compose.mjs <index> — Phase-4 P1 evolution engine: emit the Strudel code for radio
// segment <index>, deterministically. Tempo, key, mode, kit, hat density, layers and filter
// evolve *smoothly* with the index, so the radio is a continuously-EVOLVING set rather than a
// fixed loop — yet reproducible (same index → same code), which keeps it testable. radio.sh calls
// this per segment. Only allowlisted Strudel verbs + cached kits (909/808/dirt/piano), so every
// segment parses and renders fully offline.
const idx = Math.max(0, parseInt(process.argv[2] || '0', 10) || 0);

const MODES = ['minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'major'];
const ROOTS = ['C', 'A', 'D', 'G', 'F', 'E'];
const KITS  = ['RolandTR909', 'RolandTR808'];          // both cached → offline + audible
const HATS  = ['hh*8', 'hh*16', 'hh*4', '[hh ~ hh hh]'];

const bpm  = 88 + Math.round(42 * (0.5 + 0.5 * Math.sin(idx / 3)));   // ~88..130, smooth drift
const mode = MODES[Math.floor(idx / 2) % MODES.length];               // shifts every 2 segments
const root = ROOTS[idx % ROOTS.length];
const kit  = KITS[idx % KITS.length];
const hats = HATS[idx % HATS.length];
const lpf  = (idx % 4 === 0) ? 'lpf(sine.range(400,1800).slow(8))' : `lpf(${600 + (idx % 5) * 220})`;

const layers = [];
layers.push(`sound("bd*4").bank("${kit}").gain(0.9)`);
if (idx % 2 === 0) layers.push(`sound("~ cp ~ cp").bank("${kit}").gain(0.6)`);
layers.push(`sound("${hats}").gain(0.4)`);
layers.push(`n("0 ~ <0 3> 0").scale("${root}2:${mode}").sound("sawtooth").${lpf}.gain(0.7)`);   // bass
if (idx % 3 !== 0) layers.push(`n("0 2 4 <6 5>").scale("${root}4:${mode}").sound("piano").gain(0.4).room(0.3)`);
else               layers.push(`n("0 2 4").scale("${root}3:${mode}").sound("piano").gain(0.35).room(0.3)`);

process.stdout.write(`setcpm(${bpm}/4)\nstack(\n  ${layers.join(',\n  ')}\n)\n`);
