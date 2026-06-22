// Unit tests for the Worker's pure helpers — run with `node --test` (no network, no workerd).
// The critical invariant: the Worker's share_url is byte-identical to the local Python/Node systems,
// so links generated on the edge play exactly like links from the laptop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { shareUrl, b64utf8, extractStrudel, validateStrudel, buildChatBody, SYSTEM_PROMPT, lineDiff, diffString, modifyUserContent } from "../src/lib.js";

const SAMPLE = 'setcpm(120/4)\nstack(sound("bd*4"))';

test("share_url matches Python base64.b64encode byte-for-byte", () => {
  const py = execFileSync("python3", ["-c",
    'import base64,sys; print("https://strudel.cc/#"+base64.b64encode(sys.stdin.buffer.read()).decode())'],
    { input: SAMPLE }).toString().trim();
  assert.equal(shareUrl(SAMPLE), py);
});

test("share_url is correct for the known sample", () => {
  assert.equal(shareUrl(SAMPLE), "https://strudel.cc/#c2V0Y3BtKDEyMC80KQpzdGFjayhzb3VuZCgiYmQqNCIpKQ==");
});

test("b64utf8 round-trips unicode (note names, em-dashes)", () => {
  const s = 'note("c2 — eb2").sound("piano") // chill 🎹';
  assert.equal(Buffer.from(b64utf8(s), "base64").toString("utf8"), s);
});

test("extractStrudel pulls the first ```javascript block", () => {
  assert.equal(extractStrudel('here:\n```javascript\nstack(sound("bd*4"))\n```\nenjoy'), 'stack(sound("bd*4"))');
});
test("extractStrudel accepts a bare ``` fence", () => {
  assert.equal(extractStrudel('```\nnote("c e g")\n```'), 'note("c e g")');
});
test("extractStrudel returns null when there is no code block", () => {
  assert.equal(extractStrudel("sorry, I can't compose that right now"), null);
  assert.equal(extractStrudel(123), null);
});

test("validateStrudel accepts a normal loop and a full arrange() song", () => {
  assert.equal(validateStrudel('setcpm(120/4)\nstack(sound("bd*4"))'), null);
  assert.equal(validateStrudel('const a=stack(sound("bd*4"))\narrange([8,a],[8,a])'), null);
});
test("validateStrudel rejects the [ ...whole program... ] wrap bug", () => {
  assert.match(validateStrudel('[stack(sound("bd*4")), note("c e g")]'), /\[ \.\.\. \]/);
});
test("validateStrudel rejects empty, prose, and stray fences", () => {
  assert.equal(validateStrudel("   "), "empty code");
  assert.match(validateStrudel("a chill lofi beat for studying"), /does not look like Strudel/);
  assert.match(validateStrudel('stack(sound("bd*4"))\n```'), /markdown fence/);
});

test("buildChatBody follows the gpt-5.4 rules (no temperature; max_completion_tokens; flat reasoning_effort)", () => {
  const b = buildChatBody("make a funky disco loop", "gpt-5.4");
  assert.equal(b.model, "gpt-5.4");
  assert.equal(b.temperature, undefined, "temperature must not be set on gpt-5.4");
  assert.equal(typeof b.max_completion_tokens, "number");
  assert.equal(b.max_tokens, undefined, "max_tokens is deprecated — must not be used");
  assert.equal(typeof b.reasoning_effort, "string");
  assert.equal(b.messages[0].role, "system");
  assert.ok(b.messages[0].content.includes("Strudel"));
  assert.equal(b.messages[1].content, "make a funky disco loop");
});
test("buildChatBody defaults the model when none is given", () => {
  assert.equal(buildChatBody("x").model, "gpt-5.4");
});
test("SYSTEM_PROMPT carries the hard-won anti-hallucination rules", () => {
  assert.match(SYSTEM_PROMPT, /square brackets/);
  assert.match(SYSTEM_PROMPT, /setcpm/);
  assert.match(SYSTEM_PROMPT, /ONE fenced code block/);
});

test("lineDiff marks added/removed/unchanged lines (LCS)", () => {
  const d = lineDiff("a\nb\nc", "a\nB\nc");
  assert.deepEqual(d, [
    { tag: " ", line: "a" },
    { tag: "-", line: "b" },
    { tag: "+", line: "B" },
    { tag: " ", line: "c" },
  ]);
});
test("diffString shows only the changed lines with +/- markers", () => {
  const s = diffString('setcpm(120/4)\nstack(sound("bd*4"))', 'setcpm(140/4)\nstack(sound("bd*4"))');
  assert.equal(s, '- setcpm(120/4)\n+ setcpm(140/4)');
});
test("diffString is empty when code is unchanged", () => {
  assert.equal(diffString("a\nb", "a\nb"), "");
});
test("modifyUserContent embeds the current code and the change", () => {
  const c = modifyUserContent('stack(sound("bd*4"))', "make it darker");
  assert.match(c, /Current Strudel code:/);
  assert.match(c, /stack\(sound\("bd\*4"\)\)/);
  assert.match(c, /make it darker/);
  assert.match(c, /FULL updated program/);
});
