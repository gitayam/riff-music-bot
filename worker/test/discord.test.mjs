// Unit tests for the Discord Interactions helpers. Ed25519 sign/verify uses WebCrypto (same API the
// Worker uses in workerd), so the verify path is exercised exactly as in production.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hexToBytes, verifyInteractionSignature, commandPrompt, interactionSessionId, followupUrl, followupContent, T,
} from "../src/discord.js";

const bytesToHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function makeKeypairAndSign(message) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pubHex = bytesToHex(await crypto.subtle.exportKey("raw", publicKey));
  const sigHex = bytesToHex(await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(message)));
  return { pubHex, sigHex };
}

test("hexToBytes parses valid hex and rejects bad input", () => {
  assert.deepEqual([...hexToBytes("00ff10")], [0, 255, 16]);
  assert.throws(() => hexToBytes("abc"));   // odd length
  assert.throws(() => hexToBytes("zz"));     // non-hex
});

test("verifyInteractionSignature accepts a valid signature over timestamp+body", async () => {
  const ts = "1700000000", body = '{"type":1}';
  const { pubHex, sigHex } = await makeKeypairAndSign(ts + body);
  assert.equal(await verifyInteractionSignature(pubHex, sigHex, ts, body), true);
});

test("verifyInteractionSignature rejects a tampered body, wrong ts, and garbage", async () => {
  const ts = "1700000000", body = '{"type":2}';
  const { pubHex, sigHex } = await makeKeypairAndSign(ts + body);
  assert.equal(await verifyInteractionSignature(pubHex, sigHex, ts, '{"type":1}'), false); // tampered body
  assert.equal(await verifyInteractionSignature(pubHex, sigHex, "1700000001", body), false); // wrong ts
  assert.equal(await verifyInteractionSignature(pubHex, "00".repeat(64), ts, body), false);   // bad sig
  assert.equal(await verifyInteractionSignature(pubHex, sigHex, "", body), false);             // missing ts
  assert.equal(await verifyInteractionSignature("", sigHex, ts, body), false);                 // no key
  assert.equal(await verifyInteractionSignature(pubHex, "nothex", ts, body), false);           // unparseable
});

test("commandPrompt extracts the prompt option, null when absent", () => {
  assert.equal(commandPrompt({ type: 2, data: { options: [{ name: "prompt", value: "funky disco" }] } }), "funky disco");
  assert.equal(commandPrompt({ type: 2, data: { options: [{ name: "other", value: "x" }] } }), null);
  assert.equal(commandPrompt({ type: 2, data: {} }), null);
  assert.equal(commandPrompt({}), null);
});

test("interactionSessionId derives a stable id from channel_id", () => {
  assert.equal(interactionSessionId({ channel_id: "123" }), "discord:123");
  assert.equal(interactionSessionId({}), null);
});

test("followupUrl targets the @original message via the interaction token", () => {
  assert.equal(followupUrl("https://discord.com/api/v10", "app1", "tok1"),
    "https://discord.com/api/v10/webhooks/app1/tok1/messages/@original");
  assert.equal(followupUrl("https://x/", "a", "t"), "https://x/webhooks/a/t/messages/@original"); // trailing slash trimmed
});

test("followupContent inlines code when small, drops to link-only when it would exceed 2000", () => {
  const small = followupContent("disco", 'stack(sound("bd*4"))', "https://strudel.cc/#x");
  assert.match(small, /```javascript/);
  assert.match(small, /▶ https:\/\/strudel\.cc\/#x/);
  const big = followupContent("epic", "x".repeat(3000), "https://strudel.cc/#y");
  assert.ok(big.length <= 2000);
  assert.ok(!big.includes("```"), "oversized code must be dropped, not inlined");
  assert.match(big, /strudel\.cc\/#y/);
});

test("type constants match the Discord API", () => {
  assert.equal(T.PING, 1);
  assert.equal(T.APPLICATION_COMMAND, 2);
  assert.equal(T.DEFERRED_CHANNEL_MESSAGE, 5);
});
