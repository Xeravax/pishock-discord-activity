import { createHash } from 'node:crypto';
import { AGENT_NAME } from '../../shared/constants.js';
import { prisma } from '../db.js';

type BrokerLogEvent = {
  clientId: string;
  payload: unknown;
  at: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Unwrap broker `-log` frames into the command body (`id`/`m`/`i`/`d`/`l`). */
export function extractBrokerLogBody(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;

  const candidates: unknown[] = [
    root.Body,
    root.body,
    root.Payload,
    root.payload,
    root.data,
    root,
  ];

  for (const candidate of candidates) {
    let value = candidate;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value) as unknown;
      } catch {
        continue;
      }
    }
    const row = asRecord(value);
    if (!row) continue;
    if (row.m != null || row.Mode != null || row.mode != null || row.id != null || row.Id != null) {
      return row;
    }
    // Nested one more level (some frames wrap Body again)
    for (const nestedKey of ['Body', 'body', 'Payload', 'payload']) {
      let nested: unknown = row[nestedKey];
      if (typeof nested === 'string') {
        try {
          nested = JSON.parse(nested) as unknown;
        } catch {
          continue;
        }
      }
      const nestedRow = asRecord(nested);
      if (
        nestedRow &&
        (nestedRow.m != null || nestedRow.id != null || nestedRow.Mode != null)
      ) {
        return nestedRow;
      }
    }
  }
  return null;
}

function normalizeAction(raw: unknown): string | null {
  const a = String(raw ?? '').toLowerCase();
  if (!a) return null;
  if (a === 'e' || a.includes('end') || a.includes('stop')) return null;
  if (a.includes('vib') || a === 'v' || a === '1') return 'vibrate';
  if (a.includes('beep') || a === 'b' || a === '2') return 'beep';
  if (a.includes('shock') || a === 's' || a === '0' || a.includes('hold')) return 'shock';
  return 'shock';
}

function isDiscordAppAgent(agent: string | null): boolean {
  if (!agent) return false;
  const a = agent.toLowerCase();
  return a.includes('discord pishock activity') || a.includes('discord ·') || a === AGENT_NAME.toLowerCase();
}

function pickOrigin(body: Record<string, unknown>): string {
  const meta = asRecord(body.l) ?? asRecord(body.L) ?? asRecord(body.log) ?? null;
  const fromMeta = meta
    ? String(meta.o ?? meta.O ?? meta.origin ?? meta.Origin ?? meta.Name ?? meta.name ?? '').trim()
    : '';
  if (fromMeta) return fromMeta;
  const top = String(body.o ?? body.origin ?? body.Origin ?? body.Name ?? body.name ?? '').trim();
  return top || 'Website';
}

/**
 * Persist a live broker `-log` frame into CommandLog (source=website).
 * Skips our own Discord Activity origin so we do not double-count.
 */
export async function ingestBrokerDeviceLog(
  ownerDiscordUserId: string,
  event: BrokerLogEvent,
): Promise<boolean> {
  const body = extractBrokerLogBody(event.payload);
  if (!body) return false;

  const action = normalizeAction(body.m ?? body.Mode ?? body.mode ?? body.Op ?? body.op);
  if (!action) return false;

  const agent = pickOrigin(body);
  if (isDiscordAppAgent(agent)) return false;

  const intensityRaw = Number(body.i ?? body.Intensity ?? body.intensity);
  const durationRaw = Number(body.d ?? body.Duration ?? body.durationMs ?? body.DurationMs);
  const shockerRaw = Number(body.id ?? body.Id ?? body.ShockerId ?? body.shockerId);

  const intensity = Number.isFinite(intensityRaw) ? Math.round(intensityRaw) : null;
  const durationMs = Number.isFinite(durationRaw) ? Math.round(durationRaw) : null;
  const shockerId =
    Number.isFinite(shockerRaw) && shockerRaw > 0 ? Math.round(shockerRaw) : null;
  const named = body.shockerName ?? body.ShockerName;
  const explicitName = typeof named === 'string' && named.trim() ? named.trim().slice(0, 120) : null;
  const hubNamed = body.hubName ?? body.HubName ?? body.clientName ?? body.ClientName;
  const explicitHubName =
    typeof hubNamed === 'string' && hubNamed.trim() ? hubNamed.trim().slice(0, 120) : null;
  const hubClientId =
    event.clientId != null && String(event.clientId).trim()
      ? String(event.clientId).trim()
      : null;
  let shareName: string | null = null;
  let shareHubName: string | null = null;
  let shareHubClientId: string | null = null;
  if (shockerId != null && (!explicitName || !explicitHubName || !hubClientId)) {
    const share = await prisma.activityShare.findUnique({
      where: {
        discordUserId_shockerId: { discordUserId: ownerDiscordUserId, shockerId },
      },
      select: { shockerName: true, hubName: true, hubClientId: true },
    });
    const trimmed = share?.shockerName?.trim();
    shareName = trimmed ? trimmed.slice(0, 120) : null;
    const hubTrimmed = share?.hubName?.trim();
    shareHubName = hubTrimmed ? hubTrimmed.slice(0, 120) : null;
    shareHubClientId = share?.hubClientId ? String(share.hubClientId).trim() || null : null;
  }
  const shockerName = explicitName ?? shareName;
  const hubName = explicitHubName ?? shareHubName;
  const resolvedHubClientId = hubClientId ?? shareHubClientId;

  const at = new Date(Number.isFinite(event.at) ? event.at : Date.now());
  const fingerprint = createHash('sha1')
    .update(
      JSON.stringify({
        owner: ownerDiscordUserId,
        clientId: event.clientId,
        at: at.toISOString(),
        action,
        agent,
        intensity,
        durationMs,
        shockerId,
        body,
      }),
    )
    .digest('hex')
    .slice(0, 24);
  const externalLogKey = `broker:${ownerDiscordUserId}:${fingerprint}`;

  try {
    await prisma.commandLog.create({
      data: {
        discordUserId: ownerDiscordUserId,
        executorDiscordUserId: null,
        targetDiscordUserId: ownerDiscordUserId,
        executorLabel: agent.slice(0, 80),
        action,
        shockerId,
        shockerName,
        hubClientId: resolvedHubClientId,
        hubName,
        intensity,
        durationMs,
        success: true,
        source: 'website',
        externalLogKey,
        createdAt: at,
        detail: JSON.stringify({
          via: 'broker_log',
          clientId: event.clientId,
          agent,
        }),
      },
    });
    return true;
  } catch {
    // unique externalLogKey → already ingested
    return false;
  }
}
