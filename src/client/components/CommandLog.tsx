type LogRow = {
  id: string;
  action: string;
  shockerId?: number | null;
  intensity?: number | null;
  durationMs?: number | null;
  success: boolean;
  detail?: string | null;
  createdAt: string;
  executorDiscordUserId?: string | null;
  targetDiscordUserId?: string | null;
};

type Props = {
  rows: LogRow[];
};

function formatDetail(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    const bits = [
      parsed.via != null ? `via=${parsed.via}` : null,
      parsed.path != null ? `path=${parsed.path}` : null,
      parsed.agent != null ? `agent=${parsed.agent}` : null,
      parsed.error != null ? `error=${parsed.error}` : null,
      parsed.note != null ? String(parsed.note) : null,
    ].filter(Boolean);
    return bits.length ? bits.join(' · ') : detail;
  } catch {
    return detail;
  }
}

export function CommandLog({ rows }: Props) {
  return (
    <div className="q-list q-list--dark q-list--separator">
      {rows.length === 0 ? <div className="text-grey-5 q-pa-sm">No commands yet.</div> : null}
      {rows.map((row) => (
        <div key={row.id} className="q-item q-item-type column q-pa-sm">
          <div className={`q-item__label ${row.success ? 'text-secondary' : 'text-negative'}`}>
            {row.action}
          </div>
          <div className="q-item__label q-item__label--caption text-grey-5">
            {new Date(row.createdAt).toLocaleString()}
            {row.shockerId != null ? ` · shocker ${row.shockerId}` : ''}
            {row.intensity != null ? ` · int ${row.intensity}` : ''}
            {row.durationMs != null ? ` · ${row.durationMs}ms` : ''}
          </div>
          {row.executorDiscordUserId || row.targetDiscordUserId ? (
            <div className="q-item__label q-item__label--caption text-grey-5">
              {row.executorDiscordUserId ? `executor ${row.executorDiscordUserId}` : ''}
              {row.executorDiscordUserId && row.targetDiscordUserId ? ' → ' : ''}
              {row.targetDiscordUserId ? `target ${row.targetDiscordUserId}` : ''}
            </div>
          ) : null}
          {row.detail ? (
            <div className="q-item__label q-item__label--caption text-grey-6">{formatDetail(row.detail)}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
