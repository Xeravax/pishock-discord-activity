import { useEffect, useMemo, useState } from 'react';
import { AppVersionBadge } from './AppVersionBadge';
import type { ShockerView } from './ShockerCard';
import type { ActivityShareConfig } from './AvailabilitySettings';
import type { PersonalLimits } from './ActivityLimitsSettings';
import {
  LimitSlider,
  formatDurationMs,
  formatIntensityPct,
} from './LimitSlider';

type SetupStep = 'loading' | 'devices' | 'limits';

type Props = {
  shockers: ShockerView[];
  initialPersonal: PersonalLimits;
  /** True after post-confirm device fetch finishes (even if the list is empty). */
  devicesReady?: boolean;
  busy?: boolean;
  error?: string | null;
  onComplete: (result: {
    shares: ActivityShareConfig[];
    personal: PersonalLimits;
  }) => void | Promise<void>;
  onSkip: () => void;
};

function toShare(
  s: ShockerView,
  caps?: { maxIntensity: number; maxDurationMs: number },
): ActivityShareConfig {
  const deviceMaxI = Math.min(100, s.deviceMaxIntensity ?? s.maxIntensity ?? 100);
  const deviceMaxD = Math.min(15_000, s.deviceMaxDuration ?? s.maxDuration ?? 15_000);
  const maxIntensity = Math.min(
    deviceMaxI,
    caps?.maxIntensity ?? s.activityMaxIntensity ?? s.maxIntensity ?? deviceMaxI,
  );
  const maxDurationMs = Math.min(
    deviceMaxD,
    caps?.maxDurationMs ?? s.activityMaxDuration ?? s.maxDuration ?? deviceMaxD,
  );
  return {
    shockerId: s.id,
    shockerName: s.name,
    hubClientId: s.clientId != null ? String(s.clientId) : null,
    enabled: true,
    paused: false,
    deviceMaxIntensity: deviceMaxI,
    deviceMaxDurationMs: deviceMaxD,
    maxIntensity,
    maxDurationMs,
    canShock: s.canShock,
    canVibrate: s.canVibrate,
    canBeep: s.canBeep,
    canHold: s.canHold,
  };
}

