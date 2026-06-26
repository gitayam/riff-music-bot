// Unit tests for the render-engine 422 repair loop (R1.3) — run with `node --test`.
// index.js (the wiring) imports `cloudflare:workers` and can't load under node, so the loop lives
// as a PURE function in lib.js with the render + recompose steps injected. Here we inject stubs —
// the render stub IS the mocked render boundary (a 422 then a success) — to prove the loop feeds the
// engine error back, recomposes, and re-renders within the repair_attempts budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderWithRepair, renderRepairPrompt, is422 } from "../src/lib.js";

const BYTES = { bytes: new Uint8Array([1, 2, 3]), fmt: "mp3" };
const E422 = { error: "render service returned 422" };
const E503 = { error: "render service returned 503" };

test("422-then-fix: feeds the error back, recomposes, re-renders, returns audio", async () => {
  let renders = 0, recomposes = 0;
  const render = async () => (++renders === 1 ? E422 : BYTES);
  const recompose = async (reason, broken) => { recomposes++; assert.ok(is422(reason)); assert.equal(broken, "BAD"); return "GOOD"; };
  const { code, result } = await renderWithRepair({ code: "BAD", initialContent: "make a beat", attempts: 2, render, recompose });
  assert.equal(renders, 2, "rendered initial + once after repair");
  assert.equal(recomposes, 1, "recomposed exactly once");
  assert.equal(code, "GOOD", "returns the repaired code");
  assert.deepEqual(result, BYTES, "final result is the successful render");
});

test("happy path: renders once, never recomposes, code unchanged", async () => {
  let renders = 0, recomposes = 0;
  const { code, result } = await renderWithRepair({
    code: "OK", initialContent: "make a beat", attempts: 2,
    render: async () => { renders++; return BYTES; },
    recompose: async () => { recomposes++; return "X"; },
  });
  assert.equal(renders, 1);
  assert.equal(recomposes, 0);
  assert.equal(code, "OK");
  assert.deepEqual(result, BYTES);
});

test("non-422 error (503) does NOT recompose — transient, not engine-invalid", async () => {
  let renders = 0, recomposes = 0;
  const { code, result } = await renderWithRepair({
    code: "OK", initialContent: "make a beat", attempts: 3,
    render: async () => { renders++; return E503; },
    recompose: async () => { recomposes++; return "X"; },
  });
  assert.equal(renders, 1, "503 is not repaired here (renderBytes already retries it)");
  assert.equal(recomposes, 0);
  assert.equal(code, "OK");
  assert.deepEqual(result, E503);
});

test("no initialContent (e.g. /render) never rewrites caller code, even on 422", async () => {
  let renders = 0, recomposes = 0;
  const { code, result } = await renderWithRepair({
    code: "CALLER", initialContent: undefined, attempts: 3,
    render: async () => { renders++; return E422; },
    recompose: async () => { recomposes++; return "X"; },
  });
  assert.equal(renders, 1);
  assert.equal(recomposes, 0);
  assert.equal(code, "CALLER", "caller-supplied code is left untouched");
  assert.deepEqual(result, E422);
});

test("recompose failure degrades gracefully (keeps last code + error)", async () => {
  let renders = 0, recomposes = 0;
  const { code, result } = await renderWithRepair({
    code: "BAD", initialContent: "x", attempts: 2,
    render: async () => { renders++; return E422; },
    recompose: async () => { recomposes++; throw new Error("LLM down"); },
  });
  assert.equal(renders, 1, "broke before the second render");
  assert.equal(recomposes, 1, "tried once");
  assert.equal(code, "BAD", "kept the last code");
  assert.deepEqual(result, E422);
});

test("exhausts the attempts budget then returns the last 422", async () => {
  let renders = 0, recomposes = 0;
  const { code, result } = await renderWithRepair({
    code: "v0", initialContent: "x", attempts: 2,
    render: async () => { renders++; return E422; },
    recompose: async () => { recomposes++; return "v" + recomposes; },
  });
  assert.equal(renders, 2, "initial + one repair render (attempts=2)");
  assert.equal(recomposes, 1);
  assert.equal(code, "v1");
  assert.deepEqual(result, E422);
});

test("attempts=3 can repair on the third render", async () => {
  let renders = 0, recomposes = 0;
  const render = async () => (++renders < 3 ? E422 : BYTES);
  const { code, result } = await renderWithRepair({
    code: "v0", initialContent: "x", attempts: 3,
    render, recompose: async () => "v" + ++recomposes,
  });
  assert.equal(renders, 3);
  assert.equal(recomposes, 2);
  assert.equal(code, "v2");
  assert.deepEqual(result, BYTES);
});

test("renderRepairPrompt carries the engine error, the subset rules, and the broken code", () => {
  const p = renderRepairPrompt("make a chill beat", "render service returned 422", 'note("c").lpenv(0.2)');
  assert.match(p, /make a chill beat/);
  assert.match(p, /could not render/);
  assert.match(p, /422/);
  assert.match(p, /supported, renderable subset/);
  assert.match(p, /\.lpenv\(\)|\.swingBy\(\)|\.sometimes/);
  assert.match(p, /note\("c"\)\.lpenv\(0\.2\)/);
});

test("is422 matches a 422 error but not 503/500/null/word-boundary false positives", () => {
  assert.equal(is422("render service returned 422"), true);
  assert.equal(is422({ message: "boom 422 here" }), true);
  assert.equal(is422("render service returned 503"), false);
  assert.equal(is422("render service returned 500"), false);
  assert.equal(is422("4220 widgets"), false); // \b422\b must not match inside 4220
  assert.equal(is422(null), false);
  assert.equal(is422(undefined), false);
});
