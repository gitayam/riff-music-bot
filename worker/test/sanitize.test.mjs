// Unit tests for the post-compose Strudel sanitizer (R1.1) — run with `node --test`.
// The render-corpus ratchet proves these rewrites make real failing snippets render; these
// tests pin the exact rewrite semantics so a refactor can't silently regress them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeStrudel } from "../src/sanitize.js";

const balanced = (s) => {
  let d = 0;
  for (const c of s) { if (c === "(") d++; else if (c === ")") d--; if (d < 0) return false; }
  return d === 0;
};

test("one-arg .swingBy(x) → .swing(4) (the real 422 fix)", () => {
  assert.equal(
    sanitizeStrudel('sound("hh*8").gain(0.6).swingBy(0.06)'),
    'sound("hh*8").gain(0.6).swing(4)',
  );
  assert.equal(sanitizeStrudel('x.swingBy(1/3)'), "x.swing(4)");
});

test("two-arg .swingBy(x,n) is left untouched (it renders fine)", () => {
  const code = 'sound("hh*8").swingBy(0.08, 8)';
  assert.equal(sanitizeStrudel(code), code);
});

test("bare .swing() → .swing(4); .swing(n) left untouched", () => {
  assert.equal(sanitizeStrudel("stack(a,b).swing()"), "stack(a,b).swing(4)");
  assert.equal(sanitizeStrudel("a.swing(4)"), "a.swing(4)");
  assert.equal(sanitizeStrudel("a.swing(8)"), "a.swing(8)");
});

test(".lpenv(...) is dropped", () => {
  assert.equal(
    sanitizeStrudel('note("c2").lpf(900).lpenv(0.2)'),
    'note("c2").lpf(900)',
  );
  assert.equal(sanitizeStrudel("a.lpenv(0.2, 0.3).gain(1)"), "a.gain(1)");
});

test(".sometimes(x => …) is dropped whole, honoring the arrow body's nested parens", () => {
  const out = sanitizeStrudel('note("g4").room(0.4).sometimes(x => x.fast(2))');
  assert.equal(out, 'note("g4").room(0.4)');
  assert.ok(balanced(out), "parens stay balanced");
  // nested call inside the arrow body must not truncate at the inner ')'
  assert.equal(sanitizeStrudel("a.sometimes(x => x.delay(0.25)).gain(1)"), "a.gain(1)");
});

test("a full real-world failing row sanitizes to renderable, balanced code", () => {
  const row =
    'setcpm(120/4)\nstack(\n  sound("hh*8").gain(0.6).swingBy(0.06),\n' +
    '  note("c2").lpf(900).lpenv(0.2),\n  note("g4").room(0.4).sometimes(x => x.fast(2))\n).swing()';
  const out = sanitizeStrudel(row);
  assert.ok(!/\.swingBy\(\s*[^(),]+?\s*\)/.test(out), "no one-arg swingBy remains");
  assert.ok(!out.includes(".lpenv("), "no lpenv remains");
  assert.ok(!out.includes(".sometimes("), "no sometimes remains");
  assert.ok(!/\.swing\(\s*\)/.test(out), "no bare swing remains");
  assert.ok(balanced(out), "parens stay balanced");
});

test("supported code is left untouched", () => {
  const good =
    'setcpm(120/4)\nstack(sound("bd*4").bank("RolandTR909"), sound("hh*8").gain(0.4).swing(4))';
  assert.equal(sanitizeStrudel(good), good);
});

test("idempotent: sanitize∘sanitize === sanitize", () => {
  const samples = [
    'sound("hh*8").swingBy(0.06)',
    'a.lpenv(0.2).sometimes(x => x.fast(2)).swing()',
    'stack(sound("bd*4"))',
  ];
  for (const s of samples) {
    const once = sanitizeStrudel(s);
    assert.equal(sanitizeStrudel(once), once, `idempotent for: ${s}`);
  }
});

test("never throws on non-string / empty input; returns it as-is", () => {
  assert.equal(sanitizeStrudel(""), "");
  assert.equal(sanitizeStrudel(null), null);
  assert.equal(sanitizeStrudel(undefined), undefined);
  assert.equal(sanitizeStrudel(42), 42);
});
