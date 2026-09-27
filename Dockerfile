# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=cola-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --package-import-method=copy

# Generated public assets depend on locked packages, not the Next output.
FROM dependencies AS static-assets
COPY lib/rive-assets.js ./lib/
COPY scripts/copy-maplibre-worker.js scripts/copy-rive-runtime.js ./scripts/
RUN node scripts/copy-maplibre-worker.js && node scripts/copy-rive-runtime.js

FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY next.config.mjs proxy.js ./
COPY app ./app
COPY lib ./lib
COPY scripts/build-version.js ./scripts/
# Compiler cache stays in the local builder, never in an exported image/cache layer.
# DB migrations and public files do not participate in web compilation.
RUN --mount=type=cache,id=cola-next-cache,target=/app/.next/cache,sharing=locked \
    node scripts/build-version.js --web-only && pnpm exec next build && \
    mv .next/standalone/node_modules /app/runtime-node_modules && \
    rm -rf .next/standalone/scripts

FROM node:24.21.0-alpine AS ops-dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=cola-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --prod --frozen-lockfile --store-dir=/pnpm/store --package-import-method=copy

FROM node:24.21.0-alpine AS runtime-base
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup -S colabike && adduser -S colabike -G colabike && mkdir uploads rides && chown colabike:colabike uploads rides

# Explicit one-shot/operator target. No Next build is required for this image.
FROM runtime-base AS ops
# Copy regular files independently, retaining pnpm relative symlinks. This avoids
# BuildKit's cross-stage hardlink copier for duplicate pnpm license entries.
RUN --mount=type=bind,from=ops-dependencies,source=/app/node_modules,target=/runtime-node_modules \
    node --input-type=module -e "import { cp } from 'node:fs/promises'; await cp('/runtime-node_modules', './node_modules', { recursive: true, dereference: false, verbatimSymlinks: true });"
COPY package.json ./
COPY lib ./lib
COPY db ./db
COPY scripts/check-runtime.js scripts/migrate.js \
    scripts/bootstrap-admin.js scripts/set-admin.js scripts/reset-password.js \
    scripts/audit-photo-files.js scripts/recalculate-photo-storage.js \
    scripts/cleanup-rides.js scripts/chat-sync.js scripts/chat-setup.js ./scripts/
RUN node --input-type=module -e "await import('./lib/rides.js'); await import('./lib/factory-import.js')"
USER colabike
CMD ["sh", "-c", "node scripts/check-runtime.js && node scripts/migrate.js"]

# Default target stays the web server. Traced dependencies precede mutable output:
# a source-only rebuild can reuse this layer when the traced files are identical.
FROM runtime-base AS runner
RUN --mount=type=bind,from=builder,source=/app/runtime-node_modules,target=/runtime-node_modules \
    node --input-type=module -e "import { cp } from 'node:fs/promises'; await cp('/runtime-node_modules', './node_modules', { recursive: true, dereference: false, verbatimSymlinks: true });"
COPY --from=builder --chown=colabike:colabike /app/.next/standalone ./
COPY --from=builder --chown=colabike:colabike /app/.next/static ./.next/static
COPY --chown=colabike:colabike public ./public
COPY --from=static-assets --chown=colabike:colabike /app/public ./public
# The fail-fast startup validator has only these local imports (no migration path).
COPY scripts/check-runtime.js ./scripts/
COPY lib/runtime-config.js lib/csp.js lib/chat-config.js lib/error-tracker.js lib/mail.js ./lib/
COPY --from=builder /app/lib/version.js ./lib/version.js
USER colabike
EXPOSE 3000
CMD ["sh", "-c", "node scripts/check-runtime.js && exec node server.js"]
