# ---- Today's Focus : production image ----
# Node 24 ships SQLite built-in (node:sqlite), so there is NO native build step.
FROM node:24-slim

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
  CMD node -e "fetch('http://127.0.0.1:${PORT}/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]