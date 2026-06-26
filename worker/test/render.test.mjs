// Unit tests for the render-service client (R2.1) — run with `node --test`. Mocks global fetch (the
// render boundary) + fast-forwards the 503 backoff timer so the retry path tests in <1s. renderBytes
// lives in src/render.js precisely so this can import it (index.js can't load under node).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { renderBytes, audioWired } from "../src/render.js";

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
afterEach(() => { globalThis.fetch = realFetch; globalThis.setTimeout = realSetTimeout; });

// A minimal Response stand-in: renderBytes only touches .ok / .status / .arrayBuffer().
const res = (status, bytes = new Uint8Array([1, 2, 3])) => ({
  ok: status >= 200 && status < 300,
  status,
  arrayBuffer: async () => bytes.buffer,
});
// Record every fetch; serve queued responses (last repeats). An Error in the queue is thrown (network).
function mockFetch(queue) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const r = queue[Math.min(calls.length - 1, queue.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  return calls;
}
// Fire the 503 backoff immediately (still async) so 3× retry doesn't take 14s.
const fastTimers = () => { globalThis.setTimeout = (fn) => realSetTimeout(fn, 0); };

const ENV = { RENDER_SERVICE_URL: "https://render.example", MUSIC_API_TOKEN: "tok123" };

test("renderBytes posts to <url>/render with the shared bearer + json body", async () => {
  const calls = mockFetch([res(200)]);
  const out = await renderBytes(ENV, "CODE", 4, "mp3");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://render.example/render");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok123");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.code, "CODE");
  assert.equal(body.cycles, 4);
  assert.ok(typeof body.format === "string");
  assert.ok(out.bytes instanceof Uint8Array && out.bytes.length === 3);
});

test("renderBytes retries a 503 up to 3× then returns {error}, never throws", async () => {
  fastTimers();
  const calls = mockFetch([res(503)]); // always 503
  const out = await renderBytes(ENV, "CODE", 4, "mp3");
  assert.equal(calls.length, 3, "tried three times");
  assert.match(out.error, /503/);
  assert.equal(out.bytes, undefined);
});

test("renderBytes recovers when a 503 is followed by a 200", async () => {
  fastTimers();
  const calls = mockFetch([res(503), res(200)]);
  const out = await renderBytes(ENV, "CODE", 4, "mp3");
  assert.equal(calls.length, 2);
  assert.ok(out.bytes instanceof Uint8Array);
});

test("renderBytes returns {error} (not throw) when the render service is not configured", async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return res(200); };
  const out = await renderBytes({ MUSIC_API_TOKEN: "x" }, "CODE", 4, "mp3"); // no RENDER_SERVICE_URL
  assert.equal(fetched, false, "must not hit the network when unconfigured");
  assert.match(out.error, /not configured/);
});

test("renderBytes catches a network failure and returns {error}, never throws", async () => {
  mockFetch([new Error("ECONNREFUSED")]);
  const out = await renderBytes(ENV, "CODE", 4, "mp3");
  assert.match(out.error, /ECONNREFUSED/);
});

test("renderBytes treats empty audio as an error", async () => {
  mockFetch([res(200, new Uint8Array([]))]);
  const out = await renderBytes(ENV, "CODE", 4, "mp3");
  assert.match(out.error, /empty/);
});

test("renderBytes does NOT retry a 422 (engine reject) — returns it on the first try", async () => {
  const calls = mockFetch([res(422)]);
  const out = await renderBytes(ENV, "CODE", 4, "mp3");
  assert.equal(calls.length, 1);
  assert.match(out.error, /422/);
});

test("renderBytes omits the Authorization header when no token is configured", async () => {
  const calls = mockFetch([res(200)]);
  await renderBytes({ RENDER_SERVICE_URL: "https://render.example" }, "CODE", 4, "mp3");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("audioWired is true only when both the render URL and the R2 bucket are bound", () => {
  assert.equal(audioWired({ RENDER_SERVICE_URL: "x", AUDIO: {} }), true);
  assert.equal(audioWired({ RENDER_SERVICE_URL: "x" }), false); // no bucket
  assert.equal(audioWired({ AUDIO: {} }), false);               // no url
  assert.equal(audioWired({}), false);
  assert.equal(audioWired(null), false);
  assert.equal(audioWired(undefined), false);
});
