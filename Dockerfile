# syntax=docker/dockerfile:1

# ---- deps (cached unless package*.json change) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ---- build (UI + server) ----
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Dummy URL for generate only — Prisma does not connect during generate.
ARG PRISMA_BUILD_DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
RUN DATABASE_URL="$PRISMA_BUILD_DATABASE_URL" npx prisma generate

COPY . .

# Build identity (CI passes these; local defaults are fine)
ARG GIT_SHA=unknown
ARG GIT_REF_NAME=local
ARG GIT_REF_TYPE=branch
# Required for the Discord Embedded App SDK client bundle
ARG VITE_DISCORD_CLIENT_ID

RUN if [ -z "$VITE_DISCORD_CLIENT_ID" ]; then \
      echo "ERROR: build-arg VITE_DISCORD_CLIENT_ID is required (Discord application client id)." >&2; \
      exit 1; \
    fi

RUN GIT_SHA="$GIT_SHA" GIT_REF_NAME="$GIT_REF_NAME" GIT_REF_TYPE="$GIT_REF_TYPE" \
    node scripts/write-version.mjs

# Placeholders are inline (not ENV) so secret-named vars never persist in image layers.
# Real runtime secrets come from compose / .env at container start.
RUN DATABASE_URL="$PRISMA_BUILD_DATABASE_URL" \
    DISCORD_CLIENT_ID="build" \
    DISCORD_CLIENT_SECRET="build" \
    TOKEN_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" \
    PUBLIC_URL="http://localhost:3000" \
    PORT="3000" \
    VITE_DISCORD_CLIENT_ID="$VITE_DISCORD_CLIENT_ID" \
    npm run build

# ---- production node_modules ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev
COPY prisma ./prisma
COPY prisma.config.ts ./
ARG PRISMA_BUILD_DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
RUN DATABASE_URL="$PRISMA_BUILD_DATABASE_URL" npx prisma generate

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=prod-deps /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/dist ./dist
COPY --from=build /app/client-dist ./client-dist
COPY --from=build /app/version.json ./version.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh \
 && mkdir -p /app/data/pishock-profiles \
 && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