/** Post-link setup: load devices → pick Discord shockers → set activity limits. */
export function SetupDiscordShareScreen({
  shockers,
  initialPersonal,
  devicesReady = false,
  busy,
  error,
  onComplete,
  onSkip,
}: Props) {
  const owned = useMemo(() => shockers.filter((s) => s.owned), [shockers]);
  const [step, setStep] = useState<SetupStep>('loading');
  const [stepDir, setStepDir] = useState<'forward' | 'back'>('forward');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [seeded, setSeeded] = useState(false);
  const [personal, setPersonal] = useState<PersonalLimits>(initialPersonal);
  const [shareCaps, setShareCaps] = useState<
    Record<number, { maxIntensity: number; maxDurationMs: number }>
  >({});

  useEffect(() => {
    setPersonal(initialPersonal);
  }, [initialPersonal.activityMaxIntensity, initialPersonal.activityMaxDurationMs]);

  useEffect(() => {
    if (!devicesReady) {
      setStep('loading');
      return;
    }
    if (owned.length > 0 && !seeded) {
      setSelected(new Set(owned.map((s) => s.id)));
      const caps: Record<number, { maxIntensity: number; maxDurationMs: number }> = {};
      for (const s of owned) {
        const row = toShare(s);
        caps[s.id] = { maxIntensity: row.maxIntensity, maxDurationMs: row.maxDurationMs };
      }
      setShareCaps(caps);
      setSeeded(true);
    }
    setStep((prev) => (prev === 'loading' ? 'devices' : prev));
  }, [owned, seeded, devicesReady]);

  const go = (next: SetupStep, dir: 'forward' | 'back') => {
    setStepDir(dir);
    setStep(next);
  };

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

  const selectedOwned = owned.filter((s) => selected.has(s.id));

  const submit = () => {
    const shares = selectedOwned.map((s) => toShare(s, shareCaps[s.id]));
    void onComplete({ shares, personal });
  };

  const stepIndex = step === 'limits' ? 2 : step === 'devices' ? 1 : 0;

  return (
    <div className="auth-boot" role="dialog" aria-modal="true" aria-labelledby="setup-share-title">
      <div className="auth-boot__glow" aria-hidden />
      <div className="auth-boot__panel auth-boot__panel--wide">
        <div className="auth-boot__mark" aria-hidden>
          <i
            className={`q-icon mdi auth-boot__bolt ${
              step === 'limits' ? 'mdi-tune-vertical' : 'mdi-account-group'
            }`}
          />
        </div>
        <h1 className="auth-boot__brand auth-boot__brand-row">
          <span className="auth-boot__brand-name">
            Pi<span>Shock</span>
          </span>
          <AppVersionBadge />
        </h1>
        <p className="auth-boot__sub">
          Setup{step !== 'loading' ? ` · ${stepIndex}/2` : ''}
        </p>

        <div
          key={step}
          className={`setup-flow-step setup-flow-step--${stepDir}`}
        >
          {step === 'loading' ? (
            <>
              <h2 id="setup-share-title" className="auth-boot__heading">
                Loading your devices…
              </h2>
              <p className="auth-boot__hint">
                Account linked. Waiting for your PiShock hubs and shockers before you pick what to
                share.
              </p>
              <div className="auth-boot__bar auth-boot__bar--indeterminate" aria-hidden>
                <div className="auth-boot__bar-fill" />
              </div>
              {error ? (
                <div className="auth-boot__error">
                  <div className="auth-boot__error-title">Couldn’t load devices</div>
                  <p>{error}</p>
                </div>
              ) : null}
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
              </div>
            </>
          ) : null}

          {step === 'devices' ? (
            <>
              <h2 id="setup-share-title" className="auth-boot__heading">
                Which shockers for Discord?
              </h2>
              <p className="auth-boot__hint">
                Pick devices others in this activity can control. You can change this later under
                Available in Discord.
              </p>

              {error ? (
                <div className="auth-boot__error">
                  <div className="auth-boot__error-title">Couldn’t save</div>
                  <p>{error}</p>
                </div>
              ) : null}

              {owned.length === 0 ? (
                <p className="auth-boot__hint">
                  No owned shockers came back from PiShock yet. You can still set activity limits, or
                  skip and configure devices later.
                </p>
              ) : (
                <>
                  <div className="auth-boot__chip-row">
                    <button
                      type="button"
                      className="auth-boot__chip"
                      onClick={selectAll}
                      disabled={busy}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className="auth-boot__chip"
                      onClick={selectNone}
                      disabled={busy}
                    >
                      None
                    </button>
                  </div>
                  <div className="auth-boot__shocker-list">
                    {owned.map((s) => {
                      const on = selected.has(s.id);
                      return (
                        <label key={s.id} className={`auth-boot__shocker${on ? ' is-on' : ''}`}>
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
                  disabled={busy}
                  onClick={() => go('limits', 'forward')}
                >
                  <span className="q-btn__wrapper col row q-anchor--skip">
                    <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                      <span className="block">Next: limits</span>
                    </span>
                  </span>
                </button>
              </div>
            </>
          ) : null}

          {step === 'limits' ? (
            <>
              <h2 id="setup-share-title" className="auth-boot__heading">
                Set your activity limits
              </h2>
              <p className="auth-boot__hint">
                These ceilings apply in Discord and stay at or below each device’s PiShock max. Drag
                the sliders — no typing needed.
              </p>

              {error ? (
                <div className="auth-boot__error">
                  <div className="auth-boot__error-title">Couldn’t save</div>
                  <p>{error}</p>
                </div>
              ) : null}

              <div className="setup-limits-block">
                <div className="setup-limits-block__title">Your own devices</div>
                <LimitSlider
                  label="Max intensity"
                  value={personal.activityMaxIntensity}
                  min={1}
                  max={100}
                  formatValue={formatIntensityPct}
                  disabled={busy}
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
                  disabled={busy}
                  onChange={(activityMaxDurationMs) =>
                    setPersonal((p) => ({ ...p, activityMaxDurationMs }))
                  }
                />
              </div>

              {selectedOwned.length > 0 ? (
                <div className="setup-limits-block">
                  <div className="setup-limits-block__title">Shared Discord shockers</div>
                  {selectedOwned.map((s) => {
                    const deviceMaxI = Math.min(
                      100,
                      s.deviceMaxIntensity ?? s.maxIntensity ?? 100,
                    );
                    const deviceMaxD = Math.min(
                      15_000,
                      s.deviceMaxDuration ?? s.maxDuration ?? 15_000,
                    );
                    const caps = shareCaps[s.id] ?? {
                      maxIntensity: Math.min(deviceMaxI, personal.activityMaxIntensity),
                      maxDurationMs: Math.min(deviceMaxD, personal.activityMaxDurationMs),
                    };
                    return (
                      <div key={s.id} className="setup-limits-shocker">
                        <div className="setup-limits-shocker__name">{s.name}</div>
                        <div className="setup-limits-shocker__cap">
                          PiShock max {formatIntensityPct(deviceMaxI)} · {formatDurationMs(deviceMaxD)}
                        </div>
                        <LimitSlider
                          label="Activity max intensity"
                          value={caps.maxIntensity}
                          min={1}
                          max={deviceMaxI}
                          formatValue={formatIntensityPct}
                          disabled={busy}
                          onChange={(maxIntensity) =>
                            setShareCaps((prev) => ({
                              ...prev,
                              [s.id]: { ...caps, maxIntensity },
                            }))
                          }
                        />
                        <LimitSlider
                          label="Activity max duration"
                          value={caps.maxDurationMs}
                          min={16}
                          max={deviceMaxD}
                          step={100}
                          formatValue={formatDurationMs}
                          disabled={busy}
                          onChange={(maxDurationMs) =>
                            setShareCaps((prev) => ({
                              ...prev,
                              [s.id]: { ...caps, maxDurationMs },
                            }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="auth-boot__hint">
                  No shockers selected to share — only your personal activity limits will be saved.
                </p>
              )}

              <div className="auth-boot__actions">
                <button
                  type="button"
                  className="q-btn q-btn-item non-selectable no-outline text-grey-4 bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
                  disabled={busy}
                  onClick={() => go('devices', 'back')}
                >
                  <span className="q-btn__wrapper col row q-anchor--skip">
                    <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                      <span className="block">Back</span>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
                  disabled={busy}
                  onClick={submit}
                >
                  <span className="q-btn__wrapper col row q-anchor--skip">
                    <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row no-wrap">
                      {busy ? (
                        <i className="q-icon on-left mdi mdi-loading mdi-spin" aria-hidden />
                      ) : null}
                      <span className="block">{busy ? 'Saving…' : 'Finish setup'}</span>
                    </span>
                  </span>
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
