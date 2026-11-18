import { prisma } from '../db.js';
import {
  QUEUE_PROGRESS_MAX_MS,
  QUEUE_PROGRESS_MIN_MS,
  clampQueueMaxPerSender,
} from '../pishock/command-queue.js';

export type CommandQueueSettings = {
  enabled: boolean;
  progressMs: number;
  maxPerSender: number;
  starOnly: boolean;
};

const QUEUE_SETTINGS_SELECT = {
  commandQueueEnabled: true,
  commandQueueProgressMs: true,
  commandQueueMaxPerSender: true,
  favoritesOnly: true,
} as const;

function mapQueueSettings(
  user: {
    commandQueueEnabled: boolean;
    commandQueueProgressMs: number;
    commandQueueMaxPerSender: number;
    favoritesOnly: boolean;
  } | null,
): CommandQueueSettings {
  return {
    enabled: Boolean(user?.commandQueueEnabled),
    progressMs: user?.commandQueueProgressMs ?? 0,
    maxPerSender: clampQueueMaxPerSender(user?.commandQueueMaxPerSender ?? 3),
    // Same column as the global "Favorites only" extra feature.
    starOnly: Boolean(user?.favoritesOnly),
  };
}

export async function getCommandQueueSettings(
  discordUserId: string,
): Promise<CommandQueueSettings> {
  const user = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: QUEUE_SETTINGS_SELECT,
  });
  return mapQueueSettings(user);
}

export async function getCommandQueueEnabled(discordUserId: string): Promise<boolean> {
  return (await getCommandQueueSettings(discordUserId)).enabled;
}

export async function setCommandQueueEnabled(
  discordUserId: string,
  enabled: boolean,
): Promise<boolean> {
  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { commandQueueEnabled: enabled },
    select: { commandQueueEnabled: true },
  });
  return user.commandQueueEnabled;
}

export async function getCommandQueueProgressMs(discordUserId: string): Promise<number> {
  return (await getCommandQueueSettings(discordUserId)).progressMs;
}

export async function setCommandQueueProgressMs(
  discordUserId: string,
  progressMs: number,
): Promise<number> {
  const clamped = Math.max(
    QUEUE_PROGRESS_MIN_MS,
    Math.min(QUEUE_PROGRESS_MAX_MS, Math.floor(Number(progressMs) || 0)),
  );
  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { commandQueueProgressMs: clamped },
    select: { commandQueueProgressMs: true },
  });
  return user.commandQueueProgressMs;
}

export async function setCommandQueueSettings(
  discordUserId: string,
  patch: Partial<{
    enabled: boolean;
    progressMs: number;
    maxPerSender: number;
    starOnly: boolean;
  }>,
): Promise<CommandQueueSettings> {
  const data: {
    commandQueueEnabled?: boolean;
    commandQueueProgressMs?: number;
    commandQueueMaxPerSender?: number;
    favoritesOnly?: boolean;
  } = {};
  if (typeof patch.enabled === 'boolean') data.commandQueueEnabled = patch.enabled;
  if (typeof patch.progressMs === 'number' && Number.isFinite(patch.progressMs)) {
    data.commandQueueProgressMs = Math.max(
      QUEUE_PROGRESS_MIN_MS,
      Math.min(QUEUE_PROGRESS_MAX_MS, Math.floor(patch.progressMs)),
    );
  }
  if (typeof patch.maxPerSender === 'number' && Number.isFinite(patch.maxPerSender)) {
    data.commandQueueMaxPerSender = clampQueueMaxPerSender(patch.maxPerSender);
  }
  if (typeof patch.starOnly === 'boolean') data.favoritesOnly = patch.starOnly;

  if (Object.keys(data).length === 0) {
    return getCommandQueueSettings(discordUserId);
  }

  const user = await prisma.discordUser.update({
    where: { id: discordUserId },
    data,
    select: QUEUE_SETTINGS_SELECT,
  });
  return mapQueueSettings(user);
}

export async function listQueueStars(ownerDiscordUserId: string): Promise<string[]> {
  const rows = await prisma.activityQueueStar.findMany({
    where: { ownerDiscordUserId },
    select: { starredDiscordUserId: true },
  });
  return rows.map((r) => r.starredDiscordUserId);
}

export async function isQueueStarred(
  ownerDiscordUserId: string,
  starredDiscordUserId: string,
): Promise<boolean> {
  const row = await prisma.activityQueueStar.findUnique({
    where: {
      ownerDiscordUserId_starredDiscordUserId: { ownerDiscordUserId, starredDiscordUserId },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function setQueueStar(
  ownerDiscordUserId: string,
  starredDiscordUserId: string,
  starred: boolean,
): Promise<boolean> {
  if (ownerDiscordUserId === starredDiscordUserId) {
    return false;
  }
  if (starred) {
    await prisma.discordUser.upsert({
      where: { id: starredDiscordUserId },
      create: { id: starredDiscordUserId },
      update: {},
    });
    await prisma.activityQueueStar.upsert({
      where: {
        ownerDiscordUserId_starredDiscordUserId: { ownerDiscordUserId, starredDiscordUserId },
      },
      create: { ownerDiscordUserId, starredDiscordUserId },
      update: {},
    });
    return true;
  }
  await prisma.activityQueueStar.deleteMany({
    where: { ownerDiscordUserId, starredDiscordUserId },
  });
  return false;
}
