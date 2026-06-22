// store.js — D1 persistence for the tracks history (Phase 3 P2). Every generate/modify/render is
// logged as a `tracks` row so the dashboard can list history across sessions (Contract 5), and a
// daily retention cron prunes old rows (D1 is capped at 10 GB — an unbounded log table is the
// documented way to hit it). Table name is lowercase snake_case (PascalCase causes silent FK
// failures on D1). All persistence is BEST-EFFORT: a D1 hiccup must never break the music response.

// Canonical schema. Mirrored in migrations/0001_create_tracks.sql for `wrangler d1 migrations apply`
// in prod; ensureSchema() also creates it lazily so local `wrangler dev` (which doesn't auto-apply
// migrations) and a fresh deploy both just work. CREATE ... IF NOT EXISTS = idempotent.
export const SCHEMA_STMTS = [
  `CREATE TABLE IF NOT EXISTS tracks (
     id           TEXT PRIMARY KEY,
     session_id   TEXT,
     prompt       TEXT,
     instruction  TEXT,
     source       TEXT NOT NULL,
     strudel_code TEXT NOT NULL,
     share_url    TEXT NOT NULL,
     parent_id    TEXT,
     version      INTEGER NOT NULL DEFAULT 1,
     created_at   INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tracks_session ON tracks(session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tracks_created ON tracks(created_at)`,
];

export const nowSec = () => Math.floor(Date.now() / 1000);
export const newId = () => crypto.randomUUID();

// /history limit, clamped (a hostile/huge limit shouldn't scan the table).
export function clampLimit(limit) {
  return Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
}

// Retention boundary: rows with created_at < this are pruned. Pure → unit-testable.
export function retentionCutoff(nowSeconds, days) {
  const d = Math.max(0, parseInt(days, 10) || 0);
  return Math.floor(nowSeconds) - d * 86400;
}

// Build a complete tracks row from a partial — every column present (?? null), so binds never go
// out of sync with the INSERT. id/created_at injectable for deterministic tests.
export function buildTrackRow(p, id, createdAt) {
  return {
    id: id ?? newId(),
    session_id: p.session_id ?? null,
    prompt: p.prompt ?? null,
    instruction: p.instruction ?? null,
    source: p.source || "generate",
    strudel_code: p.strudel_code,
    share_url: p.share_url,
    parent_id: p.parent_id ?? null,
    version: p.version ?? 1,
    created_at: createdAt ?? nowSec(),
  };
}

let _schema; // per-isolate memo so we run the DDL once, not per request
export async function ensureSchema(db) {
  if (!_schema) {
    _schema = (async () => {
      for (const stmt of SCHEMA_STMTS) await db.prepare(stmt).run();
    })().catch((e) => {
      _schema = undefined; // let a later request retry if the first DDL failed
      throw e;
    });
  }
  return _schema;
}

// Insert a track. Best-effort: returns the id, or null if there's no DB / the write failed
// (logged, never thrown — the caller already has the music to return).
export async function insertTrack(env, row) {
  if (!env.DB) return null;
  try {
    await ensureSchema(env.DB);
    await env.DB.prepare(
      `INSERT INTO tracks (id, session_id, prompt, instruction, source, strudel_code, share_url, parent_id, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      row.id, row.session_id, row.prompt, row.instruction, row.source,
      row.strudel_code, row.share_url, row.parent_id, row.version, row.created_at
    ).run();
    return row.id;
  } catch (e) {
    console.log("track persist failed (non-fatal):", e.message);
    return null;
  }
}

// Most-recent tracks, optionally scoped to a session. Throws (the /history handler maps to 500).
export async function recentTracks(env, { session_id, limit } = {}) {
  await ensureSchema(env.DB);
  const lim = clampLimit(limit);
  const stmt = session_id
    ? env.DB.prepare(`SELECT * FROM tracks WHERE session_id = ? ORDER BY created_at DESC, version DESC LIMIT ?`).bind(session_id, lim)
    : env.DB.prepare(`SELECT * FROM tracks ORDER BY created_at DESC LIMIT ?`).bind(lim);
  const { results } = await stmt.all();
  return results || [];
}

// Delete tracks older than `days`. Returns the number pruned. Best-effort (no DB → 0).
export async function pruneTracks(env, days) {
  if (!env.DB) return 0;
  await ensureSchema(env.DB);
  const cutoff = retentionCutoff(nowSec(), days);
  const r = await env.DB.prepare(`DELETE FROM tracks WHERE created_at < ?`).bind(cutoff).run();
  return r.meta?.changes ?? 0;
}
