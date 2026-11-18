import { prisma } from '../db.js';

/** App-wide notice set from the admin panel, shown to everyone in the activity. */
export type AppNotice = {
  text: string;
  level: 'info' | 'warning';
  expiresAt: string | null;
  updatedAt: string;
};

const NOTICE_KEY = 'notice';
export const NOTICE_MAX = 500;

let noticeCache: { at: number; value: AppNotice | null } | null = null;
const NOTICE_TTL_MS = 30_000;

export function normalizeNotice(raw: unknown): Omit<AppNotice, 'updatedAt'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as { text?: unknown; level?: unknown; expiresInHours?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > NOTICE_MAX) return null;
  const hours = Number(body.expiresInHours);
  const expiresAt =
    Number.isFinite(hours) && hours > 0 && hours <= 24 * 90
      ? new Date(Date.now() + hours * 60 * 60_000).toISOString()
      : null;
  return { text, level: body.level === 'warning' ? 'warning' : 'info', expiresAt };
}

function readNotice(value: unknown): AppNotice | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<AppNotice>;
  if (typeof v.text !== 'string' || !v.text) return null;
  if (v.expiresAt && Date.parse(v.expiresAt) <= Date.now()) return null;
  return {
    text: v.text,
    level: v.level === 'warning' ? 'warning' : 'info',
    expiresAt: v.expiresAt ?? null,
    updatedAt: v.updatedAt ?? new Date(0).toISOString(),
  };
}

export async function getAppNotice(): Promise<AppNotice | null> {
  if (noticeCache && Date.now() - noticeCache.at < NOTICE_TTL_MS) {
    return noticeCache.value && readNotice(noticeCache.value);
  }
  const row = await prisma.appSetting.findUnique({ where: { key: NOTICE_KEY } });
  const value = readNotice(row?.value);
  noticeCache = { at: Date.now(), value };
  return value;
}

export async function setAppNotice(
  notice: Omit<AppNotice, 'updatedAt'> | null,
  updatedByDiscordUserId: string,
): Promise<AppNotice | null> {
  if (!notice) {
    await prisma.appSetting.deleteMany({ where: { key: NOTICE_KEY } });
    noticeCache = { at: Date.now(), value: null };
    return null;
  }
  const value: AppNotice = { ...notice, updatedAt: new Date().toISOString() };
  await prisma.appSetting.upsert({
    where: { key: NOTICE_KEY },
    create: { key: NOTICE_KEY, value, updatedByDiscordUserId },
    update: { value, updatedByDiscordUserId },
  });
  noticeCache = { at: Date.now(), value };
  return value;
}
