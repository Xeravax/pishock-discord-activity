FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

# Build identity — set by CI (tag → vX.Y.Z, branch → name-shortsha)
ARG GIT_SHA=unknown
ARG GIT_REF_NAME=local
ARG GIT_REF_TYPE=branch
ENV GIT_SHA=$GIT_SHA \
    GIT_REF_NAME=$GIT_REF_NAME \
    GIT_REF_TYPE=$GIT_REF_TYPE

ARG VITE_DISCORD_CLIENT_ID=
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID

RUN node scripts/write-version.mjs

# Build-only placeholders (inline, not ENV) so the image layers never retain secret-named vars.
# Real runtime values come from compose/.env at container start.
RUN DATABASE_URL="postgresql://pishock:pishock@db:5432/pishock?schema=public" \
    DISCORD_CLIENT_ID="build" \
    DISCORD_CLIENT_SECRET="build" \
    TOKEN_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" \
    PUBLIC_URL="http://localhost:3000" \
    PORT="3000" \
    npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist
COPY --from=build /app/client-dist ./client-dist
COPY --from=build /app/version.json ./version.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
