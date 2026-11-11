import { useEffect, useState, type ReactNode } from 'react';
import type { ShockerView } from './ShockerCard';
import { ModeLimitsEditor, type ModeLimitsValue } from './ModeLimitsEditor';
import { normalizeWarningLevel, type WarningLevel } from '../../shared/warning';

function LimitsPane({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`setup-limits-pane${open ? ' is-open' : ' is-collapsed'}`}>
      <button type="button" className="setup-limits-pane__toggle" onClick={onToggle}>
        <span className="setup-limits-pane__title">{title}</span>
        <i
          className={`q-icon mdi ${open ? 'mdi-chevron-down' : 'mdi-chevron-right'}`}
          aria-hidden
        />
      </button>
      {open ? <div className="setup-limits-pane__body">{children}</div> : null}
    </section>
  );
}

export type PersonalLimits = {
  activityMinIntensity: number;
  activityMaxIntensity: number;
  activityMinDurationMs: number;
  activityMaxDurationMs: number;
  activityVibMinIntensity: number;
  activityVibMaxIntensity: number;
  activityVibMinDurationMs: number;
  activityVibMaxDurationMs: number;
  activityBeepMinIntensity: number;
  activityBeepMaxIntensity: number;
  activityBeepMinDurationMs: number;
  activityBeepMaxDurationMs: number;
  /** Client-side defaults for new shares (not stored on DiscordUser). */
  activityCanShock: boolean;
  activityCanVibrate: boolean;
  activityCanBeep: boolean;
  activityCanHold: boolean;
  activityRequiredWarningLevel: WarningLevel;
};

export type ShareLimitRow = {
  shockerId: number;
  shockerName: string;
  hubClientId?: string | null;
  hubName?: string | null;
  enabled: boolean;
  paused: boolean;
  deviceMaxIntensity: number;
  deviceMaxDurationMs: number;
  minIntensity: number;
  maxIntensity: number;
  minDurationMs: number;
  maxDurationMs: number;
  vibMinIntensity: number;
  vibMaxIntensity: number;
  vibMinDurationMs: number;
  vibMaxDurationMs: number;
  beepMinIntensity: number;
  beepMaxIntensity: number;
  beepMinDurationMs: number;
  beepMaxDurationMs: number;
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
  requiredWarningLevel: WarningLevel;
};

