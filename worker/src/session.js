// session.js — one Durable Object per conversation (session_id), holding the modify chain:
// the ordered list of code versions so "faster" / "darker" follow-ups edit the last version
// instead of re-rolling from scratch (Contract 1's stable session_id → the modify loop).
//
// SQLite-backed DO (see wrangler.toml [[migrations]] new_sqlite_classes). State is small — an
// array of {version, code, share_url, source, instruction} — so KV-style ctx.storage is plenty;
// D1 (cross-session history / "trending") is the remaining Phase 3 P2 piece.
import { DurableObject } from "cloudflare:workers";

export class Session extends DurableObject {
  async _versions() {
    return (await this.ctx.storage.get("versions")) || [];
  }

  // Append a new version; returns its 1-based version number.
  async append({ code, share_url, source, instruction }) {
    const versions = await this._versions();
    const version = versions.length + 1;
    versions.push({
      version,
      code,
      share_url,
      source: source || "generate",
      instruction: instruction ?? null,
    });
    await this.ctx.storage.put("versions", versions);
    return version;
  }

  // The most recent version (what a /modify edits), or null for an unknown/empty session.
  async latest() {
    const versions = await this._versions();
    return versions.length ? versions[versions.length - 1] : null;
  }

  // Full chain, for a future history/undo endpoint.
  async history() {
    return await this._versions();
  }
}
