import { useEffect, useState } from 'react';

export type PipLastCommandInfo = {
  action: string;
  intensity?: number | null;
  durationMs?: number | null;
  targetName?: string | null;
  shockerName?: string | null;
  at: number;
  success: boolean;
};

type Props = {
  command: PipLastCommandInfo | null;
};

function formatAction(action: string): string {
  const a = action.toLowerCase();
  if (a === 'shock' || a === 'vibrate' || a === 'beep' || a === 'hold' || a === 'warning') {
    return a.toUpperCase();
  }
  return action;
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`;
}

function formatAge(at: number, now: number): string {
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

/** Compact “last command” strip for Discord PIP layout */
export function PipLastCommand({ command }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!command) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [command?.at]);

  if (!command) {
    return (
      <div className="pip-last-command pip-last-command--empty" role="status">
        <div className="pip-last-command__label">Last command</div>
        <div className="pip-last-command__body text-grey-5">Nothing sent yet</div>
      </div>
    );
  }

  const bits = [
    formatAction(command.action),
    command.intensity != null ? `${command.intensity}%` : null,
    command.durationMs != null ? formatDuration(command.durationMs) : null,
  ].filter(Boolean);

  return (
    <div
      className={`pip-last-command ${command.success ? 'pip-last-command--ok' : 'pip-last-command--bad'}`}
      role="status"
      aria-live="polite"
    >
      <div className="pip-last-command__label">
        Last command · {formatAge(command.at, now)}
      </div>
      <div className="pip-last-command__body">{bits.join(' · ')}</div>
      <div className="pip-last-command__meta text-grey-4">
        {[command.targetName, command.shockerName].filter(Boolean).join(' · ') || '—'}
      </div>
    </div>
  );
}
