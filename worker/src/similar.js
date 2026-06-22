// similar.js — "more like this" (roadmap: pgvector → Vectorize). Pure vector math + ranking, kept
// separate so it's unit-testable without a DB or network.
//
// Scale note: we rank with cosine similarity over embeddings stored in D1 (fetched per query). That is
// correct and plenty fast at this project's scale (hundreds–low-thousands of tracks). The roadmap's
// Vectorize is the scale-up path (ANN over millions) — swap recentEmbeddedTracks()+rankBySimilarity()
// for a Vectorize query when the table outgrows an in-Worker scan; the endpoint contract stays the same.

// Cosine similarity of two equal-length numeric vectors. 0 for a zero vector or a length mismatch.
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Rank candidates (each {embedding:number[], ...}) against the query vector; return the top k with a
// `score`, descending. Candidates without a usable embedding are dropped. `exclude(c)` skips matches
// (e.g. the query track itself). The embedding is stripped from the returned objects (it's bulky).
export function rankBySimilarity(queryVec, candidates, k = 5, exclude = () => false) {
  if (!Array.isArray(queryVec) || queryVec.length === 0) return [];
  const scored = [];
  for (const c of candidates) {
    if (!c || exclude(c) || !Array.isArray(c.embedding) || c.embedding.length !== queryVec.length) continue;
    const { embedding, ...rest } = c;
    scored.push({ ...rest, score: cosineSimilarity(queryVec, embedding) });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, Math.max(1, Math.min(50, k)));
}

// Parse an embedding stored as a JSON string (D1 column); null if absent/garbage.
export function parseEmbedding(s) {
  if (Array.isArray(s)) return s;
  if (typeof s !== "string" || !s) return null;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) && v.every((n) => typeof n === "number") ? v : null;
  } catch {
    return null;
  }
}
