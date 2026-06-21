# ---- Today's Focus : production image ----
# Node 24 ships SQLite built-in (node:sqlite), so there is NO native build step.
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

WORKDIR /app

# Install all deps (dev included) — needed to build Tailwind CSS
COPY package*.json ./
RUN npm install && npm cache clean --force

# App source + build static CSS, then prune dev deps
COPY . .
RUN npm run build:css && npm prune --omit=dev

# Persist the database outside the image; run unprivileged
RUN mkdir -p "$DATA_DIR" && chown -R node:node /app
USER node

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
