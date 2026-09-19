FROM node:22-alpine AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine AS runtime-dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Keep a complete production dependency graph for unbundled operator scripts.
RUN pnpm install --prod --frozen-lockfile

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup -S colabike && adduser -S colabike -G colabike && mkdir uploads rides && chown colabike:colabike uploads rides
COPY --from=builder --chown=colabike:colabike /app/.next/standalone ./
COPY --from=runtime-dependencies --chown=colabike:colabike /app/node_modules ./node_modules
COPY --from=builder --chown=colabike:colabike /app/.next/static ./.next/static
COPY --from=builder --chown=colabike:colabike /app/public ./public
COPY --from=builder --chown=colabike:colabike /app/db ./db
COPY --from=builder --chown=colabike:colabike /app/scripts ./scripts
COPY --from=builder --chown=colabike:colabike /app/lib ./lib
RUN node --input-type=module -e "await import('./lib/rides.js'); await import('./lib/factory-import.js')"
USER colabike
EXPOSE 3000
CMD ["sh", "-c", "node scripts/check-runtime.js && node scripts/migrate.js && node server.js"]
