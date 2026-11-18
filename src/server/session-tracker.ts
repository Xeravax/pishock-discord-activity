/**
 * Activity sessions: opened when a user's first socket connects, closed once they have
 * been away for SESSION_GAP_MS. On close a recap is stored and (if enabled) DM'd.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import type { AppEnv } from './env.js';
import { isUserOnline, onPresenceChange } from './realtime.js';
import { SESSION_GAP_MS } from './wearer-safety.js';
import { buildRecap, recapEmbed } from './session-recap.js';
import { sendDirectMessage } from './discord-dm.js';

const SWEEP_INTERVAL_MS = 5 * 60_000;

async function closeSession(env: AppEnv, sessionId: string, discordUserId: string, endedAt: Date) {
  const session = await prisma.activitySession.findUnique({ where: { id: sessionId } });
  if (!session || session.endedAt) return;
  const rows = await prisma.commandLog.findMany({
    where: {
      discordUserId,
      targetDiscordUserId: discordUserId,
      createdAt: { gte: session.startedAt, lte: endedAt },
    },
    select: {
      action: true,
      intensity: true,
      durationMs: true,
      success: true,
      executorDiscordUserId: true,
      executorLabel: true,
      adminBypass: true,
    },
  });
  const summary = buildRecap(rows, session.startedAt, endedAt);
  const user = await prisma.discordUser.findUnique({
    where: { id: discordUserId },
    select: { recapDmEnabled: true },
  });

  let dmStatus = 'disabled';
  if (summary.commands === 0 && summary.refused === 0) {
    dmStatus = 'empty';
  } else if (user?.recapDmEnabled) {
    const ids = summary.topSenders.map((s) => s.id).filter((id) => !id.startsWith('label:'));
    const people = ids.length
      ? await prisma.discordUser.findMany({
          where: { id: { in: ids } },
          select: { id: true, globalName: true, username: true },
        })
      : [];
    const names = new Map(people.map((p) => [p.id, p.globalName || p.username || 'Someone']));
    dmStatus = await sendDirectMessage(env.discordBotToken, discordUserId, {
      embeds: [recapEmbed(summary, names)],
    });
  }
  await prisma.activitySession.update({
    where: { id: sessionId },
    data: { endedAt, summary: summary as unknown as Prisma.InputJsonValue, dmStatus },
  });
}

/** Start tracking; returns a disposer. */
export function startSessionTracker(env: AppEnv): () => void {
  const closeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const onOnline = async (id: string) => {
    const pending = closeTimers.get(id);
    if (pending) {
      clearTimeout(pending);
      closeTimers.delete(id);
    }
    const open = await prisma.activitySession.findFirst({
      where: { discordUserId: id, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (open) {
      // Came back within the gap (or after a server restart): keep the same session,
      // unless they were away long enough that it should have ended.
      const user = await prisma.discordUser.findUnique({ where: { id }, select: { lastSeenAt: true } });
      const away = user?.lastSeenAt ? Date.now() - user.lastSeenAt.getTime() : 0;
      if (away < SESSION_GAP_MS) return;
      await closeSession(env, open.id, id, user?.lastSeenAt ?? new Date());
    }
    await prisma.activitySession.create({ data: { discordUserId: id } });
  };

  const onOffline = (id: string) => {
    const existing = closeTimers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      closeTimers.delete(id);
      if (isUserOnline(id)) return;
      void (async () => {
        const open = await prisma.activitySession.findFirst({
          where: { discordUserId: id, endedAt: null },
          orderBy: { startedAt: 'desc' },
        });
        if (open) await closeSession(env, open.id, id, new Date(Date.now() - SESSION_GAP_MS));
      })().catch((err) => console.warn('[sessions] close failed', err instanceof Error ? err.message : err));
    }, SESSION_GAP_MS);
    timer.unref?.();
    closeTimers.set(id, timer);
  };

  const off = onPresenceChange((change) => {
    if (change.online) {
      void onOnline(change.discordUserId).catch((err) =>
        console.warn('[sessions] open failed', err instanceof Error ? err.message : err),
      );
    } else {
      onOffline(change.discordUserId);
    }
  });

  /** After a restart there are no timers: close sessions of users who are gone. */
  const sweep = async () => {
    const open = await prisma.activitySession.findMany({
      where: { endedAt: null },
      select: { id: true, discordUserId: true, discordUser: { select: { lastSeenAt: true } } },
    });
    for (const s of open) {
      if (isUserOnline(s.discordUserId) || closeTimers.has(s.discordUserId)) continue;
      const last = s.discordUser.lastSeenAt;
      if (last && Date.now() - last.getTime() < SESSION_GAP_MS) continue;
      await closeSession(env, s.id, s.discordUserId, last ?? new Date());
    }
  };
  const sweepTimer = setInterval(() => {
    void sweep().catch((err) => console.warn('[sessions] sweep failed', err instanceof Error ? err.message : err));
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();

  return () => {
    off();
    clearInterval(sweepTimer);
    for (const t of closeTimers.values()) clearTimeout(t);
    closeTimers.clear();
  };
}
