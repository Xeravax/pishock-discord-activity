import type { FastifyPluginAsync } from 'fastify';
import { PISHOCK_ANNOUNCEMENTS_LIVE } from '../../shared/constants.js';

export type LiveAnnouncement = {
  text: string;
  link: string | null;
  expires: string | null;
};

type UpstreamAnnouncement = {
  AnnouncementText?: unknown;
  Link?: unknown;
  Expires?: unknown;
};

const CACHE_TTL_MS = 60_000;
let cache: { at: number; items: LiveAnnouncement[] } | null = null;

function normalize(raw: unknown): LiveAnnouncement[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const out: LiveAnnouncement[] = [];
  for (const row of raw as UpstreamAnnouncement[]) {
    const text = typeof row.AnnouncementText === 'string' ? row.AnnouncementText.trim() : '';
    if (!text) continue;
    const expires =
      row.Expires == null || row.Expires === ''
        ? null
        : typeof row.Expires === 'string'
          ? row.Expires
          : String(row.Expires);
    if (expires) {
      const expMs = Date.parse(expires);
      if (Number.isFinite(expMs) && expMs <= now) continue;
    }
    const link =
      typeof row.Link === 'string' && row.Link.trim() ? row.Link.trim() : null;
    out.push({ text, link, expires });
  }
  return out;
}

async function fetchLiveAnnouncements(): Promise<LiveAnnouncement[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.items;
  }
  const res = await fetch(PISHOCK_ANNOUNCEMENTS_LIVE, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`Announcements upstream ${res.status}`);
  }
  const items = normalize(await res.json());
  cache = { at: Date.now(), items };
  return items;
}

export const announcementRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/announcements', async (_req, reply) => {
    try {
      const announcements = await fetchLiveAnnouncements();
      return { announcements };
    } catch (err) {
      app.log.warn({ err }, 'Failed to fetch PiShock announcements');
      return reply.code(502).send({ error: 'Failed to load announcements', announcements: [] });
    }
  });
};
