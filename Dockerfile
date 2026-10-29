# syntax=docker/dockerfile:1
# Telios: the API (Node, which serves the built web app) and its image worker (Python).
# Ghostscript draws EPS uploads. ComfyUI is not in here: it is a Phansora API's
# (COMFYUI_API_URL) or the "comfyui" service of docker-compose.prod.yml.

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ghostscript \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-fund --no-audit

COPY worker/requirements.txt worker/
RUN python3 -m venv .venv && .venv/bin/pip install --no-cache-dir -r worker/requirements.txt

COPY . .
RUN cd apps/web && npx vite build --logLevel warn

ENV NODE_ENV=production HOST=127.0.0.1 PORT=5178 TELIOS_DATA=/app/data
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
