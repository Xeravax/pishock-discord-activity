import { useEffect, useMemo, useState } from 'react';
import { BrandHeader } from './BrandHeader';
import type { ShockerView } from './ShockerCard';
import type { ActivityShareConfig } from './AvailabilitySettings';
import type { PersonalLimits, ShareLimitRow } from './ActivityLimitsSettings';
import { ModeLimitsEditor, type ModeLimitsValue } from './ModeLimitsEditor';
import {
  LimitSlider,
  formatDurationMs,
} from './LimitSlider';
import { normalizeWarningLevel } from '../../shared/warning';
import type { QueuePanelSettings } from './QueuePanel';
import {
  EffectiveCap,
  LimitsTabs,
  PersonalLimitsExplainer,
  SharedLimitsExplainer,
  TabPanel,
  type LimitsTab,
} from './LimitsTabs';
import {
  DEFAULT_LOG_PRIVACY,
  LogPrivacyForm,
  type LogPrivacy,
} from './LogPrivacySettings';

function logPrivacySummary(v: LogPrivacy): string {
  const where =
    v.visibility === 'everywhere'
      ? 'Visible everywhere'
      : v.visibility === 'server'
        ? 'Same server only'
        : v.visibility === 'channel'
          ? 'Same channel only'
          : 'Only you and the sender';
  const hidden = [
    !v.showSender ? 'sender' : null,
    !v.showDevice ? 'device' : null,
    !v.showIntensity ? 'intensity' : null,
    !v.showLocation ? 'location' : null,
  ].filter(Boolean);
  return hidden.length ? `${where} · hides ${hidden.join(', ')}` : `${where} · full details`;
}

type SetupStep = 'loading' | 'devices' | 'limits' | 'features';

