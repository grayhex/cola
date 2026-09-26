# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=cola-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --package-import-method=copy

FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY next.config.mjs proxy.js ./
COPY app ./app
COPY lib ./lib
COPY db ./db
COPY public ./public
COPY scripts/build-version.js scripts/copy-maplibre-worker.js ./scripts/
RUN pnpm build && \
    rm -rf .next/standalone/node_modules && \
    rm -f .next/standalone/scripts/build-version.js .next/standalone/scripts/copy-maplibre-worker.js

FROM node:24.21.0-alpine AS runtime-dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Unbundled migration/operator commands need the complete production graph.
RUN --mount=type=cache,id=cola-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --prod --frozen-lockfile --store-dir=/pnpm/store --package-import-method=copy

FROM node:24.21.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup -S colabike && adduser -S colabike -G colabike && mkdir uploads rides && chown colabike:colabike uploads rides
COPY --from=builder --chown=colabike:colabike /app/.next/standalone ./
# Avoid BuildKit's cross-stage hardlink copier for pnpm license entries.
# Copy regular files independently, retaining pnpm's relative symlinks.
RUN --mount=type=bind,from=runtime-dependencies,source=/app/node_modules,target=/runtime-node_modules \
    node --input-type=module -e "import { cp } from 'node:fs/promises'; await cp('/runtime-node_modules', './node_modules', { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });" && \
    chown -R colabike:colabike ./node_modules
COPY --from=builder --chown=colabike:colabike /app/.next/static ./.next/static
COPY --from=builder --chown=colabike:colabike /app/public ./public
COPY --from=builder --chown=colabike:colabike /app/db ./db
COPY --from=builder --chown=colabike:colabike /app/lib ./lib
# Host backup/restore and test/benchmark harnesses deliberately stay outside.
COPY --chown=colabike:colabike \
    scripts/check-runtime.js scripts/migrate.js \
    scripts/bootstrap-admin.js scripts/set-admin.js scripts/reset-password.js \
    scripts/audit-photo-files.js scripts/recalculate-photo-storage.js \
    scripts/cleanup-rides.js ./scripts/
RUN node --input-type=module -e "await import('./lib/rides.js'); await import('./lib/factory-import.js')"
USER colabike
EXPOSE 3000
CMD ["sh", "-c", "node scripts/check-runtime.js && node scripts/migrate.js && exec node server.js"]
