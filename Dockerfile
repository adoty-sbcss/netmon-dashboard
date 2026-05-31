# syntax=docker/dockerfile:1

# ---- deps: install node_modules (cached unless lockfile changes) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile the Next.js app to a standalone server ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Telemetry off in CI/containers.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: minimal runtime image ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Run as a non-root user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# The standalone output already contains a minimal node_modules + server.js.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]

# ---- migrator: one-shot image for the migrate/seed Container Apps Job ----
# Reuses the builder layer (full node_modules incl. drizzle-kit + tsx, the
# source tree, and the drizzle/ migration SQL). It does NOT serve traffic — it
# applies pending migrations then seeds the break-glass admin, both idempotent,
# then exits. Built/pushed separately as netmon-dashboard-migrator:latest.
# Run via:  az containerapp job start -g <rg> -n w2-sbcss-netmon-migrate
# DATABASE_URL + AUTH_SECRET are injected as env (Key Vault secret refs).
FROM builder AS migrator
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
CMD ["sh", "-c", "npm run db:migrate && npm run auth:seed"]

# ---- ingest: one-shot image for the SFTP sync Container Apps Job (cron) ----
# Also reuses the builder layer (needs tsx + the ingest source + drizzle ORM).
# One SFTP session per run: pull new bundles, parse, upsert, exit. Idempotent.
# SFTP creds + DATABASE_URL are injected as env (secrets). See src/ingest/sync.ts.
# Built/pushed separately as netmon-dashboard-ingest:latest.
FROM builder AS ingest
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
CMD ["npm", "run", "ingest:sync"]