type Props = {
  shockers: ShockerView[];
  initialPersonal: PersonalLimits;
  /**
   * Pre-select these shockers when redoing setup.
   * Undefined selects every owned shocker. An explicit empty list selects none.
   */
  initialSelectedIds?: number[];
  /** Saved share rows. Personal defaults are used only when a shocker has no row. */
  initialShares?: ShareLimitRow[];
  /** Current queue settings. Leaving the step unchanged posts these, not disabled defaults. */
  initialQueue?: QueuePanelSettings;
  /** Current log sharing settings (defaults when unknown). */
  initialLogPrivacy?: LogPrivacy;
  /** Demo / review only: open directly on this step once devices are ready. */
  startStep?: 'devices' | 'limits' | 'features';
  /** True after post-confirm device fetch finishes (even if the list is empty). */
  devicesReady?: boolean;
  busy?: boolean;
  error?: string | null;
  onComplete: (result: {
    shares: ActivityShareConfig[];
    personal: PersonalLimits;
    queue?: QueuePanelSettings;
    logPrivacy?: LogPrivacy;
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

function savedShareToMode(s: ShockerView, row: ShareLimitRow): ModeLimitsValue {
  const deviceMaxI = Math.min(100, s.deviceMaxIntensity ?? s.maxIntensity ?? 100);
  const deviceMaxD = Math.min(15_000, s.deviceMaxDuration ?? s.maxDuration ?? 15_000);
  const shockMax = Math.min(deviceMaxI, row.maxIntensity);
  const shockMin = Math.min(shockMax, Math.max(1, row.minIntensity ?? 1));
  const shockMaxD = Math.min(deviceMaxD, row.maxDurationMs);
  const shockMinD = Math.min(shockMaxD, Math.max(16, row.minDurationMs ?? 16));
  const vibMax = Math.min(deviceMaxI, row.vibMaxIntensity ?? shockMax);
  const vibMin = Math.min(vibMax, Math.max(1, row.vibMinIntensity ?? shockMin));
  const vibMaxD = Math.min(deviceMaxD, row.vibMaxDurationMs ?? shockMaxD);
  const vibMinD = Math.min(vibMaxD, Math.max(16, row.vibMinDurationMs ?? shockMinD));
  const beepMax = Math.min(deviceMaxI, row.beepMaxIntensity ?? shockMax);
  const beepMin = Math.min(beepMax, Math.max(1, row.beepMinIntensity ?? shockMin));
  const beepMaxD = Math.min(deviceMaxD, row.beepMaxDurationMs ?? shockMaxD);
  const beepMinD = Math.min(beepMaxD, Math.max(16, row.beepMinDurationMs ?? shockMinD));
  return {
    canShock: row.canShock,
    canVibrate: row.canVibrate,
    canBeep: row.canBeep,
    canHold: row.canHold,
    shock: {
      minIntensity: shockMin,
      maxIntensity: shockMax,
      minDurationMs: shockMinD,
      maxDurationMs: shockMaxD,
    },
    vibrate: {
      minIntensity: vibMin,
      maxIntensity: vibMax,
      minDurationMs: vibMinD,
      maxDurationMs: vibMaxD,
    },
    beep: {
      minIntensity: beepMin,
      maxIntensity: beepMax,
      minDurationMs: beepMinD,
      maxDurationMs: beepMaxD,
    },
    requiredWarningLevel: normalizeWarningLevel(row.requiredWarningLevel),
  };
}

function toShare(
  s: ShockerView,
  mode: ModeLimitsValue,
  saved?: ShareLimitRow | null,
): ActivityShareConfig {
  const deviceMaxI = Math.min(100, s.deviceMaxIntensity ?? s.maxIntensity ?? 100);
  const deviceMaxD = Math.min(15_000, s.deviceMaxDuration ?? s.maxDuration ?? 15_000);
  return {
    shockerId: s.id,
    shockerName: s.name,
    hubClientId: s.clientId != null ? String(s.clientId) : null,
    hubName: s.hubName ?? null,
    enabled: true,
    paused: Boolean(saved?.paused),
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
  initialShares,
  initialQueue,
  initialLogPrivacy,
  startStep,
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
  const [editedShareIds, setEditedShareIds] = useState<Set<number>>(() => new Set());
  const [queue, setQueue] = useState<QueuePanelSettings>(initialQueue ?? DEFAULT_QUEUE);
  const [queueTouched, setQueueTouched] = useState(false);
  const [limitsTab, setLimitsTab] = useState<LimitsTab>('personal');
  const [logPrivacy, setLogPrivacy] = useState<LogPrivacy>(
    () => initialLogPrivacy ?? { ...DEFAULT_LOG_PRIVACY },
  );
  const [logTouched, setLogTouched] = useState(false);
  const [openFeature, setOpenFeature] = useState<'queue' | 'logs' | null>(null);

  useEffect(() => {
    if (logTouched || !initialLogPrivacy) return;
    setLogPrivacy(initialLogPrivacy);
  }, [logTouched, initialLogPrivacy]);

  useEffect(() => {
    setPersonal(initialPersonal);
  }, [initialPersonal]);

  useEffect(() => {
    if (queueTouched || !initialQueue) return;
    setQueue(initialQueue);
  }, [queueTouched, initialQueue]);

  const updatePersonalDefaults = (next: PersonalLimits) => {
    setPersonal(next);
    const savedById = new Map((initialShares ?? []).map((row) => [row.shockerId, row]));
    setShareModes((prev) => {
      const out = { ...prev };
      for (const s of owned) {
        if (editedShareIds.has(s.id) || savedById.has(s.id)) continue;
        out[s.id] = defaultShareMode(s, next);
      }
      return out;
    });
  };

  useEffect(() => {
    if (!devicesReady) {
      setStep('loading');
      return;
    }
    if (owned.length > 0 && !seeded) {
      const ownedIds = new Set(owned.map((s) => s.id));
      const selectedIds =
        initialSelectedIds === undefined
          ? owned.map((s) => s.id)
          : initialSelectedIds.filter((id) => ownedIds.has(id));
      setSelected(new Set(selectedIds));
      const savedById = new Map((initialShares ?? []).map((row) => [row.shockerId, row]));
      const modes: Record<number, ModeLimitsValue> = {};
      for (const s of owned) {
        const saved = savedById.get(s.id);
        modes[s.id] = saved ? savedShareToMode(s, saved) : defaultShareMode(s, initialPersonal);
      }
      setShareModes(modes);
      setSeeded(true);
    }
    setStep((prev) => (prev === 'loading' ? (startStep ?? 'devices') : prev));
  }, [owned, seeded, devicesReady, initialPersonal, initialSelectedIds, initialShares, startStep]);

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
    const savedById = new Map((initialShares ?? []).map((row) => [row.shockerId, row]));
    const shares = selectedOwned.map((s) =>
      toShare(
        s,
        shareModes[s.id] ?? defaultShareMode(s, personal),
        savedById.get(s.id) ?? null,
      ),
    );
    void onComplete({
      shares,
      personal,
      queue: includeQueue ? queue : undefined,
      logPrivacy: logTouched ? logPrivacy : undefined,
    });
  };

  const afterLimits = () => {
    go('features', 'forward');
  };

  const stepIndex =
    step === 'features' ? 3 : step === 'limits' ? 2 : step === 'devices' ? 1 : 0;
  const stepTotal = 3;

  return (
    <div className="auth-boot" role="dialog" aria-modal="true" aria-labelledby="setup-share-title">
      <div className="auth-boot__glow" aria-hidden />
      <div
        className={`auth-boot__panel auth-boot__panel--wide auth-boot__panel--setup${
          step === 'limits' ? '' : ' is-compact'
        }${step === 'features' ? ' is-features' : ''}`}
      >
        <BrandHeader
          compact
          badgeIcon={
            step === 'limits'
              ? 'mdi-tune-vertical'
              : step === 'features'
                ? 'mdi-puzzle-outline'
                : 'mdi-account-group'
          }
          sub={`Setup${step !== 'loading' ? ` · ${stepIndex}/${stepTotal}` : ''}`}
        />

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
                  className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
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
                  className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
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
                Set your own device defaults first, then the limits for each shocker you share.
                Your defaults always cap what shared shockers can do.
              </p>

              {error ? (
                <div className="auth-boot__error">
                  <div className="auth-boot__error-title">Couldn’t save</div>
                  <p>{error}</p>
                </div>
              ) : null}

              <LimitsTabs
                value={limitsTab}
                onChange={setLimitsTab}
                sharedCount={selectedOwned.length}
              />

              {limitsTab === 'personal' ? (
                <TabPanel>
                  <PersonalLimitsExplainer />
                  <ModeLimitsEditor
                    value={personalToMode(personal)}
                    deviceMaxIntensity={100}
                    deviceMaxDurationMs={15_000}
                    disabled={busy}
                    hideActionToggles
                    onChange={(m) => updatePersonalDefaults(modeToPersonal(m, personal))}
                  />
                </TabPanel>
              ) : (
                <TabPanel>
                  <SharedLimitsExplainer personal={personalToMode(personal)} />
                  {selectedOwned.length > 0 ? (
                    selectedOwned.map((s) => {
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
                          <EffectiveCap
                            share={mode}
                            personal={personalToMode(personal)}
                            deviceMaxIntensity={deviceMaxI}
                            deviceMaxDurationMs={deviceMaxD}
                          />
                          <ModeLimitsEditor
                            value={mode}
                            deviceMaxIntensity={deviceMaxI}
                            deviceMaxDurationMs={deviceMaxD}
                            disabled={busy}
                            onChange={(m) => {
                              setEditedShareIds((prev) => new Set(prev).add(s.id));
                              setShareModes((prev) => ({
                                ...prev,
                                [s.id]: m,
                              }));
                            }}
                          />
                        </div>
                      );
                    })
                  ) : (
                    <div className="ps-empty">
                      No shockers selected to share — only your device defaults will be saved.
                    </div>
                  )}
                </TabPanel>
              )}

              <div className="auth-boot__actions">
                <button
                  type="button"
                  className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
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
                        {busy ? 'Saving…' : 'Next: extras'}
                      </span>
                    </span>
                  </span>
                </button>
              </div>
            </>
          ) : null}

          {step === 'features' ? (
            <>
              <h2 id="setup-share-title" className="auth-boot__heading">
                Want to control extra features?
              </h2>
              <p className="auth-boot__hint">
                Optional — everything here can be changed later from the menu.
              </p>

              {error ? (
                <div className="auth-boot__error">
                  <div className="auth-boot__error-title">Couldn’t save</div>
                  <p>{error}</p>
                </div>
              ) : null}

              <div className="setup-features">
                {selectedOwned.length > 0 ? (
                  <section className={`setup-feature${openFeature === 'queue' ? ' is-open' : ''}`}>
                    <button
                      type="button"
                      className="setup-feature__head"
                      aria-expanded={openFeature === 'queue'}
                      onClick={() => setOpenFeature((f) => (f === 'queue' ? null : 'queue'))}
                    >
                      <span className="setup-feature__icon">
                        <i className="q-icon mdi mdi-format-list-numbered" aria-hidden />
                      </span>
                      <span>
                        <span className="setup-feature__title">Command queue</span>
                        <span className="setup-feature__summary">
                          {queue.enabled
                            ? 'On — incoming commands run one at a time'
                            : 'Off — commands from several people fire immediately'}
                        </span>
                      </span>
                      <i
                        className={`q-icon mdi setup-feature__chevron ${
                          openFeature === 'queue' ? 'mdi-chevron-up' : 'mdi-chevron-down'
                        }`}
                        aria-hidden
                      />
                    </button>
                    {openFeature === 'queue' ? (
                      <div className="setup-feature__body">
                        <p className="auth-boot__hint" style={{ textAlign: 'left' }}>
                          When several people control your shared shockers, a queue runs their
                          commands one at a time.
                        </p>
                    <label className={`auth-boot__shocker${queue.enabled ? ' is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={queue.enabled}
                        disabled={busy}
                        onChange={(e) => {
                          setQueueTouched(true);
                          setQueue((q) => ({ ...q, enabled: e.target.checked }));
                        }}
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
                          onChange={(progressMs) => {
                            setQueueTouched(true);
                            setQueue((q) => ({ ...q, progressMs }));
                          }}
                        />
                        <LimitSlider
                          label="Commands ahead per person"
                          value={queue.maxPerSender}
                          min={1}
                          max={100}
                          step={1}
                          formatValue={(n) => String(n)}
                          disabled={busy}
                          onChange={(maxPerSender) => {
                            setQueueTouched(true);
                            setQueue((q) => ({ ...q, maxPerSender }));
                          }}
                        />
                        <label className={`auth-boot__shocker${queue.starOnly ? ' is-on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={queue.starOnly}
                            disabled={busy}
                            onChange={(e) => {
                              setQueueTouched(true);
                              setQueue((q) => ({ ...q, starOnly: e.target.checked }));
                            }}
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

                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section className={`setup-feature${openFeature === 'logs' ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="setup-feature__head"
                    aria-expanded={openFeature === 'logs'}
                    onClick={() => setOpenFeature((f) => (f === 'logs' ? null : 'logs'))}
                  >
                    <span className="setup-feature__icon">
                      <i className="q-icon mdi mdi-text-box-search-outline" aria-hidden />
                    </span>
                    <span>
                      <span className="setup-feature__title">Log sharing</span>
                      <span className="setup-feature__summary">{logPrivacySummary(logPrivacy)}</span>
                    </span>
                    <i
                      className={`q-icon mdi setup-feature__chevron ${
                        openFeature === 'logs' ? 'mdi-chevron-up' : 'mdi-chevron-down'
                      }`}
                      aria-hidden
                    />
                  </button>
                  {openFeature === 'logs' ? (
                    <div className="setup-feature__body">
                      <LogPrivacyForm
                        compact
                        value={logPrivacy}
                        disabled={busy}
                        onChange={(v) => {
                          setLogTouched(true);
                          setLogPrivacy(v);
                        }}
                      />
                    </div>
                  ) : null}
                </section>
              </div>

              <div className="auth-boot__actions">
                <button
                  type="button"
                  className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
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
                  onClick={() => submit(selectedOwned.length > 0)}
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
