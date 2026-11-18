import { apiFetch } from './api';
import type { AppNotice } from './realtime';

export type AdminOverview = {
  users: number;
  consented: number;
  pishockLinked: number;
  sharing: number;
  activeBans: number;
  commands24h: Record<string, number>;
  adminBypasses7d: number;
  emergencyStopsEngaged: number;
  pendingDeletions: number;
  live: { sockets: number; users: number; instances: number };
  version: string;
  uptimeMs: number;
  admins: Array<{ id: string; name: string }>;
  notice: AppNotice | null;
};

export type AdminUserRow = {
  id: string;
  username: string | null;
  globalName: string | null;
  avatar: string | null;
  lastSeenAt: string | null;
  banned: boolean;
  online: boolean;
  isAdmin: boolean;
};

export type AdminBanEntry = {
  id: string;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
  bannedBy: string;
  liftedAt: string | null;
  liftedBy: string | null;
  liftReason: string | null;
};

export type AdminProfile = {
  id: string;
  username: string | null;
  globalName: string | null;
  avatar: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
  isAdmin: boolean;
  consented: boolean;
  pishockLinked: boolean;
  shares: { total: number; enabled: number; paused: number };
  features: Record<string, boolean>;
  emergencyStopEngaged: boolean;
  stats: {
    windowDays: number;
    sent: Record<string, number>;
    received: Record<string, number>;
    adminBypassesReceived: number;
  };
  blockedByCount: number;
  blocksSetCount: number;
  deletionPending: boolean;
  bans: AdminBanEntry[];
};

export type AdminBanListEntry = AdminBanEntry & { discordUserId: string };

export type AdminAuditEntry = {
  id: string;
  adminDiscordUserId: string;
  action: string;
  targetDiscordUserId: string | null;
  detail: unknown;
  createdAt: string;
};

export const BAN_LENGTHS: Array<{ days: number | null; label: string }> = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: null, label: 'Permanent' },
];

export const adminApi = {
  overview: (token: string) => apiFetch<AdminOverview>('/admin/overview', token),
  users: (token: string, q: string) =>
    apiFetch<{ users: AdminUserRow[] }>(`/admin/users?q=${encodeURIComponent(q)}`, token),
  profile: (token: string, id: string) =>
    apiFetch<{ profile: AdminProfile; names: Record<string, string> }>(
      `/admin/users/${encodeURIComponent(id)}`,
      token,
    ),
  ban: (token: string, id: string, reason: string, durationDays: number | null) =>
    apiFetch<{ ok: true; banId: string; pausedShares: number }>(
      `/admin/users/${encodeURIComponent(id)}/ban`,
      token,
      { method: 'POST', body: JSON.stringify({ reason, durationDays }) },
    ),
  unban: (token: string, id: string, reason: string) =>
    apiFetch<{ ok: true }>(`/admin/users/${encodeURIComponent(id)}/unban`, token, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  bans: (token: string, all: boolean) =>
    apiFetch<{ bans: AdminBanListEntry[]; names: Record<string, string> }>(
      `/admin/bans${all ? '?all=1' : ''}`,
      token,
    ),
  audit: (token: string) =>
    apiFetch<{ entries: AdminAuditEntry[]; names: Record<string, string> }>('/admin/audit', token),
  setNotice: (token: string, notice: { text: string; level: 'info' | 'warning'; expiresInHours: number | null } | null) =>
    apiFetch<{ ok: true; notice: AppNotice | null }>('/admin/notice', token, {
      method: 'PUT',
      body: JSON.stringify(notice ?? { text: '' }),
    }),
};

export function describeBanLength(expiresAt: string | null): string {
  if (!expiresAt) return 'Permanent';
  return `Until ${new Date(expiresAt).toLocaleString()}`;
}
