import { useEffect, useState } from 'react';
import type { ShockerView } from './ShockerCard';
import type { DiscordParticipant } from '../participants';
import {
  LimitSlider,
  formatDurationMs,
  formatIntensityPct,
} from './LimitSlider';

export type ActivityShareConfig = {
  shockerId: number;
  shockerName: string;
  hubClientId?: string | null;
  enabled: boolean;
  paused: boolean;
  deviceMaxIntensity?: number;
  deviceMaxDurationMs?: number;
  maxIntensity: number;
  maxDurationMs: number;
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
};

type Props = {
  ownedShockers: ShockerView[];
  participants: DiscordParticipant[];
  currentUserId: string;
  busy?: boolean;
  onLoad: () => Promise<{
    shares: ActivityShareConfig[];
    bannedDiscordUserIds: string[];
    available: boolean;
  }>;
  onSave: (payload: {
    shares: ActivityShareConfig[];
    bannedDiscordUserIds: string[];
  }) => Promise<void>;
};

export function AvailabilitySettings({
  ownedShockers,
  participants,
  currentUserId,
  busy,
  onLoad,
  onSave,
}: Props) {
  const [shares, setShares] = useState<ActivityShareConfig[]>([]);
  const [banned, setBanned] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await onLoad();
        if (cancelled) return;
        setShares(data.shares);
        setBanned(data.bannedDiscordUserIds);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onLoad]);

  const selectedIds = new Set(shares.map((s) => s.shockerId));

  const toggleShocker = (s: ShockerView) => {
    if (selectedIds.has(s.id)) {
      setShares((prev) => prev.filter((x) => x.shockerId !== s.id));
      return;
    }
    const deviceMaxI = Math.min(100, s.deviceMaxIntensity ?? s.maxIntensity ?? 100);
    const deviceMaxD = Math.min(15_000, s.deviceMaxDuration ?? s.maxDuration ?? 15_000);
    setShares((prev) => [
      ...prev,
      {
        shockerId: s.id,
        shockerName: s.name,
        hubClientId: s.clientId != null ? String(s.clientId) : null,
        enabled: true,
        paused: false,
        deviceMaxIntensity: deviceMaxI,
        deviceMaxDurationMs: deviceMaxD,
        maxIntensity: Math.min(deviceMaxI, s.activityMaxIntensity ?? s.maxIntensity ?? deviceMaxI),
        maxDurationMs: Math.min(deviceMaxD, s.activityMaxDuration ?? s.maxDuration ?? deviceMaxD),
        canShock: s.canShock,
        canVibrate: s.canVibrate,
        canBeep: s.canBeep,
        canHold: s.canHold,
      },
    ]);
  };

  const updateShare = (shockerId: number, patch: Partial<ActivityShareConfig>) => {
    setShares((prev) => prev.map((s) => (s.shockerId === shockerId ? { ...s, ...patch } : s)));
  };

  const toggleBan = (id: string) => {
    setBanned((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ shares, bannedDiscordUserIds: banned });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <div className="text-grey-5 q-pa-md">Loading…</div>;
  }

  const others = participants.filter((p) => p.id !== currentUserId);

  return (
    <div className="column q-gutter-md">
      <div className="text-grey-5 text-body2">
        Opt shockers into Discord Shockers so people in this activity can control them. We create a
        PiShock share code when possible so shocks from linked executors go through the official
        share API; otherwise the server uses your session with an attributed agent name. Your token
        never leaves the server.
      </div>

      {error ? (
        <div className="bg-negative text-white q-pa-sm" style={{ borderRadius: 4 }}>
          {error}
        </div>
      ) : null}

      <div>
        <div className="text-secondary text-subtitle2 q-mb-sm">Your shockers</div>
        {ownedShockers.length === 0 ? (
          <div className="text-grey-5">No owned shockers loaded.</div>
        ) : (
          <div className="q-list q-list--dark">
            {ownedShockers.map((s) => {
              const cfg = shares.find((x) => x.shockerId === s.id);
              const on = Boolean(cfg);
              return (
                <div key={s.id} className="q-item q-item-type column q-pa-sm" style={{ border: '1px solid hsla(0,0%,100%,.12)', marginBottom: 8 }}>
                  <label className="row items-center no-wrap cursor-pointer">
                    <div
                      className={`q-checkbox cursor-pointer no-outline row inline no-wrap items-center q-checkbox--dark q-mr-sm ${
                        on ? 'text-secondary' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleShocker(s)}
                        style={{ width: 18, height: 18, accentColor: '#79c6db' }}
                      />
                    </div>
                    <div className="column">
                      <div className="q-item__label">{s.name}</div>
                      {s.hubName ? <div className="q-item__label q-item__label--caption text-grey-5">{s.hubName}</div> : null}
                    </div>
                  </label>
                  {cfg ? (
                    <div className="column q-gutter-sm q-mt-sm">
                      <LimitSlider
                        label="Max intensity"
                        value={cfg.maxIntensity}
                        min={1}
                        max={Math.min(100, cfg.deviceMaxIntensity ?? 100)}
                        formatValue={formatIntensityPct}
                        onChange={(maxIntensity) => updateShare(s.id, { maxIntensity })}
                      />
                      <LimitSlider
                        label="Max duration"
                        value={cfg.maxDurationMs}
                        min={16}
                        max={Math.min(15_000, cfg.deviceMaxDurationMs ?? 15_000)}
                        step={100}
                        formatValue={formatDurationMs}
                        onChange={(maxDurationMs) => updateShare(s.id, { maxDurationMs })}
                      />
                      <label className="row items-center text-caption text-grey-5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cfg.paused}
                          className="q-mr-xs"
                          style={{ accentColor: '#79c6db' }}
                          onChange={(e) => updateShare(s.id, { paused: e.target.checked })}
                        />
                        Paused
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="text-secondary text-subtitle2 q-mb-sm">Block participants</div>
        {others.length === 0 ? (
          <div className="text-grey-5">No other participants yet.</div>
        ) : (
          <div className="q-list q-list--dark">
            {others.map((p) => (
              <label key={p.id} className="q-item q-item-type row items-center no-wrap cursor-pointer q-pa-sm">
                <input
                  type="checkbox"
                  checked={banned.includes(p.id)}
                  className="q-mr-sm"
                  style={{ accentColor: '#79c6db' }}
                  onChange={() => toggleBan(p.id)}
                />
                <span className="q-item__label">{p.displayName}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="row justify-end">
        <button
          type="button"
          className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
          disabled={busy || saving}
          onClick={save}
        >
          <span className="q-btn__wrapper col row q-anchor--skip">
            <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
              <span className="block">{saving ? 'Saving…' : 'Save'}</span>
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
