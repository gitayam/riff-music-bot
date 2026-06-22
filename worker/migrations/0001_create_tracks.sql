-- Phase 3 P2 — tracks history (Contract 5, ported from Supabase Postgres to D1).
-- Canonical schema; must match SCHEMA_STMTS in src/store.js (which also creates it lazily so local
-- `wrangler dev` works without an explicit apply). Apply in prod:
--   wrangler d1 migrations apply riff-tracks --remote
-- Retention (D1 is capped at 10 GB) is handled by the daily Cron Trigger -> scheduled() -> pruneTracks().
CREATE TABLE IF NOT EXISTS tracks (
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
);
CREATE INDEX IF NOT EXISTS idx_tracks_session ON tracks(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tracks_created ON tracks(created_at);
