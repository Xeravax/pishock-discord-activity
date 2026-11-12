import type { FastifyPluginAsync } from 'fastify';
import { DiscordAuthError, exchangeDiscordCode } from '../discord.js';
import type { AppEnv } from '../env.js';
import {
  SAFETY_ACK_ITEMS,
  SAFETY_ACK_VERSION,
  validateConsentAcknowledgements,
} from '../consent.js';
import { softApiKeyProfile } from '../pishock/auth-api.js';
import {
  clearConsent,
  getCommandQueueEnabled,
  getEmergencyStopShockerIds,
  getPersonalActivityLimits,
  setConsent,
} from '../session.js';

const profileCache = new Map<
  string,
  { at: number; username: string | null; avatarUrl: string | null; bannerUrl: string | null }
>();
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

export const authRoutes: FastifyPluginAsync<{ env: AppEnv }> = async (app, opts) => {
  app.post('/api/auth/discord', async (req, reply) => {
    const body = req.body as { code?: string };
    if (!body?.code) {
      return reply.code(400).send({ error: 'Missing code' });
    }
    try {
      const result = await exchangeDiscordCode(opts.env, body.code);
      return {
        access_token: result.access_token,
        token_type: result.token_type,
        expires_in: result.expires_in,
        user: {
          id: result.user.id,
          username: result.user.username,
          global_name: result.user.global_name,
          avatar: result.user.avatar,
        },
      };
    } catch (err) {
      if (err instanceof DiscordAuthError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get('/api/me', async (req) => {
    const [personal, emergencyStopShockerIds, commandQueueEnabled] = await Promise.all([
      getPersonalActivityLimits(req.discordUser.id),
      getEmergencyStopShockerIds(req.discordUser.id),
      getCommandQueueEnabled(req.discordUser.id),
    ]);

    let pishockUsername: string | null = req.pishockCreds?.username ?? null;
    let pishockAvatarUrl: string | null = null;
    let pishockBannerUrl: string | null = null;

    if (req.pishockCreds) {
      const cacheKey = `${req.discordUser.id}:${req.pishockCreds.token.slice(0, 12)}`;
      const hit = profileCache.get(cacheKey);
      if (hit && Date.now() - hit.at < PROFILE_CACHE_TTL_MS) {
        pishockUsername = hit.username ?? pishockUsername;
        pishockAvatarUrl = hit.avatarUrl;
        pishockBannerUrl = hit.bannerUrl;
      } else {
        try {
          const profile = await softApiKeyProfile(req.pishockCreds.token, req.pishockCreds.userId);
          if (profile) {
            pishockUsername = profile.username || pishockUsername;
            pishockAvatarUrl = profile.avatarUrl;
            pishockBannerUrl = profile.bannerUrl;
            profileCache.set(cacheKey, {
              at: Date.now(),
              username: pishockUsername,
              avatarUrl: pishockAvatarUrl,
              bannerUrl: pishockBannerUrl,
            });
          }
        } catch {
          // API key may not be allowed to read Images — omit avatar/banner.
        }
      }
    }

    return {
      user: {
        id: req.discordUser.id,
        username: req.discordUser.username,
        global_name: req.discordUser.global_name,
        avatar: req.discordUser.avatar,
      },
      consent: req.hasConsent,
      consentVersion: SAFETY_ACK_VERSION,
      safetyItems: SAFETY_ACK_ITEMS,
      pishockLinked: Boolean(req.pishockCreds),
      pishockUserId: req.pishockCreds?.userId ?? null,
      pishockUsername,
      pishockAvatarUrl,
      pishockBannerUrl,
      personal,
      emergencyStopShockerIds,
      commandQueueEnabled,
    };
  });

  app.post('/api/consent', async (req, reply) => {
    const check = validateConsentAcknowledgements(req.body);
    if (!check.ok) {
      return reply.code(400).send({ error: check.error, code: 'CONSENT_INVALID' });
    }
    await setConsent(req.discordUser.id);
    return { ok: true, consent: true, version: SAFETY_ACK_VERSION };
  });

  app.delete('/api/consent', async (req) => {
    await clearConsent(req.discordUser.id);
    return { ok: true, consent: false };
  });
};
