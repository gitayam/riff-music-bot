#!/usr/bin/env node
// strudel-song-links.mjs — turn a full-song Strudel program (setcpm + const sections + arrange(...))
// into a SELF-CONTAINED strudel.cc play link PER SECTION (intro/verse/chorus/…), so a song reply can
// offer one clickable link per part instead of a single un-clickable blob. Each link carries the
// setcpm line + the const definitions that section transitively references + the section itself +
// a final bare reference (so that section plays). Deterministic — base64 is built here, NOT by the
// model (the project's hard lesson: model-written base64 drifts from the code). Reads code on stdin.
//
//   node strudel-song-links.mjs < song.js     # prints:  <sectionName>\t<https://strudel.cc/#...>
import fs from 'node:fs';

const code = fs.readFileSync(0, 'utf8');

// Split into top-level statements, tracking (){}[] depth so a multi-line `const x = stack( … )`
// stays one statement. (Parens inside string literals are rare in Strudel patterns; not handled.)
function statements(src) {
  const out = []; let cur = ''; let depth = 0;
  for (const line of src.split('\n')) {
    for (const ch of line) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    }
    cur += (cur ? '\n' : '') + line;
    if (depth === 0 && cur.trim()) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const stmts = statements(code);
const setcpm = stmts.find((s) => /^\s*set(cpm|cps)\s*\(/.test(s)) || '';
const consts = [];                 // [{name, def}] in source order
const byName = {};
let arrangeStmt = '';
for (const s of stmts) {
  const m = s.match(/^const\s+([A-Za-z_$][\w$]*)\s*=/);
  if (m) { consts.push({ name: m[1], def: s }); byName[m[1]] = s; }
  else if (/\barrange\s*\(/.test(s)) arrangeStmt = s;
}

// section order from arrange([bars, name], …), de-duplicated keeping first occurrence
const order = []; const seen = new Set();
for (const m of arrangeStmt.matchAll(/\[\s*\d+\s*,\s*([A-Za-z_$][\w$]*)\s*\]/g)) {
  if (!seen.has(m[1])) { seen.add(m[1]); order.push(m[1]); }
}

// transitive const references inside a section's definition body
function refsOf(name, acc = new Set()) {
  const def = (byName[name] || '').replace(/^const\s+\w+\s*=/, '');
  for (const c of consts) {
    if (c.name === name || acc.has(c.name)) continue;
    if (new RegExp(`\\b${c.name}\\b`).test(def)) { acc.add(c.name); refsOf(c.name, acc); }
  }
  return acc;
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
for (const name of order) {
  if (!byName[name]) continue;
  const needed = refsOf(name);
  const defs = consts.filter((c) => needed.has(c.name)).map((c) => c.def);   // source order
  const snippet = [setcpm, ...defs, byName[name], name].filter(Boolean).join('\n');
  process.stdout.write(`${name}\thttps://strudel.cc/#${b64(snippet)}\n`);
}
