function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in .env / compose; the process will not start without it.`,
    );
  }
  return value;
}

function parseIdList(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    String(raw ?? '')
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter((id) => /^\d{5,25}$/.test(id)),
  );
}

/** Unset → default; "off" / "none" → disabled (null). */
function optionalSetting(raw: string | undefined, fallback: string): string | null {
  const v = raw?.trim();
  if (v === undefined || v === '') return fallback;
  return /^(off|none|false|0)$/i.test(v) ? null : v;
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
    /** Root for durable local files (PiShock profile images, etc.). Defaults to ./data */
    dataDir: process.env.DATA_DIR?.trim() || null,
    /**
     * Discord user ids allowed to use admin bypass (comma separated). Admins can skip soft
     * gates; exceeding a wearer's limits additionally needs that wearer's explicit consent.
     */
    adminDiscordUserIds: parseIdList(process.env.ADMIN_DISCORD_USER_IDS),
    /**
     * Community server people can join (OAuth guilds.join) so the bot can DM session recaps.
     * Set to "off" to disable. The bot must be in this guild with Create Invite permission.
     */
    communityGuildId: optionalSetting(process.env.DISCORD_COMMUNITY_GUILD_ID, '1572537113545805824'),
    communityInviteUrl: optionalSetting(
      process.env.DISCORD_COMMUNITY_INVITE_URL,
      'https://discord.gg/M6XjdQmb3E',
    ),
  };
}

export type AppEnv = ReturnType<typeof loadEnv>;
