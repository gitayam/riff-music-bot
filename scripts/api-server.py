#!/usr/bin/env python3
"""api-server.py — a synchronous HTTP music API for external groups.

ZeroClaw's own /webhook is async (408s, replies to a channel — not the caller), so this
thin server gives a real request/response API: prompt → {strudel_code, share_url, audio}.
Reuses the exact local chain: agent (gpt-5.4) → parse-gate (auto-repair retry) → faithful render → ffmpeg.
No external deps (stdlib only). Launch via api-server.sh so .env is loaded.

  POST /generate  {"prompt":"funky disco loop","cycles":4,"format":"mp3"}
                  → {"prompt","strudel_code","share_url","format","audio_base64"}
  POST /render    {"code":"setcpm(...)\\nstack(...)","cycles":4,"format":"mp3"}
                  → same shape (skips the LLM; renders code you already have)
  GET  /health    → {"ok":true}

Auth: every POST needs `Authorization: Bearer $MUSIC_API_TOKEN`. Bind localhost; expose
via a Cloudflare tunnel pointed at this port.
"""
import os, re, json, base64, subprocess, tempfile, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # the zeroclaw dir
TOKEN = os.environ.get("MUSIC_API_TOKEN", "")
PORT = int(os.environ.get("MUSIC_API_PORT", "8799"))   # 8787 is taken by workerd here
CODE_RE = re.compile(r"```(?:javascript|js)?\s*\n(.*?)```", re.S)
LINK_RE = re.compile(r"https://strudel\.cc/#\S+")


def gate_code(code):
    """Pure-node parse-gate. Returns None if the code parses, else the parse-error string.
    (render.mjs exits non-zero on invalid / [..]-wrapped code.)"""
    with tempfile.TemporaryDirectory() as td:
        g = subprocess.run(["node", f"{HERE}/render/render.mjs", code, os.path.join(td, "g.wav"), "1"],
                           capture_output=True, text=True, timeout=60)
    if g.returncode == 0:
        return None
    return (g.stderr.strip().splitlines() or ["invalid Strudel code"])[-1]


def render_code(code, cycles, fmt, pre_gated=False):
    """code -> (audio_bytes, share_url). Raises ValueError on invalid code.
    pre_gated=True skips the parse-gate (caller already validated, e.g. the repair loop)."""
    cycles = max(1, min(16, int(cycles or 4)))
    fmt = fmt if fmt in ("mp3", "ogg", "wav") else "mp3"
    with tempfile.TemporaryDirectory() as td:
        wav = os.path.join(td, "t.wav")
        if not pre_gated:
            err = gate_code(code)
            if err:
                raise ValueError(err)
        # faithful render (Chromium, code on stdin); timeout + one retry
        for attempt in (1, 2):
            r = subprocess.run(["node", f"{ROOT}/render/strudel-render.mjs", wav, str(cycles)],
                               input=code, capture_output=True, text=True, timeout=180)
            if r.returncode == 0 and os.path.exists(wav):
                break
            if attempt == 2:
                raise RuntimeError("render failed: " + (r.stderr.strip()[-300:] or "unknown"))
        out = wav
        if fmt != "wav":
            out = os.path.join(td, f"t.{fmt}")
            codec = ["-c:a", "libopus", "-b:a", "96k"] if fmt == "ogg" else ["-c:a", "libmp3lame", "-q:a", "4"]
            subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", "-i", wav,
                            "-af", "alimiter=limit=0.95", *codec, out], check=True)
        audio = open(out, "rb").read()
    share = "https://strudel.cc/#" + base64.b64encode(code.encode()).decode()
    return audio, share


def generate(prompt):
    """prompt -> strudel code (via the headless agent, gpt-5.4)."""
    r = subprocess.run([f"{ROOT}/run.sh", "agent", "-a", "hermes", "-m", prompt],
                       capture_output=True, text=True, timeout=180, cwd=ROOT)
    out = (r.stdout or "") + "\n" + (r.stderr or "")
    m = CODE_RE.search(out)
    if not m:
        raise RuntimeError("agent returned no Strudel code block")
    return m.group(1).strip()


