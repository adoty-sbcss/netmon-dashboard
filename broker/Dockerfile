# NetMon tunnel-broker — tiny stateless WS relay.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Run as the built-in unprivileged user.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.js ./
USER node
EXPOSE 8080
# Lightweight liveness: the broker answers /healthz on its port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BROKER_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
