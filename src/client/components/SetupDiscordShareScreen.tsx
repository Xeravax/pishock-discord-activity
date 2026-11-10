import { useEffect, useMemo, useState } from 'react';
import { AppVersionBadge } from './AppVersionBadge';
import type { ShockerView } from './ShockerCard';
import type { ActivityShareConfig } from './AvailabilitySettings';

type Props = {
  shockers: ShockerView[];
  busy?: boolean;
  error?: string | null;
  onSave: (shares: ActivityShareConfig[]) => void | Promise<void>;
  onSkip: () => void;
};

function toShare(s: ShockerView): ActivityShareConfig {
  const deviceMaxI = Math.min(100, s.deviceMaxIntensity ?? s.maxIntensity ?? 100);
  const deviceMaxD = Math.min(15_000, s.deviceMaxDuration ?? s.maxDuration ?? 15_000);
  return {
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
  };
}

/** Post-link setup: pick which owned shockers join Discord Shockers. */
export function SetupDiscordShareScreen({ shockers, busy, error, onSave, onSkip }: Props) {
  const owned = useMemo(() => shockers.filter((s) => s.owned), [shockers]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded || owned.length === 0) return;
    setSelected(new Set(owned.map((s) => s.id)));
    setSeeded(true);
  }, [owned, seeded]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(owned.map((s) => s.id)));
  const selectNone = () => setSelected(new Set());

  const submit = () => {
    const shares = owned.filter((s) => selected.has(s.id)).map(toShare);
    void onSave(shares);
  };

  return (
    <div className="auth-boot" role="dialog" aria-modal="true" aria-labelledby="setup-share-title">
      <div className="auth-boot__glow" aria-hidden />
      <div className="auth-boot__panel auth-boot__panel--wide">
        <div className="auth-boot__mark" aria-hidden>
          <i className="q-icon mdi mdi-account-group auth-boot__bolt" />
        </div>
        <h1 className="auth-boot__brand auth-boot__brand-stack">
          <span className="auth-boot__brand-name">
            Pi<span>Shock</span>
          </span>
          <AppVersionBadge />
        </h1>
        <p className="auth-boot__sub">Setup</p>

        <h2 id="setup-share-title" className="auth-boot__heading">
          Which shockers for Discord?
        </h2>
        <p className="auth-boot__hint">
          Pick devices others in this activity can control. You can change this later under Available
          in Discord.
        </p>

        {error ? (
          <div className="auth-boot__error">
            <div className="auth-boot__error-title">Couldn’t save</div>
            <p>{error}</p>
          </div>
        ) : null}

        {owned.length === 0 ? (
          <p className="auth-boot__hint">No owned shockers loaded yet — you can set this up later.</p>
        ) : (
          <>
            <div className="auth-boot__chip-row">
              <button type="button" className="auth-boot__chip" onClick={selectAll} disabled={busy}>
                All
              </button>
              <button type="button" className="auth-boot__chip" onClick={selectNone} disabled={busy}>
                None
              </button>
            </div>
            <div className="auth-boot__shocker-list">
              {owned.map((s) => {
                const on = selected.has(s.id);
                return (
                  <label
                    key={s.id}
                    className={`auth-boot__shocker${on ? ' is-on' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="auth-boot__shocker-copy">
                      <span className="auth-boot__shocker-name">{s.name}</span>
                      {s.hubName ? (
                        <span className="auth-boot__shocker-hub">{s.hubName}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        <div className="auth-boot__actions">
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline text-grey-4 bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
            disabled={busy}
            onClick={onSkip}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">Skip for now</span>
              </span>
            </span>
          </button>
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
            disabled={busy || owned.length === 0}
            onClick={submit}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row no-wrap">
                {busy ? <i className="q-icon on-left mdi mdi-loading mdi-spin" aria-hidden /> : null}
                <span className="block">
                  {busy
                    ? 'Saving…'
                    : selected.size === 0
                      ? 'Continue with none'
                      : `Share ${selected.size}`}
                </span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
