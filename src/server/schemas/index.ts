import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Request-body validation.
 *
 * Schemas are deliberately NOT strict: unknown keys are stripped (not rejected) so older
 * clients that still send retired fields keep working. Safety limits are enforced later by
 * `operate-policy` — these schemas only guarantee the *shape and type* of what reaches it.
 */

const idLike = z.union([z.number().finite(), z.string().max(64)]);
const shortString = (max = 256) => z.string().max(max);

/** Parse `req.body`; on failure replies 400 and returns null (caller must `return reply`). */
export function parseBody<S extends z.ZodType>(
  schema: S,
  req: FastifyRequest,
  reply: FastifyReply,
): z.infer<S> | null {
  const result = schema.safeParse(req.body ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  void reply.code(400).send({
    error: issue?.message?.startsWith('Invalid input') ? `${path}${issue.message}` : (issue?.message ?? 'Invalid request body'),
    code: 'INVALID_BODY',
  });
  return null;
}

// ---- auth -------------------------------------------------------------------------------

export const discordAuthBody = z.object({
  code: z.string({ error: 'Missing code' }).min(1, 'Missing code').max(2048),
});

// ---- queue ------------------------------------------------------------------------------

export const queueSettingsBody = z.object({
  enabled: z.boolean().optional(),
  progressMs: z.number().finite().optional(),
  maxPerSender: z.number().finite().optional(),
  starOnly: z.boolean().optional(),
});
export const queueEnabledBody = z.object({
  enabled: z.boolean({ error: 'enabled boolean required' }),
});
export const queueProgressBody = z.object({
  progressMs: z.number({ error: 'progressMs number required' }).finite('progressMs number required'),
});
export const queuePausedBody = z.object({
  paused: z.boolean({ error: 'paused boolean required' }),
});
export const queueHaltedBody = z.object({
  halted: z.boolean({ error: 'halted boolean required' }),
});
export const queueStarBody = z.object({
  starred: z.boolean({ error: 'starred boolean required' }),
});

// ---- operate / control ------------------------------------------------------------------

export const operationEnum = z.enum(['shock', 'vibrate', 'beep', 'hold', 'warning', 'stop', 'end'], {
  error: 'Invalid operation',
});

const locationHint = z
  .object({
    guildId: shortString(64).nullish(),
    channelId: shortString(64).nullish(),
    locationKind: shortString(64).nullish(),
    locationName: shortString(256).nullish(),
    locationIconUrl: shortString(1024).nullish(),
  })
  .nullish();

export const emergencyStopBody = z.object({
  shockerId: idLike.optional(),
  shockerIds: z.array(idLike).max(100).optional(),
  engaged: z.boolean({ error: 'engaged boolean required' }),
  clientId: idLike.nullish(),
});

export const operateBody = z.object({
  shockerId: z.number().finite().optional(),
  shareCode: shortString(128)
    .nullish()
    .transform((v) => v ?? undefined),
  operation: operationEnum.optional(),
  intensity: z.number().finite().optional(),
  durationMs: z.number().finite().optional(),
  clientId: idLike.nullish(),
  hold: z.boolean().optional(),
  // Client sends { Active, Intensity?, DurationMs?, Min?, Max? }; only `Active` is read here.
  warning: z
    .object({
      Active: z.boolean(),
      Intensity: z.number().finite().optional(),
      DurationMs: z.number().finite().optional(),
      Min: z.number().finite().optional(),
      Max: z.number().finite().optional(),
    })
    .nullish(),
  warningLevel: shortString(16).optional(),
  instanceId: shortString(256).optional(),
  locationHint,
});

export const participantOperateBody = z.object({
  instanceId: shortString(256).optional(),
  locationHint,
  shockerId: z.number().finite().optional(),
  operation: operationEnum.optional(),
  intensity: z.number().finite().optional(),
  durationMs: z.number().finite().optional(),
  hold: z.boolean().optional(),
  // The same client `input` is sent to both operate routes, so `warning` may be the
  // object form here too; the route only reads it via Boolean(body.warning).
  warning: z.union([z.boolean(), z.record(z.string(), z.unknown())]).nullish(),
  warningLevel: shortString(16).optional(),
  clientId: idLike.nullish(),
});

export const pauseBody = z.object({
  shareId: z.number({ error: 'shareId required' }).finite('shareId required'),
  pauseState: z.boolean().nullish(),
});

export const claimShareBody = z.object({
  code: shortString(128).optional(),
  ShareCode: shortString(128).optional(),
  Shares: z.array(shortString(128)).max(50).optional(),
});

/** Passed through to PiShock; only guarantee it is a plain JSON object. */
export const createShareBody = z.record(z.string(), z.unknown());

// ---- participants / activity share -------------------------------------------------------

export const participantsStatusBody = z.object({
  discordUserIds: z.array(z.union([z.string().max(64), z.number()])).max(500).optional(),
  instanceId: shortString(256).optional(),
});

const looseObject = z.record(z.string(), z.unknown());
const bannedIds = z.array(z.string().max(64)).max(1000).optional();

export const activityShareSaveBody = z.object({
  personal: z
    .object({
      activityMinIntensity: z.number().finite().optional(),
      activityMaxIntensity: z.number().finite().optional(),
      activityMinDurationMs: z.number().finite().optional(),
      activityMaxDurationMs: z.number().finite().optional(),
    })
    .optional(),
  shares: z.array(looseObject).max(500).optional(),
  bannedDiscordUserIds: bannedIds,
});

export const activityShareReplaceBody = z.object({
  shares: z.array(looseObject).max(500).optional(),
  bannedDiscordUserIds: bannedIds,
});
