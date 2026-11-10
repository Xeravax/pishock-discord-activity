function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadEnv() {
  const port = Number(process.env.PORT ?? '3000');
  return {
    databaseUrl: required('DATABASE_URL'),
    discordClientId: required('DISCORD_CLIENT_ID'),
    discordClientSecret: required('DISCORD_CLIENT_SECRET'),
    tokenKey: required('TOKEN_KEY'),
    publicUrl: required('PUBLIC_URL'),
    port: Number.isFinite(port) ? port : 3000,
    /** Bot token for Activity Instance API (optional until multiplayer routes are used) */
    discordBotToken: process.env.DISCORD_BOT_TOKEN?.trim() || null,
    /** Application public key (hex) for proxy signature verification */
    discordPublicKey: process.env.DISCORD_PUBLIC_KEY?.trim() || null,
    /**
     * When true, /api/participants/* require valid Discord proxy signatures.
     * Defaults on in production unless explicitly set to 0.
     */
    requireDiscordProxyAuth:
      process.env.REQUIRE_DISCORD_PROXY_AUTH === '1' ||
      (process.env.NODE_ENV === 'production' && process.env.REQUIRE_DISCORD_PROXY_AUTH !== '0'),
    /**
     * Dev-only: allow skipping Activity Instance API when DISCORD_BOT_TOKEN is missing.
     * Never enable in production.
     */
    allowMissingBotInstanceCheck:
      process.env.ALLOW_MISSING_BOT_INSTANCE_CHECK === '1' && process.env.NODE_ENV !== 'production',
  };
}

export type AppEnv = ReturnType<typeof loadEnv>;
