# Multi-stage build for a small, production-only image.
# Works as a persistent Node process on Railway, Render, Fly.io, a plain
# VPS/Docker host, etc. Do NOT use this on a serverless-functions platform
# (e.g. Netlify Functions) - the remote command gateway's SSE stream and
# in-memory state need one long-running process, see HANDOFF.md /
# DEPLOY.md for details.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Values baked in at build time only if you actually use them client-side;
# none of this project's secrets are (they're all read server-side), so no
# build ARGs are required here.
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# `output: "standalone"` (next.config.ts) traces only the files actually
# needed at runtime into .next/standalone, including a minimal server.js.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Memory, tasks and usage stats live in ./data. Create it owned by the app user so a
# named volume mounted here is writable (see docker-compose.yml).
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
