#!/usr/bin/env python3
"""radio-serve.py <root> [--port P] — serve the generative-radio HLS output + a steerable player.

Replaces a plain `python -m http.server` so the browser player can STEER the live stream:
  GET  /<file>   → static file from <root> (stream.m3u8, segments, radio.html)
  POST /steer    → write the request body to <root>/steer (radio.sh re-reads it each segment,
                   so the stream follows the next segment on); empty body clears it
  GET  /steer    → the current steer hint

Stdlib only; binds 127.0.0.1. Launched by radio.sh --serve. The steer body is plain data — it's
used only for case-insensitive substring matching in radio-compose.mjs (never eval'd or shelled),
and is length-capped + newline-stripped here.
"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
PORT = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8123
STEER = os.path.join(ROOT, "steer")


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def _txt(self, code, body=""):
        b = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        if self.path.rstrip("/") == "/steer":
            n = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(n).decode("utf-8", "replace") if n > 0 else ""
            hint = " ".join(raw.split())[:120]                 # collapse whitespace/newlines, cap length
            try:
                with open(STEER, "w") as f:
                    f.write(hint)
            except OSError as e:
                return self._txt(500, f"error: {e}")
            return self._txt(200, f"steering: {hint or '(cleared)'}")
        self._txt(404, "not found")

    def do_GET(self):
        if self.path.rstrip("/") == "/steer":
            cur = ""
            try:
                with open(STEER) as f:
                    cur = f.read().strip()
            except OSError:
                pass
            return self._txt(200, cur)
        super().do_GET()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    os.makedirs(ROOT, exist_ok=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
