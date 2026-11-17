export function formatQueueEta(waitMs: number | null | undefined): string | null {
  if (waitMs == null || !Number.isFinite(waitMs)) return null;
  if (waitMs <= 0) return 'now';
  const sec = Math.max(1, Math.round(waitMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}
