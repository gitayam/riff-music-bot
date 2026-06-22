// Unit tests for the "more like this" vector math + ranking (no DB / network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, rankBySimilarity, parseEmbedding } from "../src/similar.js";

test("cosineSimilarity: identical=1, orthogonal=0, opposite=-1", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.ok(Math.abs(cosineSimilarity([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-9);
});

test("cosineSimilarity: zero vector / mismatch / bad input → 0", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), 0);
  assert.equal(cosineSimilarity(null, [1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

test("rankBySimilarity orders by score desc, strips embedding, respects k", () => {
  const q = [1, 0, 0];
  const cands = [
    { id: "a", embedding: [0, 1, 0] },   // 0
    { id: "b", embedding: [1, 0, 0] },   // 1 (best)
    { id: "c", embedding: [0.9, 0.1, 0] }, // ~0.99
  ];
  const r = rankBySimilarity(q, cands, 2);
  assert.deepEqual(r.map((x) => x.id), ["b", "c"]);
  assert.ok(r[0].score >= r[1].score);
  assert.equal(r[0].embedding, undefined, "embedding must be stripped from results");
  assert.equal(typeof r[0].score, "number");
});

test("rankBySimilarity skips excluded ids and bad/mismatched embeddings", () => {
  const q = [1, 0];
  const cands = [
    { id: "self", embedding: [1, 0] },
    { id: "x", embedding: [1, 0] },
    { id: "y", embedding: [1, 0, 0] }, // wrong dim → skipped
    { id: "z", embedding: null },       // no embedding → skipped
  ];
  const r = rankBySimilarity(q, cands, 5, (c) => c.id === "self");
  assert.deepEqual(r.map((x) => x.id), ["x"]);
});

test("rankBySimilarity: empty query → []", () => {
  assert.deepEqual(rankBySimilarity([], [{ id: "a", embedding: [1] }]), []);
});

test("parseEmbedding handles JSON strings, arrays, and garbage", () => {
  assert.deepEqual(parseEmbedding("[1,2,3]"), [1, 2, 3]);
  assert.deepEqual(parseEmbedding([1, 2]), [1, 2]);
  assert.equal(parseEmbedding(""), null);
  assert.equal(parseEmbedding("not json"), null);
  assert.equal(parseEmbedding('["a","b"]'), null); // non-numeric
  assert.equal(parseEmbedding(null), null);
});
