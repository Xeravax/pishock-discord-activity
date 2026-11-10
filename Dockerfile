# syntax=docker/dockerfile:1

# ---- Discord Embedded App SDK bundle (small Node stage) ----
FROM node:22-alpine AS sdk
WORKDIR /sdk
COPY sdk-bundle/package.json sdk-bundle/package-lock.json* ./
RUN npm install --omit=dev || npm install
COPY sdk-bundle ./
RUN mkdir -p /out && node build.mjs || cp stub-discordSdk.js /out/discordSdk.vendor.js

# ---- build ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
ARG DISCORD_CLIENT_ID=
ARG GIT_SHA=unknown
ARG GIT_REF_NAME=local
ARG GIT_REF_TYPE=branch

COPY PiShock.Activity.sln ./
COPY src/PiShock.Activity.Server/PiShock.Activity.Server.csproj src/PiShock.Activity.Server/
COPY src/PiShock.Activity.Web/PiShock.Activity.Web.csproj src/PiShock.Activity.Web/
COPY src/PiShock.Activity.ApiClient/PiShock.Activity.ApiClient.csproj src/PiShock.Activity.ApiClient/
COPY tests/PiShock.Activity.Tests/PiShock.Activity.Tests.csproj tests/PiShock.Activity.Tests/
RUN dotnet restore PiShock.Activity.sln

COPY src ./src
COPY tests ./tests
COPY version.json* ./
COPY prisma ./prisma

# Bake Discord client id into WASM appsettings (public client id only)
RUN if [ -n "$DISCORD_CLIENT_ID" ]; then \
      printf '{\n  "DiscordClientId": "%s"\n}\n' "$DISCORD_CLIENT_ID" \
        > src/PiShock.Activity.Web/wwwroot/appsettings.json; \
    fi

# Vendor SDK only. wwwroot/js/discordSdk.js is the activity wrapper (bootstrap, auth).
COPY --from=sdk /out/discordSdk.vendor.js src/PiShock.Activity.Web/wwwroot/js/discordSdk.vendor.js

ENV GIT_SHA=$GIT_SHA GIT_REF_NAME=$GIT_REF_NAME GIT_REF_TYPE=$GIT_REF_TYPE
RUN dotnet publish src/PiShock.Activity.Server/PiShock.Activity.Server.csproj \
      -c Release -o /app/publish /p:UseAppHost=false

# ---- runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://0.0.0.0:3000 \
    ASPNETCORE_ENVIRONMENT=Production \
    PORT=3000
COPY --from=build /app/publish .
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
 && apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null || exit 1
ENTRYPOINT ["/app/docker-entrypoint.sh"]