type Props = {
  ownedShockers: ShockerView[];
  busy?: boolean;
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

function normalizePersonal(p: Partial<PersonalLimits> | null | undefined): PersonalLimits {
  const shockMaxI = Math.max(1, Math.min(100, Number(p?.activityMaxIntensity ?? 100)));
  const shockMaxD = Math.max(16, Math.min(15_000, Number(p?.activityMaxDurationMs ?? 15_000)));
  const vibMaxI = Math.max(1, Math.min(100, Number(p?.activityVibMaxIntensity ?? shockMaxI)));
  const vibMaxD = Math.max(16, Math.min(15_000, Number(p?.activityVibMaxDurationMs ?? shockMaxD)));
  const beepMaxI = Math.max(1, Math.min(100, Number(p?.activityBeepMaxIntensity ?? shockMaxI)));
  const beepMaxD = Math.max(16, Math.min(15_000, Number(p?.activityBeepMaxDurationMs ?? shockMaxD)));
  return {
    activityMinIntensity: Math.max(1, Math.min(shockMaxI, Number(p?.activityMinIntensity ?? 1))),
    activityMaxIntensity: shockMaxI,
    activityMinDurationMs: Math.max(16, Math.min(shockMaxD, Number(p?.activityMinDurationMs ?? 16))),
    activityMaxDurationMs: shockMaxD,
    activityVibMinIntensity: Math.max(1, Math.min(vibMaxI, Number(p?.activityVibMinIntensity ?? 1))),
    activityVibMaxIntensity: vibMaxI,
    activityVibMinDurationMs: Math.max(16, Math.min(vibMaxD, Number(p?.activityVibMinDurationMs ?? 16))),
    activityVibMaxDurationMs: vibMaxD,
    activityBeepMinIntensity: Math.max(1, Math.min(beepMaxI, Number(p?.activityBeepMinIntensity ?? 1))),
    activityBeepMaxIntensity: beepMaxI,
    activityBeepMinDurationMs: Math.max(16, Math.min(beepMaxD, Number(p?.activityBeepMinDurationMs ?? 16))),
    activityBeepMaxDurationMs: beepMaxD,
    activityCanShock: p?.activityCanShock !== false,
    activityCanVibrate: p?.activityCanVibrate !== false,
    activityCanBeep: p?.activityCanBeep !== false,
    activityCanHold: p?.activityCanHold !== false,
    activityRequiredWarningLevel: normalizeWarningLevel(p?.activityRequiredWarningLevel),
  };
}

function personalToMode(p: PersonalLimits): ModeLimitsValue {
  return {
    canShock: p.activityCanShock,
    canVibrate: p.activityCanVibrate,
    canBeep: p.activityCanBeep,
    canHold: p.activityCanHold,
    shock: {
      minIntensity: p.activityMinIntensity,
      maxIntensity: p.activityMaxIntensity,
      minDurationMs: p.activityMinDurationMs,
      maxDurationMs: p.activityMaxDurationMs,
    },
    vibrate: {
      minIntensity: p.activityVibMinIntensity,
      maxIntensity: p.activityVibMaxIntensity,
      minDurationMs: p.activityVibMinDurationMs,
      maxDurationMs: p.activityVibMaxDurationMs,
    },
    beep: {
      minIntensity: p.activityBeepMinIntensity,
      maxIntensity: p.activityBeepMaxIntensity,
      minDurationMs: p.activityBeepMinDurationMs,
      maxDurationMs: p.activityBeepMaxDurationMs,
    },
    requiredWarningLevel: p.activityRequiredWarningLevel,
  };
}

function modeToPersonal(m: ModeLimitsValue, prev: PersonalLimits): PersonalLimits {
  return {
    ...prev,
    activityMinIntensity: m.shock.minIntensity,
    activityMaxIntensity: m.shock.maxIntensity,
    activityMinDurationMs: m.shock.minDurationMs,
    activityMaxDurationMs: m.shock.maxDurationMs,
    activityVibMinIntensity: m.vibrate.minIntensity,
    activityVibMaxIntensity: m.vibrate.maxIntensity,
    activityVibMinDurationMs: m.vibrate.minDurationMs,
    activityVibMaxDurationMs: m.vibrate.maxDurationMs,
    activityBeepMinIntensity: m.beep.minIntensity,
    activityBeepMaxIntensity: m.beep.maxIntensity,
    activityBeepMinDurationMs: m.beep.minDurationMs,
    activityBeepMaxDurationMs: m.beep.maxDurationMs,
    activityCanShock: m.canShock,
    activityCanVibrate: m.canVibrate,
    activityCanBeep: m.canBeep,
    activityCanHold: m.canHold,
    activityRequiredWarningLevel: m.requiredWarningLevel,
  };
}

function shareToMode(row: ShareLimitRow): ModeLimitsValue {
  return {
    canShock: row.canShock,
    canVibrate: row.canVibrate,
    canBeep: row.canBeep,
    canHold: row.canHold,
    shock: {
      minIntensity: row.minIntensity,
      maxIntensity: row.maxIntensity,
      minDurationMs: row.minDurationMs,
      maxDurationMs: row.maxDurationMs,
    },
    vibrate: {
      minIntensity: row.vibMinIntensity,
      maxIntensity: row.vibMaxIntensity,
      minDurationMs: row.vibMinDurationMs,
      maxDurationMs: row.vibMaxDurationMs,
    },
    beep: {
      minIntensity: row.beepMinIntensity,
      maxIntensity: row.beepMaxIntensity,
      minDurationMs: row.beepMinDurationMs,
      maxDurationMs: row.beepMaxDurationMs,
    },
    requiredWarningLevel: normalizeWarningLevel(row.requiredWarningLevel),
  };
}

function modeToShare(row: ShareLimitRow, m: ModeLimitsValue): ShareLimitRow {
  return {
    ...row,
    canShock: m.canShock,
    canVibrate: m.canVibrate,
    canBeep: m.canBeep,
    canHold: m.canHold,
    minIntensity: m.shock.minIntensity,
    maxIntensity: m.shock.maxIntensity,
    minDurationMs: m.shock.minDurationMs,
    maxDurationMs: m.shock.maxDurationMs,
    vibMinIntensity: m.vibrate.minIntensity,
    vibMaxIntensity: m.vibrate.maxIntensity,
    vibMinDurationMs: m.vibrate.minDurationMs,
    vibMaxDurationMs: m.vibrate.maxDurationMs,
    beepMinIntensity: m.beep.minIntensity,
    beepMaxIntensity: m.beep.maxIntensity,
    beepMinDurationMs: m.beep.minDurationMs,
    beepMaxDurationMs: m.beep.maxDurationMs,
    requiredWarningLevel: m.requiredWarningLevel,
  };
}

function normalizeShare(s: ShareLimitRow): ShareLimitRow {
  return {
    ...s,
    vibMinIntensity: s.vibMinIntensity ?? s.minIntensity ?? 1,
    vibMaxIntensity: s.vibMaxIntensity ?? s.maxIntensity ?? 100,
    vibMinDurationMs: s.vibMinDurationMs ?? s.minDurationMs ?? 16,
    vibMaxDurationMs: s.vibMaxDurationMs ?? s.maxDurationMs ?? 15_000,
    beepMinIntensity: s.beepMinIntensity ?? s.minIntensity ?? 1,
    beepMaxIntensity: s.beepMaxIntensity ?? s.maxIntensity ?? 100,
    beepMinDurationMs: s.beepMinDurationMs ?? s.minDurationMs ?? 16,
    beepMaxDurationMs: s.beepMaxDurationMs ?? s.maxDurationMs ?? 15_000,
    requiredWarningLevel: normalizeWarningLevel(s.requiredWarningLevel),
  };
}

export function ActivityLimitsSettings({
  ownedShockers,
  busy,
  focusShockerId = null,
  onLoad,
  onSave,
  onRevokeConsent,
}: Props) {
  const [personal, setPersonal] = useState<PersonalLimits>(normalizePersonal(null));
  const [shares, setShares] = useState<ShareLimitRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [personalOpen, setPersonalOpen] = useState(true);
  const [sharesOpen, setSharesOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await onLoad();
        if (cancelled) return;
        setPersonal(normalizePersonal(data.personal));
        setShares(data.shares.map(normalizeShare));
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
    document
      .getElementById(`activity-limit-shocker-${focusShockerId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  const upsertShareFromOwned = (s: ShockerView) => {
    const deviceMaxI = Math.min(100, s.deviceMaxIntensity ?? s.maxIntensity ?? 100);
    const deviceMaxD = Math.min(15_000, s.deviceMaxDuration ?? s.maxDuration ?? 15_000);
    const shockMax = Math.min(deviceMaxI, personal.activityMaxIntensity);
    const shockMaxD = Math.min(deviceMaxD, personal.activityMaxDurationMs);
    setShares((prev) => [
      ...prev,
      normalizeShare({
        shockerId: s.id,
        shockerName: s.name,
        hubClientId: s.clientId != null ? String(s.clientId) : null,
        hubName: s.hubName ?? null,
        enabled: true,
        paused: false,
        deviceMaxIntensity: deviceMaxI,
        deviceMaxDurationMs: deviceMaxD,
        minIntensity: Math.min(shockMax, personal.activityMinIntensity),
        maxIntensity: shockMax,
        minDurationMs: Math.min(shockMaxD, personal.activityMinDurationMs),
        maxDurationMs: shockMaxD,
        vibMinIntensity: Math.min(deviceMaxI, personal.activityVibMinIntensity),
        vibMaxIntensity: Math.min(deviceMaxI, personal.activityVibMaxIntensity),
        vibMinDurationMs: Math.min(deviceMaxD, personal.activityVibMinDurationMs),
        vibMaxDurationMs: Math.min(deviceMaxD, personal.activityVibMaxDurationMs),
        beepMinIntensity: Math.min(deviceMaxI, personal.activityBeepMinIntensity),
        beepMaxIntensity: Math.min(deviceMaxI, personal.activityBeepMaxIntensity),
        beepMinDurationMs: Math.min(deviceMaxD, personal.activityBeepMinDurationMs),
        beepMaxDurationMs: Math.min(deviceMaxD, personal.activityBeepMaxDurationMs),
        canShock: personal.activityCanShock && s.canShock,
        canVibrate: personal.activityCanVibrate && s.canVibrate,
        canBeep: personal.activityCanBeep && s.canBeep,
        canHold: personal.activityCanHold && s.canHold,
        requiredWarningLevel: personal.activityRequiredWarningLevel,
      }),
    ]);
  };

  return (
    <div className="activity-limits-shell">
      <div className="activity-limits-shell__intro text-grey-5 text-body2">
        Expand a section, then toggle and open each action separately. Collapse what you are not
        editing so the rest can use the space.
      </div>

      {error ? (
        <div className="bg-negative text-white q-pa-sm" style={{ borderRadius: 4 }}>
          {error}
        </div>
      ) : null}

      <div
        className={`setup-limits-split activity-limits-shell__split${
          ownedShockers.length > 0 ? '' : ' setup-limits-split--single'
        }`}
      >
        <LimitsPane
          title="Your own devices"
          open={personalOpen}
          onToggle={() => setPersonalOpen((open) => !open)}
        >
          <ModeLimitsEditor
            value={personalToMode(personal)}
            deviceMaxIntensity={100}
            deviceMaxDurationMs={15_000}
            disabled={busy || saving}
            onChange={(m) => setPersonal((p) => modeToPersonal(m, p))}
          />
        </LimitsPane>

        {ownedShockers.length > 0 ? (
          <LimitsPane
            title="Discord Shockers you share"
            open={sharesOpen}
            onToggle={() => setSharesOpen((open) => !open)}
          >
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
                      border: focused ? '1px solid #79c6db' : '1px solid hsla(0,0%,100%,.12)',
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
                          PiShock max {deviceMaxI}% ·{' '}
                          {(deviceMaxD / 1000).toFixed(deviceMaxD % 1000 ? 1 : 0)}s
                        </span>
                      </span>
                    </label>
                    {row ? (
                      <div className="column q-gutter-sm q-mt-sm">
                        <ModeLimitsEditor
                          value={shareToMode(row)}
                          deviceMaxIntensity={row.deviceMaxIntensity}
                          deviceMaxDurationMs={row.deviceMaxDurationMs}
                          disabled={busy || saving}
                          onChange={(m) =>
                            setShares((prev) =>
                              prev.map((x) => (x.shockerId === s.id ? modeToShare(x, m) : x)),
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
            </div>
          </LimitsPane>
        ) : (
          <div className="text-grey-5 setup-limits-split__empty">No owned shockers loaded.</div>
        )}
      </div>

      <div className="row justify-between items-center q-gutter-sm activity-limits-shell__footer">
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
