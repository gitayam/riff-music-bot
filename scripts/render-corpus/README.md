# render-corpus

Snippets for the render-reliability ratchet (`scripts/render-corpus.mjs`). Each `.js` file is
**raw Strudel code** (read as text, piped to `render/strudel-render.mjs` on stdin — *not* imported
or executed as JavaScript; the `.js` extension is just for editor highlighting).

Naming convention:

| Prefix   | Meaning | Expected today |
|----------|---------|----------------|
| `good-*` | Canonical, engine-supported loops | render **OK** — these are the regression guard |
| `bad-*`  | Minimal isolation of one engine-unsupported construct (`.lpenv`, `.swingBy`, arrow-`.sometimes`) | **fail** — remediation (R1.1 sanitizer) must flip these to OK |
| `real-*` | Real `strudel_code` rows pulled from prod D1 where `audio_url` was NULL | mixed — the ones carrying unsupported constructs fail today |

The ratchet runs the **real offline engine**, so a failure here is exactly the `could not render`
(422) a `/riff` hits in production. The recorded baseline lives in
`docs/reliability-roadmap-progress.md` front-matter (`ratchet.baseline`); it must never increase.
