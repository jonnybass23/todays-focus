# ---- Today's Focus : production image ----
# Node 24 ships SQLite built-in (node:sqlite), so there is NO native build step.
FROM node:24-slim

ENV PORT=3000 \
    DATA_DIR=/app/data \
    PUID=1000 \
    PGID=1000

WORKDIR /app

# gosu lets the entrypoint drop from root to an arbitrary PUID/PGID at runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*

# Install all deps (dev included) — needed to build Tailwind CSS
COPY package*.json ./
RUN npm install && npm cache clean --force

# App source + build static CSS, then prune dev deps
COPY . .
RUN npm run build:css && npm prune --omit=dev

# Switch to production runtime mode (after dev deps were used to build the CSS)
ENV NODE_ENV=production

# Entrypoint adopts PUID/PGID, fixes data-dir ownership, then drops privileges.
# sed strips any CR so the script runs even if checked out with CRLF on Windows.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p "$DATA_DIR"

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:${PORT}/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Starts as root so the entrypoint can chown the data dir, then runs node as PUID:PGID
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]