# syntax=docker/dockerfile:1
FROM node:26.13.0-alpine3.24 AS base
WORKDIR /app
# Node >= 25 no longer includes corepack.
RUN npm install --global pnpm@12.16.1

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pulse-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

FROM deps AS build
ARG BASE_PATH=""
ENV BASE_PATH=${BASE_PATH}
ENV NEXT_TELEMETRY_DISABLED=1
COPY next.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN pnpm build

FROM deps AS migrator
ENV TMPDIR=/tmp
RUN apk add --no-cache tzdata
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# Seed reads fictional regulations from markdown (D-22); runtime reads them from the DB.
COPY content ./content
COPY drizzle ./drizzle
COPY infra/cron/scheduler /etc/crontabs/root
CMD ["pnpm", "db:migrate"]

# Runtime carries only the node binary (no npm/npx/corepack): smaller image, fewer tools for an attacker.
FROM alpine:3.24 AS runtime
ARG BASE_PATH=""
# libatomic is required by the linux/amd64 node binary (not by arm64) — verified on both platforms
RUN apk add --no-cache libstdc++ libgcc libatomic
COPY --from=base /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NODE_ENV=production \
    BASE_PATH=${BASE_PATH} \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
    CMD node -e "fetch('http://127.0.0.1:3000' + process.env.BASE_PATH + '/api/health', {signal: AbortSignal.timeout(4000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
