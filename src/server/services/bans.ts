import { prisma } from '../db.js';

export async function listActivityBans(ownerDiscordUserId: string) {
  return prisma.activityBan.findMany({
    where: { ownerDiscordUserId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function replaceActivityBans(
  ownerDiscordUserId: string,
  bannedDiscordUserIds: string[],
) {
  const unique = [...new Set(bannedDiscordUserIds.filter(Boolean))];
  await prisma.$transaction(async (tx) => {
    await tx.activityBan.deleteMany({ where: { ownerDiscordUserId } });
    if (unique.length === 0) return;
    // Ensure banned users exist as DiscordUser rows (minimal stub)
    for (const id of unique) {
      await tx.discordUser.upsert({
        where: { id },
        create: { id },
        update: {},
      });
    }
    await tx.activityBan.createMany({
      data: unique.map((bannedDiscordUserId) => ({
        ownerDiscordUserId,
        bannedDiscordUserId,
      })),
    });
  });
  return listActivityBans(ownerDiscordUserId);
}

export async function isExecutorBanned(ownerDiscordUserId: string, executorDiscordUserId: string) {
  const row = await prisma.activityBan.findUnique({
    where: {
      ownerDiscordUserId_bannedDiscordUserId: {
        ownerDiscordUserId,
        bannedDiscordUserId: executorDiscordUserId,
      },
    },
  });
  return Boolean(row);
}

/** Add or remove a single ban without touching the rest of the owner's list. */
export async function setActivityBan(
  ownerDiscordUserId: string,
  bannedDiscordUserId: string,
  banned: boolean,
) {
  const key = { ownerDiscordUserId_bannedDiscordUserId: { ownerDiscordUserId, bannedDiscordUserId } };
  if (banned) {
    await prisma.$transaction(async (tx) => {
      await tx.discordUser.upsert({
        where: { id: bannedDiscordUserId },
        create: { id: bannedDiscordUserId },
        update: {},
      });
      await tx.activityBan.upsert({
        where: key,
        create: { ownerDiscordUserId, bannedDiscordUserId },
        update: {},
      });
    });
  } else {
    await prisma.activityBan.deleteMany({ where: { ownerDiscordUserId, bannedDiscordUserId } });
  }
  return listActivityBans(ownerDiscordUserId);
}