def generate_valid(prompt, attempts=2, _gen=None):
    """prompt -> valid Strudel, auto-repairing on parse-gate failure.

    On invalid output, re-prompt the agent with the exact parse error + the broken code and
    ask for a fix — up to `attempts` total generations. Returns gated-valid code, or raises
    ValueError with the last parse error if it never converges. `_gen` is injectable for
    tests (defaults to the live agent `generate`)."""
    gen = _gen or generate
    attempts = max(1, min(4, int(attempts or 2)))
    last_err = "invalid Strudel code"
    code = None
    for i in range(attempts):
        p = prompt if i == 0 else (
            f"{prompt}\n\nYour previous attempt did not parse. Error: {last_err}\n"
            f"Broken code:\n{code}\n"
            "Return corrected, valid Strudel code only (one ```javascript block).")
        code = gen(p)
        err = gate_code(code)
        if err is None:
            return code
        last_err = err
    raise ValueError(f"could not produce valid Strudel after {attempts} attempts: {last_err}")


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *a):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % a))

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True})
        if self.path in ("/", "/help"):
            return self._send(200, {
                "service": "ZeroClaw music API",
                "auth": "Authorization: Bearer <MUSIC_API_TOKEN> on every POST",
                "endpoints": {
                    "POST /generate": "{prompt, cycles?, format?, repair_attempts?=2} → {strudel_code, share_url, format, audio_base64} (prompt → music via gpt-5.4; auto-repairs invalid Strudel by re-prompting with the parse error)",
                    "POST /render": "{code, cycles?, format?} → same shape (render Strudel you already have)",
                    "GET /health": "{ok:true}",
                },
                "formats": ["mp3", "ogg", "wav"], "cycles": "1–16 (default 4)",
                "example": "curl -H 'Authorization: Bearer $T' -d '{\"prompt\":\"funky disco loop\"}' <base>/generate",
            })
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not TOKEN or self.headers.get("Authorization", "") != f"Bearer {TOKEN}":
            return self._send(401, {"error": "unauthorized"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(n) or "{}")
        except Exception:
            return self._send(400, {"error": "bad json"})
        fmt = req.get("format", "mp3")
        cycles = req.get("cycles", 4)
        try:
            if self.path == "/generate":
                if not req.get("prompt"):
                    return self._send(400, {"error": "missing 'prompt'"})
                code = generate_valid(req["prompt"], req.get("repair_attempts", 2))
                pre_gated = True   # generate_valid already cleared the parse-gate
            elif self.path == "/render":
                if not req.get("code"):
                    return self._send(400, {"error": "missing 'code'"})
                code = req["code"]
                pre_gated = False  # caller's own code → gate it, 422 on invalid (never rewrite it)
            else:
                return self._send(404, {"error": "not found"})
            audio, share = render_code(code, cycles, fmt, pre_gated=pre_gated)
        except ValueError as e:
            return self._send(422, {"error": "invalid Strudel", "detail": str(e)})
        except subprocess.TimeoutExpired:
            return self._send(504, {"error": "timeout (agent or render took too long)"})
        except Exception as e:
            return self._send(500, {"error": str(e)})
        self._send(200, {
            "prompt": req.get("prompt"),
            "strudel_code": code,
            "share_url": share,
            "format": fmt,
            "audio_base64": base64.b64encode(audio).decode(),
        })


if __name__ == "__main__":
    if not TOKEN:
        sys.stderr.write("WARNING: MUSIC_API_TOKEN not set — all POSTs will 401. Set it in .env.\n")
    print(f"music api on http://127.0.0.1:{PORT}  (POST /generate, /render ; GET /health)")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
