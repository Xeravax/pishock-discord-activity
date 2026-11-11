import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppVersionBadge } from './AppVersionBadge';
import type { ShockerView } from './ShockerCard';
import type { ActivityShareConfig } from './AvailabilitySettings';
import type { PersonalLimits } from './ActivityLimitsSettings';
import { ModeLimitsEditor, type ModeLimitsValue } from './ModeLimitsEditor';
import {
  LimitSlider,
  formatDurationMs,
} from './LimitSlider';
import { normalizeWarningLevel } from '../../shared/warning';
import type { QueuePanelSettings } from './QueuePanel';

function SetupLimitsPane({
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

type SetupStep = 'loading' | 'devices' | 'limits' | 'queue';

type Props = {
  shockers: ShockerView[];
  initialPersonal: PersonalLimits;
  /** Pre-select these shockers (e.g. currently shared) when redoing setup. */
  initialSelectedIds?: number[];
  /** True after post-confirm device fetch finishes (even if the list is empty). */
  devicesReady?: boolean;
  busy?: boolean;
  error?: string | null;
  onComplete: (result: {
    shares: ActivityShareConfig[];
    personal: PersonalLimits;
    queue?: QueuePanelSettings;
  }) => void | Promise<void>;
  onSkip: () => void;
};

const DEFAULT_QUEUE: QueuePanelSettings = {
  enabled: false,
  progressMs: 0,
  maxPerSender: 3,
  starOnly: false,
};

function personalToMode(p: PersonalLimits): ModeLimitsValue {
  return {
    canShock: p.activityCanShock !== false,
    canVibrate: p.activityCanVibrate !== false,
    canBeep: p.activityCanBeep !== false,
    canHold: p.activityCanHold !== false,
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
    requiredWarningLevel: normalizeWarningLevel(p.activityRequiredWarningLevel),
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

function defaultShareMode(s: ShockerView, personal: PersonalLimits): ModeLimitsValue {
  const deviceMaxI = Math.min(100, s.deviceMaxIntensity ?? s.maxIntensity ?? 100);
  const deviceMaxD = Math.min(15_000, s.deviceMaxDuration ?? s.maxDuration ?? 15_000);
  const shockMax = Math.min(deviceMaxI, personal.activityMaxIntensity);
  const shockMaxD = Math.min(deviceMaxD, personal.activityMaxDurationMs);
  const vibMax = Math.min(deviceMaxI, personal.activityVibMaxIntensity);
  const vibMaxD = Math.min(deviceMaxD, personal.activityVibMaxDurationMs);
  const beepMax = Math.min(deviceMaxI, personal.activityBeepMaxIntensity);
  const beepMaxD = Math.min(deviceMaxD, personal.activityBeepMaxDurationMs);
  return {
    canShock: personal.activityCanShock !== false && s.canShock,
    canVibrate: personal.activityCanVibrate !== false && s.canVibrate,
    canBeep: personal.activityCanBeep !== false && s.canBeep,
    canHold: personal.activityCanHold !== false && s.canHold,
    shock: {
      minIntensity: Math.min(shockMax, personal.activityMinIntensity),
      maxIntensity: shockMax,
      minDurationMs: Math.min(shockMaxD, personal.activityMinDurationMs),
      maxDurationMs: shockMaxD,
    },
    vibrate: {
      minIntensity: Math.min(vibMax, personal.activityVibMinIntensity),
      maxIntensity: vibMax,
      minDurationMs: Math.min(vibMaxD, personal.activityVibMinDurationMs),
      maxDurationMs: vibMaxD,
    },
    beep: {
      minIntensity: Math.min(beepMax, personal.activityBeepMinIntensity),
      maxIntensity: beepMax,
      minDurationMs: Math.min(beepMaxD, personal.activityBeepMinDurationMs),
      maxDurationMs: beepMaxD,
    },
    requiredWarningLevel: normalizeWarningLevel(personal.activityRequiredWarningLevel),
  };
}

function toShare(s: ShockerView, mode: ModeLimitsValue): ActivityShareConfig {
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
    minIntensity: mode.shock.minIntensity,
    maxIntensity: mode.shock.maxIntensity,
    minDurationMs: mode.shock.minDurationMs,
    maxDurationMs: mode.shock.maxDurationMs,
    vibMinIntensity: mode.vibrate.minIntensity,
    vibMaxIntensity: mode.vibrate.maxIntensity,
    vibMinDurationMs: mode.vibrate.minDurationMs,
    vibMaxDurationMs: mode.vibrate.maxDurationMs,
    beepMinIntensity: mode.beep.minIntensity,
    beepMaxIntensity: mode.beep.maxIntensity,
    beepMinDurationMs: mode.beep.minDurationMs,
    beepMaxDurationMs: mode.beep.maxDurationMs,
    canShock: mode.canShock,
    canVibrate: mode.canVibrate,
    canBeep: mode.canBeep,
    canHold: mode.canHold,
    requiredWarningLevel: mode.requiredWarningLevel,
  };
}

/** Post-link setup: load devices → pick Discord shockers → set activity limits. */
export function SetupDiscordShareScreen({
  shockers,
  initialPersonal,
  initialSelectedIds,
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
  const [shareModes, setShareModes] = useState<Record<number, ModeLimitsValue>>({});
  const [queue, setQueue] = useState<QueuePanelSettings>(DEFAULT_QUEUE);
  const [defaultsOpen, setDefaultsOpen] = useState(true);
  const [sharesOpen, setSharesOpen] = useState(true);

  useEffect(() => {
    setPersonal(initialPersonal);
  }, [initialPersonal]);

  useEffect(() => {
    if (!devicesReady) {
      setStep('loading');
      return;
    }
    if (owned.length > 0 && !seeded) {
      const preferred = (initialSelectedIds ?? []).filter((id) => owned.some((s) => s.id === id));
      setSelected(new Set(preferred.length ? preferred : owned.map((s) => s.id)));
      const modes: Record<number, ModeLimitsValue> = {};
      for (const s of owned) {
        modes[s.id] = defaultShareMode(s, initialPersonal);
      }
      setShareModes(modes);
      setSeeded(true);
    }
    setStep((prev) => (prev === 'loading' ? 'devices' : prev));
  }, [owned, seeded, devicesReady, initialPersonal, initialSelectedIds]);

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

  const submit = (includeQueue: boolean) => {
    const shares = selectedOwned.map((s) =>
      toShare(s, shareModes[s.id] ?? defaultShareMode(s, personal)),
    );
    void onComplete({
      shares,
      personal,
      queue: includeQueue ? queue : undefined,
    });
  };

  const afterLimits = () => {
    if (selectedOwned.length > 0) go('queue', 'forward');
    else submit(false);
  };

  const stepIndex =
    step === 'queue' ? 3 : step === 'limits' ? 2 : step === 'devices' ? 1 : 0;
  const stepTotal = selectedOwned.length > 0 || step === 'queue' ? 3 : 2;

  return (
    <div className="auth-boot" role="dialog" aria-modal="true" aria-labelledby="setup-share-title">
      <div className="auth-boot__glow" aria-hidden />
      <div className="auth-boot__panel auth-boot__panel--wide auth-boot__panel--setup">
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
          Setup{step !== 'loading' ? ` · ${stepIndex}/${stepTotal}` : ''}
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
                  onClick={() => {
                    for (const s of selectedOwned) {
                      setShareModes((prev) =>
                        prev[s.id] ? prev : { ...prev, [s.id]: defaultShareMode(s, personal) },
                      );
                    }
                    go('limits', 'forward');
                  }}
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
                Activity limits
              </h2>
              <p className="auth-boot__hint">
                Set shock and vibrate bands per shared shocker, toggle beep and hold, and
                optionally enforce a warning before shock.
              </p>

              {error ? (
                <div className="auth-boot__error">
                  <div className="auth-boot__error-title">Couldn’t save</div>
                  <p>{error}</p>
                </div>
              ) : null}

              <div
                className={`setup-limits-split${
                  selectedOwned.length > 0 ? '' : ' setup-limits-split--single'
                }`}
              >
                <SetupLimitsPane
                  title="Your defaults"
                  open={defaultsOpen}
                  onToggle={() => setDefaultsOpen((open) => !open)}
                >
                  <ModeLimitsEditor
                    value={personalToMode(personal)}
                    deviceMaxIntensity={100}
                    deviceMaxDurationMs={15_000}
                    disabled={busy}
                    onChange={(m) => setPersonal((p) => modeToPersonal(m, p))}
                  />
                </SetupLimitsPane>

                {selectedOwned.length > 0 ? (
                  <SetupLimitsPane
                    title="Shared Discord shockers"
                    open={sharesOpen}
                    onToggle={() => setSharesOpen((open) => !open)}
                  >
                    {selectedOwned.map((s) => {
                      const deviceMaxI = Math.min(
                        100,
                        s.deviceMaxIntensity ?? s.maxIntensity ?? 100,
                      );
                      const deviceMaxD = Math.min(
                        15_000,
                        s.deviceMaxDuration ?? s.maxDuration ?? 15_000,
                      );
                      const mode = shareModes[s.id] ?? defaultShareMode(s, personal);
                      return (
                        <div key={s.id} className="setup-limits-shocker">
                          <div className="setup-limits-shocker__name">{s.name}</div>
                          <div className="setup-limits-shocker__cap">
                            PiShock max {deviceMaxI}% ·{' '}
                            {(deviceMaxD / 1000).toFixed(deviceMaxD % 1000 ? 1 : 0)}s
                          </div>
                          <ModeLimitsEditor
                            value={mode}
                            deviceMaxIntensity={deviceMaxI}
                            deviceMaxDurationMs={deviceMaxD}
                            disabled={busy}
                            onChange={(m) =>
                              setShareModes((prev) => ({
                                ...prev,
                                [s.id]: m,
                              }))
                            }
                          />
                        </div>
                      );
                    })}
                  </SetupLimitsPane>
                ) : (
                  <p className="auth-boot__hint setup-limits-split__empty">
                    No shockers selected to share — only your personal activity limits will be saved.
                  </p>
                )}
              </div>

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
                  onClick={afterLimits}
                >
                  <span className="q-btn__wrapper col row q-anchor--skip">
                    <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row no-wrap">
                      {busy ? (
                        <i className="q-icon on-left mdi mdi-loading mdi-spin" aria-hidden />
                      ) : null}
                      <span className="block">
                        {busy
                          ? 'Saving…'
                          : selectedOwned.length > 0
                            ? 'Next: queue'
                            : 'Finish setup'}
                      </span>
                    </span>
                  </span>
                </button>
              </div>
            </>
          ) : null}

          {step === 'queue' ? (
            <>
              <h2 id="setup-share-title" className="auth-boot__heading">
                Use a command queue?
              </h2>
              <p className="auth-boot__hint">
                When several people control your shared shockers, a queue runs commands one at a
                time. You can change this later from the queue panel.
              </p>

              {error ? (
                <div className="auth-boot__error">
                  <div className="auth-boot__error-title">Couldn’t save</div>
                  <p>{error}</p>
                </div>
              ) : null}

              <label className={`auth-boot__shocker${queue.enabled ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={queue.enabled}
                  disabled={busy}
                  onChange={(e) => setQueue((q) => ({ ...q, enabled: e.target.checked }))}
                />
                <span className="auth-boot__shocker-copy">
                  <span className="auth-boot__shocker-name">Enable command queue</span>
                  <span className="auth-boot__shocker-hub">
                    Line up incoming shocks instead of firing them all at once
                  </span>
                </span>
              </label>

              {queue.enabled ? (
                <div className="setup-limits-block">
                  <div className="setup-limits-block__title">Queue settings</div>
                  <LimitSlider
                    label="Advance after"
                    value={Math.max(0, queue.progressMs)}
                    min={0}
                    max={15_000}
                    step={500}
                    formatValue={(ms) => (ms <= 0 ? 'Command length' : formatDurationMs(ms))}
                    disabled={busy}
                    onChange={(progressMs) => setQueue((q) => ({ ...q, progressMs }))}
                  />
                  <LimitSlider
                    label="Commands ahead per person"
                    value={queue.maxPerSender}
                    min={1}
                    max={100}
                    step={1}
                    formatValue={(n) => String(n)}
                    disabled={busy}
                    onChange={(maxPerSender) => setQueue((q) => ({ ...q, maxPerSender }))}
                  />
                  <label className={`auth-boot__shocker${queue.starOnly ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={queue.starOnly}
                      disabled={busy}
                      onChange={(e) => setQueue((q) => ({ ...q, starOnly: e.target.checked }))}
                    />
                    <span className="auth-boot__shocker-copy">
                      <span className="auth-boot__shocker-name">Stars only</span>
                      <span className="auth-boot__shocker-hub">
                        Only people you star can control your shockers
                      </span>
                    </span>
                  </label>
                </div>
              ) : null}

              <div className="auth-boot__actions">
                <button
                  type="button"
                  className="q-btn q-btn-item non-selectable no-outline text-grey-4 bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
                  disabled={busy}
                  onClick={() => go('limits', 'back')}
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
                  onClick={() => submit(true)}
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
