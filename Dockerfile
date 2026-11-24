# The one container Fly.io runs (PRD SYS-18, D-20, D-200): the built page and the Kiro server in one process.
# Build context is the repo root (the server needs `.kiro/agents` and `.kiro/prompts` next to `game/`).
#
#   docker build -t blackout .
#   docker run --rm -p 8080:8080 blackout                      # offline Kiro: no key in the image, by design
#   docker run --rm -p 8080:8080 -e KIRO_API_KEY=ksk_… blackout   # Kiro online (never bake a key in; Fly: `fly secrets set`)
#
# See docs/HOSTING.md for the runbook.

# ---------- build: the page ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app/game
COPY game/package.json game/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY game/ ./
RUN npm run build && npm prune --omit=dev

# ---------- runtime: node + kiro-cli, non-root ----------
FROM node:22-bookworm-slim AS runtime

# kiro-cli, the official Linux zip (kiro.dev/docs/getting-started/installation, "Zip (glibc 2.34+)"; bookworm has
# 2.36). Kiro ships the latest build only: there is no version-pinned URL (KI-200), so the version installed is
# printed at build time and auto-update is off at run time (KIRO_NO_AUTO_UPDATE). `install.sh --global` copies the
# binary to /usr/local/bin and edits no shell file.
ARG TARGETARCH=amd64
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/* \
 && case "$TARGETARCH" in amd64) arch=x86_64 ;; arm64) arch=aarch64 ;; *) echo "unsupported arch $TARGETARCH" >&2; exit 1 ;; esac \
 && curl --proto '=https' --tlsv1.2 -sSf "https://desktop-release.q.us-east-1.amazonaws.com/latest/kirocli-${arch}-linux.zip" -o /tmp/kirocli.zip \
 && cd /tmp && unzip -q kirocli.zip && cat kirocli/BUILD-INFO && ./kirocli/install.sh --global \
 && rm -rf /tmp/kirocli /tmp/kirocli.zip \
 && kiro-cli --version

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    KIRO_CLI=kiro-cli \
    KIRO_STATE_FILE=/data/runs.json \
    KIRO_NO_AUTO_UPDATE=1

WORKDIR /app
# The custom agent the server copies into each run's temp folder (D-190).
COPY .kiro/agents /app/.kiro/agents
COPY .kiro/prompts /app/.kiro/prompts
# The server runs from TypeScript with tsx (a runtime dependency) and imports the rails and the fallback texts
# from src/, so src/ ships too; dist/ is the built page it serves.
COPY --from=build /app/game/node_modules /app/game/node_modules
COPY --from=build /app/game/dist /app/game/dist
COPY game/package.json game/tsconfig*.json /app/game/
COPY game/server /app/game/server
COPY game/src /app/game/src

# /data holds the counters (KI-193): the container disk by default, a 1 GB Fly volume if fly.toml mounts one.
# kiro-cli needs a writable HOME for its credential store and bundled runtime; `node` owns /home/node.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
WORKDIR /app/game
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node_modules/.bin/tsx", "server/main.ts"]
