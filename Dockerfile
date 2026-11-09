FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
ARG VITE_DISCORD_CLIENT_ID=
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID
# Provide placeholder env so `tsc`/vite can build without runtime secrets
ENV DATABASE_URL="postgresql://pishock:pishock@db:5432/pishock?schema=public"
ENV DISCORD_CLIENT_ID="build"
ENV DISCORD_CLIENT_SECRET="build"
ENV TOKEN_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
ENV PUBLIC_URL="http://localhost:3000"
ENV PORT="3000"
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist
COPY --from=build /app/client-dist ./client-dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
