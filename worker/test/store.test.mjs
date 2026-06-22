// Unit tests for the D1 store's pure helpers (the query/prune functions need a live D1, exercised
// in test.sh's wrangler-dev integration pass).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampLimit, retentionCutoff, buildTrackRow, newId, SCHEMA_STMTS } from "../src/store.js";

test("clampLimit defaults to 20 and clamps to [1,100]", () => {
  assert.equal(clampLimit(undefined), 20);
  assert.equal(clampLimit("5"), 5);
  assert.equal(clampLimit(500), 100);
  assert.equal(clampLimit(0), 20);   // 0 is falsy → default
  assert.equal(clampLimit(-3), 1);
  assert.equal(clampLimit("abc"), 20);
});

test("retentionCutoff subtracts whole days; never negative days", () => {
  assert.equal(retentionCutoff(1_000_000, 1), 1_000_000 - 86400);
  assert.equal(retentionCutoff(1_000_000, 30), 1_000_000 - 30 * 86400);
  assert.equal(retentionCutoff(500, 0), 500);
  assert.equal(retentionCutoff(500, -5), 500); // negative clamped to 0
});

test("buildTrackRow fills every column (?? null), id/created_at injectable", () => {
  const row = buildTrackRow(
    { strudel_code: "stack(sound(\"bd*4\"))", share_url: "https://strudel.cc/#x", source: "modify", session_id: "s1", instruction: "darker", parent_id: "p1", version: 3 },
    "id1", 123
  );
  assert.deepEqual(row, {
    id: "id1", session_id: "s1", prompt: null, instruction: "darker", source: "modify",
    strudel_code: "stack(sound(\"bd*4\"))", share_url: "https://strudel.cc/#x",
    parent_id: "p1", version: 3, created_at: 123,
  });
});

test("buildTrackRow defaults source=generate, version=1, nulls", () => {
  const row = buildTrackRow({ strudel_code: "x", share_url: "y" }, "id2", 9);
  assert.equal(row.source, "generate");
  assert.equal(row.version, 1);
  assert.equal(row.session_id, null);
  assert.equal(row.prompt, null);
  assert.equal(row.parent_id, null);
});

test("newId returns a unique uuid", () => {
  const a = newId(), b = newId();
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.notEqual(a, b);
});

test("SCHEMA uses a lowercase snake_case table name (D1 FK-safety rule)", () => {
  assert.match(SCHEMA_STMTS[0], /CREATE TABLE IF NOT EXISTS tracks/);
  assert.ok(!/CREATE TABLE IF NOT EXISTS [A-Z]/.test(SCHEMA_STMTS[0]));
});
