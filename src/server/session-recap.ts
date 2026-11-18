/**
 * Session recap: a summary of everything done TO a wearer during one session,
 * built from their own command-log copies. Pure — easy to test.
 */

export type RecapRow = {
  action: string;
  intensity: number | null;
  durationMs: number | null;
  success: boolean;
  executorDiscordUserId: string | null;
  executorLabel: string | null;
  adminBypass: boolean;
};

export type RecapSummary = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  commands: number;
  shocks: number;
  vibrates: number;
  beeps: number;
  totalShockMs: number;
  maxShockIntensity: number;
  refused: number;
  adminBypasses: number;
  rouletteSafe: number;
  /** Most active senders first. */
  topSenders: Array<{ id: string; count: number }>;
};

function kind(action: string): 'shock' | 'vibrate' | 'beep' | 'safe' | null {
  const a = action.toLowerCase();
  if (a === 'roulette_safe') return 'safe';
  if (a.includes('vibrate') || a.includes('warning')) return 'vibrate';
  if (a.includes('beep')) return 'beep';
  if (a.includes('shock') || a.includes('hold')) return 'shock';
  return null;
}

export function buildRecap(rows: RecapRow[], startedAt: Date, endedAt: Date): RecapSummary {
  const out: RecapSummary = {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    commands: 0,
    shocks: 0,
    vibrates: 0,
    beeps: 0,
    totalShockMs: 0,
    maxShockIntensity: 0,
    refused: 0,
    adminBypasses: 0,
    rouletteSafe: 0,
    topSenders: [],
  };
  const senders = new Map<string, number>();
  for (const row of rows) {
    const k = kind(row.action);
    if (!k) continue;
    if (!row.success) {
      out.refused += 1;
      continue;
    }
    if (row.adminBypass) out.adminBypasses += 1;
    if (k === 'safe') {
      out.rouletteSafe += 1;
      continue;
    }
    out.commands += 1;
    if (k === 'shock') {
      out.shocks += 1;
      out.totalShockMs += Math.max(0, row.durationMs ?? 0);
      out.maxShockIntensity = Math.max(out.maxShockIntensity, row.intensity ?? 0);
    } else if (k === 'vibrate') {
      out.vibrates += 1;
    } else {
      out.beeps += 1;
    }
    const sender = row.executorDiscordUserId ?? (row.executorLabel ? `label:${row.executorLabel}` : null);
    if (sender) senders.set(sender, (senders.get(sender) ?? 0) + 1);
  }
  out.topSenders = [...senders.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, count]) => ({ id, count }));
  return out;
}

function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** Discord embed for the recap DM. `names` maps sender ids to display names. */
export function recapEmbed(summary: RecapSummary, names: Map<string, string>) {
  const who = summary.topSenders
    .map((s) => `${names.get(s.id) ?? (s.id.startsWith('label:') ? s.id.slice(6) : 'Someone')} ×${s.count}`)
    .join(', ');
  const lines = [
    `**${summary.commands}** command${summary.commands === 1 ? '' : 's'} over ${fmtDuration(summary.durationMs)}`,
    `⚡ ${summary.shocks} shock${summary.shocks === 1 ? '' : 's'} (${(summary.totalShockMs / 1000).toFixed(1)}s total, max ${summary.maxShockIntensity}%)`,
    `〰️ ${summary.vibrates} vibrate · 🔔 ${summary.beeps} beep`,
  ];
  if (who) lines.push(`Most active: ${who}`);
  if (summary.rouletteSafe) lines.push(`🎡 ${summary.rouletteSafe} safe roulette spin${summary.rouletteSafe === 1 ? '' : 's'}`);
  if (summary.refused) lines.push(`🛡️ ${summary.refused} refused by your safety settings`);
  if (summary.adminBypasses) lines.push(`🟥 ${summary.adminBypasses} admin bypass${summary.adminBypasses === 1 ? '' : 'es'}`);
  lines.push('', 'Full details: open the activity → Menu → My history.');
  return {
    title: 'Your PiShock session recap',
    description: lines.join('\n'),
    color: summary.adminBypasses ? 0xe53935 : 0x79c6db,
    timestamp: summary.endedAt,
  };
}
