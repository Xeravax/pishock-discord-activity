import { prisma } from '../db.js';

export async function getConsent(discordUserId: string) {
  const user = await prisma.discordUser.findUnique({ where: { id: discordUserId } });
  return Boolean(user?.consentAt);
}

export async function setConsent(discordUserId: string) {
  await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { consentAt: new Date() },
  });
}

export async function clearConsent(discordUserId: string) {
  await prisma.discordUser.update({
    where: { id: discordUserId },
    data: { consentAt: null },
  });
}
