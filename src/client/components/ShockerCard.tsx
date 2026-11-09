import { useState } from 'react';

export type ShockerView = {
  id: number;
  name: string;
  hubName?: string;
  clientId?: number | string;
  owned: boolean;
  paused?: boolean;
  shareCode?: string;
  shareId?: number;
  /** When set, operate goes through /api/participants/:id/operate */
  targetDiscordUserId?: string;
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
  canPause: boolean;
  /** Effective usable max = min(device, activity) */
  maxIntensity: number;
  maxDuration: number;
  /** PiShock device/API hard ceiling — slider red zone above this */
  deviceMaxIntensity?: number;
  deviceMaxDuration?: number;
  /** Discord Activity Limit ceiling */
  activityMaxIntensity?: number;
  activityMaxDuration?: number;
  isV3?: boolean;
  online?: boolean;
  /** Owner kill-switch latched — blocks all commands until released */
  emergencyStop?: boolean;
};

type Props = {
  shocker: ShockerView;
  busy: boolean;
  onOperate: (input: {
    shockerId: number;
    shareCode?: string;
    clientId?: number | string;
    operation: 'shock' | 'vibrate' | 'beep' | 'hold' | 'warning';
    intensity: number;
    durationMs: number;
    canShock: boolean;
    canVibrate: boolean;
    canBeep: boolean;
    canHold: boolean;
    maxIntensity: number;
    maxDuration: number;
  }) => void;
  onPauseShare?: (shareId: number) => void;
};

export function ShockerCard({ shocker, busy, onOperate, onPauseShare }: Props) {
  const [intensity, setIntensity] = useState(Math.min(25, shocker.maxIntensity || 100));
  const [durationSec, setDurationSec] = useState(
    Math.min(1, Math.max(0.3, (shocker.maxDuration || 15000) / 1000)),
  );

  const durationMs = Math.round(durationSec * 1000);
  const maxSec = Math.max(0.3, (shocker.maxDuration || 15000) / 1000);

  const fire = (operation: 'shock' | 'vibrate' | 'beep' | 'hold' | 'warning') => {
    onOperate({
      shockerId: shocker.id,
      shareCode: shocker.shareCode,
      clientId: shocker.clientId,
      operation,
      intensity,
      durationMs,
      canShock: shocker.canShock,
      canVibrate: shocker.canVibrate,
      canBeep: shocker.canBeep,
      canHold: shocker.canHold,
      maxIntensity: shocker.maxIntensity,
      maxDuration: shocker.maxDuration,
    });
  };

  return (
    <article className="shocker-card">
      <header>
        <div>
          <h3>{shocker.name}</h3>
          <div className="meta">
            {shocker.hubName ? `${shocker.hubName} · ` : ''}
            {shocker.owned ? 'Owned' : 'Shared'}
            {shocker.isV3 ? ' · V3' : ''}
            {shocker.paused ? ' · Paused' : ''}
          </div>
        </div>
        <span className="status-pill">
          <span className={`dot ${shocker.online ? 'on' : 'off'}`} />
          {shocker.online ? 'Online' : 'Offline'}
        </span>
      </header>

      <div className="slider-block">
        <label>
          <span>Intensity</span>
          <span>{intensity}</span>
        </label>
        <input
          type="range"
          min={1}
          max={shocker.maxIntensity || 100}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
        />
      </div>

      <div className="slider-block">
        <label>
          <span>Duration</span>
          <span>{durationSec.toFixed(1)}s</span>
        </label>
        <input
          type="range"
          min={0.3}
          max={maxSec}
          step={0.1}
          value={durationSec}
          onChange={(e) => setDurationSec(Number(e.target.value))}
        />
      </div>

      <div className="btn-row">
        <button className="btn danger" type="button" disabled={busy || !shocker.canShock || shocker.paused} onClick={() => fire('shock')}>
          Shock
        </button>
        <button className="btn" type="button" disabled={busy || !shocker.canVibrate || shocker.paused} onClick={() => fire('vibrate')}>
          Vibrate
        </button>
        <button className="btn secondary" type="button" disabled={busy || !shocker.canBeep || shocker.paused} onClick={() => fire('beep')}>
          Beep
        </button>
        <button className="btn accent" type="button" disabled={busy || !shocker.canHold || shocker.paused} onClick={() => fire('hold')}>
          Hold
        </button>
        <button className="btn ghost" type="button" disabled={busy || !shocker.canVibrate || shocker.paused} onClick={() => fire('warning')}>
          Warn
        </button>
        {shocker.canPause && shocker.shareId != null && onPauseShare ? (
          <button className="btn ghost" type="button" disabled={busy} onClick={() => onPauseShare(shocker.shareId!)}>
            Pause share
          </button>
        ) : null}
      </div>
    </article>
  );
}
