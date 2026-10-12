# CRM_YE — production image (Next.js standalone + migration/backup tooling).
# Used by docker-compose.yml; see DEPLOY.md.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-pdf-worker.mjs scripts/
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node scripts/copy-pdf-worker.mjs && npm run build

FROM node:22-alpine AS runner
# pg_dump/pg_restore for scripts/backup.sh + restore.sh; su-exec to drop root.
RUN apk add --no-cache postgresql16-client bash tar su-exec \
 && addgroup -S crmye && adduser -S -G crmye crmye
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3006 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh scripts/*.sh
EXPOSE 3006
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget -qO- http://127.0.0.1:3006/api/health >/dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "node scripts/db-migrate.mjs && exec node server.js"]
