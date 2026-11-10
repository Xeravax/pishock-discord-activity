import { useEffect, useState } from 'react';
import type { ShockerView } from './ShockerCard';
import {
  LimitSlider,
  formatDurationMs,
  formatIntensityPct,
} from './LimitSlider';

export type PersonalLimits = {
  activityMaxIntensity: number;
  activityMaxDurationMs: number;
};

export type ShareLimitRow = {
  shockerId: number;
  shockerName: string;
  hubClientId?: string | null;
  enabled: boolean;
  paused: boolean;
  deviceMaxIntensity: number;
  deviceMaxDurationMs: number;
  maxIntensity: number;
  maxDurationMs: number;
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
};

type Props = {
  ownedShockers: ShockerView[];
  busy?: boolean;
  /** Highlight / scroll to this shocker when opening from the SO cog */
  focusShockerId?: number | null;
  onLoad: () => Promise<{
    personal: PersonalLimits;
    shares: ShareLimitRow[];
  }>;
  onSave: (payload: {
    personal: PersonalLimits;
    shares: ShareLimitRow[];
  }) => Promise<void>;
  onRevokeConsent?: () => Promise<void> | void;
};

export function ActivityLimitsSettings({
  ownedShockers,
  busy,
  focusShockerId = null,
  onLoad,
  onSave,
  onRevokeConsent,
}: Props) {
  const [personal, setPersonal] = useState<PersonalLimits>({
    activityMaxIntensity: 100,
    activityMaxDurationMs: 15_000,
  });
  const [shares, setShares] = useState<ShareLimitRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await onLoad();
        if (cancelled) return;
        setPersonal(data.personal);
        setShares(data.shares);
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

  useEffect(() => {
    if (!loaded || focusShockerId == null) return;
    const el = document.getElementById(`activity-limit-shocker-${focusShockerId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [loaded, focusShockerId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ personal, shares });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className="text-grey-5 q-pa-md">Loading settings…</div>;

  const shareIds = new Set(shares.map((s) => s.shockerId));

  const upsertShareFromOwned = (s: ShockerView) => {
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
        maxIntensity: Math.min(deviceMaxI, s.activityMaxIntensity ?? deviceMaxI),
        maxDurationMs: Math.min(deviceMaxD, s.activityMaxDuration ?? deviceMaxD),
        canShock: s.canShock,
        canVibrate: s.canVibrate,
        canBeep: s.canBeep,
        canHold: s.canHold,
      },
    ]);
  };

  return (
    <div className="column q-gutter-md">
      <div className="text-grey-5 text-body2">
        <strong className="text-grey-3">PiShock limits</strong> come from the device/API (red zone on
        the slider). <strong className="text-grey-3">Activity limits</strong> are a separate ceiling
        for this Discord app and must stay at or below the PiShock max.
      </div>

      {error ? (
        <div className="bg-negative text-white q-pa-sm" style={{ borderRadius: 4 }}>
          {error}
        </div>
      ) : null}

      <div>
        <div className="text-secondary text-subtitle2 q-mb-sm">Your own devices (Activity Limit)</div>
        <div className="q-item q-item-type column q-pa-sm" style={{ border: '1px solid hsla(0,0%,100%,.12)' }}>
          <div className="text-caption text-grey-5 q-mb-sm">
            Applied when you control your linked shockers in this activity.
          </div>
          <div className="column q-gutter-sm">
            <LimitSlider
              label="Max intensity"
              value={personal.activityMaxIntensity}
              min={1}
              max={100}
              formatValue={formatIntensityPct}
              onChange={(activityMaxIntensity) =>
                setPersonal((p) => ({ ...p, activityMaxIntensity }))
              }
            />
            <LimitSlider
              label="Max duration"
              value={personal.activityMaxDurationMs}
              min={16}
              max={15_000}
              step={100}
              formatValue={formatDurationMs}
              onChange={(activityMaxDurationMs) =>
                setPersonal((p) => ({ ...p, activityMaxDurationMs }))
              }
            />
          </div>
        </div>
      </div>

      <div>
        <div className="text-secondary text-subtitle2 q-mb-sm">Discord Shockers you share</div>
        {ownedShockers.length === 0 ? (
          <div className="text-grey-5">No owned shockers loaded.</div>
        ) : (
          <div className="column q-gutter-sm">
            {ownedShockers.map((s) => {
              const row = shares.find((x) => x.shockerId === s.id);
              const deviceMaxI = Math.min(100, s.deviceMaxIntensity ?? s.maxIntensity ?? 100);
              const deviceMaxD = Math.min(15_000, s.deviceMaxDuration ?? s.maxDuration ?? 15_000);
              const focused = focusShockerId === s.id;
              return (
                <div
                  key={s.id}
                  id={`activity-limit-shocker-${s.id}`}
                  className="q-item q-item-type column q-pa-sm"
                  style={{
                    border: focused
                      ? '1px solid #79c6db'
                      : '1px solid hsla(0,0%,100%,.12)',
                    boxShadow: focused ? '0 0 0 1px rgba(121,198,219,.35)' : undefined,
                  }}
                >
                  <label className="row items-center no-wrap cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(row)}
                      className="q-mr-sm"
                      style={{ accentColor: '#79c6db' }}
                      onChange={() => {
                        if (row) setShares((prev) => prev.filter((x) => x.shockerId !== s.id));
                        else upsertShareFromOwned(s);
                      }}
                    />
                    <span className="column">
                      <span className="q-item__label">{s.name}</span>
                      <span className="q-item__label q-item__label--caption text-grey-5">
                        PiShock max {deviceMaxI}% · {(deviceMaxD / 1000).toFixed(deviceMaxD % 1000 ? 1 : 0)}s
                        (red above this)
                      </span>
                    </span>
                  </label>
                  {row ? (
                    <div className="column q-gutter-sm q-mt-sm">
                      <LimitSlider
                        label="Activity max intensity"
                        value={row.maxIntensity}
                        min={1}
                        max={row.deviceMaxIntensity}
                        formatValue={formatIntensityPct}
                        onChange={(maxIntensity) =>
                          setShares((prev) =>
                            prev.map((x) => (x.shockerId === s.id ? { ...x, maxIntensity } : x)),
                          )
                        }
                      />
                      <LimitSlider
                        label="Activity max duration"
                        value={row.maxDurationMs}
                        min={16}
                        max={row.deviceMaxDurationMs}
                        step={100}
                        formatValue={formatDurationMs}
                        onChange={(maxDurationMs) =>
                          setShares((prev) =>
                            prev.map((x) =>
                              x.shockerId === s.id ? { ...x, maxDurationMs } : x,
                            ),
                          )
                        }
                      />
                      <label className="row items-center text-caption text-grey-5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.paused}
                          className="q-mr-xs"
                          style={{ accentColor: '#79c6db' }}
                          onChange={(e) =>
                            setShares((prev) =>
                              prev.map((x) =>
                                x.shockerId === s.id ? { ...x, paused: e.target.checked } : x,
                              ),
                            )
                          }
                        />
                        Paused
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {shares.some((s) => !shareIds.has(s.shockerId) === false) ? null : null}
          </div>
        )}
      </div>

      <div className="row justify-between items-center q-gutter-sm">
        {onRevokeConsent ? (
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline text-negative q-btn--flat q-btn--rectangle q-btn--actionable"
            disabled={busy || saving}
            onClick={() => {
              if (
                window.confirm(
                  'Revoke safety consent? You will need to re-acknowledge the safety warning before sending or receiving commands.',
                )
              ) {
                void onRevokeConsent();
              }
            }}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">Revoke consent</span>
              </span>
            </span>
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
          disabled={busy || saving}
          onClick={save}
        >
          <span className="q-btn__wrapper col row q-anchor--skip">
            <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
              <span className="block">{saving ? 'Saving…' : 'Save settings'}</span>
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
