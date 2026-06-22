# Render microservice image (Phase 3 P1). linux/amd64 — runs the faithful Strudel render engine
# (headless Chromium via Playwright + @strudel/web) + ffmpeg, behind the HTTP service in server.mjs.
# The Playwright base image already carries Chromium + all its system libs (the painful part).
#
# Build (from the zeroclaw/ repo root so render/ is in context):
#   docker build -f container/Dockerfile -t riff-render .
#   docker run --rm -p 8800:8800 riff-render        # then POST /render
FROM mcr.microsoft.com/playwright:v1.61.0-jammy

# ffmpeg is the one extra system dep (transcode WAV → mp3/ogg + limiter).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The faithful engine + its vendored sample maps + the pre-cached sample packs (offline render).
# render/node_modules is installed fresh below; bring everything else.
COPY render/ /app/render/
COPY container/server.mjs /app/server.mjs

# Install the engine's deps (Chromium itself comes from the base image, so skip the browser download).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN cd /app/render && npm ci --omit=dev || npm install --omit=dev

ENV RENDER_DIR=/app/render
ENV PORT=8800
EXPOSE 8800
CMD ["node", "/app/server.mjs"]
