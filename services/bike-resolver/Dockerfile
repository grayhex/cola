# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=cola-resolver-npm,target=/root/.npm,sharing=locked npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts/build-version.js ./scripts/build-version.js
RUN --mount=type=cache,id=cola-resolver-npm,target=/root/.npm,sharing=locked \
    npm run build && npm prune --omit=dev

FROM node:24.21.0-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
