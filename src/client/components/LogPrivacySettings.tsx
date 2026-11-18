import { useEffect, useState } from 'react';

export type LogVisibility = 'everywhere' | 'server' | 'channel' | 'private';

export type LogPrivacy = {
  visibility: LogVisibility;
  showSender: boolean;
  showDevice: boolean;
  showIntensity: boolean;
  showLocation: boolean;
  includeShock: boolean;
  includeVibrate: boolean;
  includeBeep: boolean;
  allowShareCards: boolean;
  hideMeAsSender: boolean;
};

export const DEFAULT_LOG_PRIVACY: LogPrivacy = {
  visibility: 'everywhere',
  showSender: true,
  showDevice: true,
  showIntensity: true,
  showLocation: true,
  includeShock: true,
  includeVibrate: true,
  includeBeep: true,
  allowShareCards: true,
  hideMeAsSender: false,
};

export function normalizeLogPrivacy(raw: Partial<LogPrivacy> | null | undefined): LogPrivacy {
  const out = { ...DEFAULT_LOG_PRIVACY };
  if (!raw) return out;
  if (['everywhere', 'server', 'channel', 'private'].includes(String(raw.visibility))) {
    out.visibility = raw.visibility as LogVisibility;
  }
  for (const key of Object.keys(DEFAULT_LOG_PRIVACY) as Array<keyof LogPrivacy>) {
    if (key === 'visibility') continue;
    if (typeof raw[key] === 'boolean') (out[key] as boolean) = raw[key] as boolean;
  }
  return out;
}

const SCOPES: Array<{ id: LogVisibility; icon: string; title: string; hint: string }> = [
  {
    id: 'everywhere',
    icon: 'mdi-earth',
    title: 'Everywhere',
    hint: 'Anyone using the activity, in any server, sees your hits in the log.',
  },
  {
    id: 'server',
    icon: 'mdi-server',
    title: 'Same server',
    hint: 'Only people in the server where it happened.',
  },
  {
    id: 'channel',
    icon: 'mdi-pound',
    title: 'Same channel',
    hint: 'Only people in the channel the command was run in.',
  },
  {
    id: 'private',
    icon: 'mdi-lock-outline',
    title: 'Only us',
    hint: 'Only you and whoever sent the command.',
  },
];

type ToggleKey = Exclude<keyof LogPrivacy, 'visibility'>;

function Toggle({
  value,
  field,
  title,
  hint,
  disabled,
  onChange,
}: {
  value: LogPrivacy;
  field: ToggleKey;
  title: string;
  hint: string;
  disabled?: boolean;
  onChange: (next: LogPrivacy) => void;
}) {
  const on = value[field];
  return (
    <label className={`log-privacy__toggle${on ? ' is-on' : ''}`}>
      <input
        type="checkbox"
        className="ps-check"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, [field]: e.target.checked })}
      />
      <span className="log-privacy__toggle-copy">
        <span className="log-privacy__toggle-title">{title}</span>
        <span className="log-privacy__toggle-hint">{hint}</span>
      </span>
    </label>
  );
}

/** Plain-language summary of what a stranger would see. */
function previewLine(v: LogPrivacy): string {
  if (v.visibility === 'private') return 'Nobody else sees your hits in the log.';
  const actions = [
    v.includeShock ? 'shocks' : null,
    v.includeVibrate ? 'vibrations' : null,
    v.includeBeep ? 'beeps' : null,
  ].filter(Boolean);
  if (!actions.length) return 'Nobody else sees your hits in the log.';
  const who = v.showSender ? 'RogerfireFox' : 'Someone';
  const how = v.showIntensity ? ' at 40% for 1s' : '';
  const dev = v.showDevice ? ' on “Leg”' : '';
  const where = v.showLocation ? ' · in The Basement' : '';
  const scope =
    v.visibility === 'everywhere'
      ? 'Everyone'
      : v.visibility === 'server'
        ? 'People in that server'
        : 'People in that channel';
  return `${scope} would see: “${who} shocked you${how}${dev}${where}”`;
}

type Props = {
  value: LogPrivacy;
  onChange: (next: LogPrivacy) => void;
  disabled?: boolean;
  /** Tighter spacing for the setup flow. */
  compact?: boolean;
};

/** Controlled form for who / what / where hits on you show up in the shared log. */
export function LogPrivacyForm({ value, onChange, disabled, compact }: Props) {
  return (
    <div className={`log-privacy${compact ? ' log-privacy--compact' : ''}`}>
      <div className="ps-section-title">Where others can see your hits</div>
      <div className="log-privacy__scopes" role="radiogroup" aria-label="Log visibility">
        {SCOPES.map((scope) => (
          <button
            key={scope.id}
            type="button"
            role="radio"
            aria-checked={value.visibility === scope.id}
            disabled={disabled}
            className={`log-privacy__scope${value.visibility === scope.id ? ' is-active' : ''}`}
            onClick={() => onChange({ ...value, visibility: scope.id })}
          >
            <i className={`q-icon mdi ${scope.icon}`} aria-hidden />
            <span className="log-privacy__scope-title">{scope.title}</span>
            <span className="log-privacy__scope-hint">{scope.hint}</span>
          </button>
        ))}
      </div>

      <div className="ps-section-title">What others can see</div>
      <div className="log-privacy__toggles">
        <Toggle value={value} field="showSender" title="Who did it" hint="Otherwise shown as “Someone”." disabled={disabled} onChange={onChange} />
        <Toggle value={value} field="showDevice" title="Shocker & hub names" hint="Which of your devices was used." disabled={disabled} onChange={onChange} />
        <Toggle value={value} field="showIntensity" title="Intensity & duration" hint="How strong and how long." disabled={disabled} onChange={onChange} />
        <Toggle value={value} field="showLocation" title="Server / channel name" hint="Where it happened." disabled={disabled} onChange={onChange} />
      </div>

      <div className="ps-section-title">Which actions are logged for others</div>
      <div className="log-privacy__toggles log-privacy__toggles--row">
        <Toggle value={value} field="includeShock" title="Shocks" hint="Includes holds." disabled={disabled} onChange={onChange} />
        <Toggle value={value} field="includeVibrate" title="Vibrations" hint="Vibrate commands." disabled={disabled} onChange={onChange} />
        <Toggle value={value} field="includeBeep" title="Beeps" hint="Beep commands." disabled={disabled} onChange={onChange} />
      </div>

      <div className="ps-section-title">Sharing</div>
      <div className="log-privacy__toggles">
        <Toggle
          value={value}
          field="allowShareCards"
          title="Let others share images of my hits"
          hint="Others can post a share card of a hit on you to Discord. You can always share your own."
          disabled={disabled}
          onChange={onChange}
        />
        <Toggle
          value={value}
          field="hideMeAsSender"
          title="Hide me when I shock others"
          hint="Bystanders see “Someone”. The person you shocked still sees it was you."
          disabled={disabled}
          onChange={onChange}
        />
      </div>

      <div className="ps-callout log-privacy__preview" aria-live="polite">
        <i className="q-icon mdi mdi-eye-outline" aria-hidden /> {previewLine(value)}
      </div>
      <p className="log-privacy__note">
        You and the person who sent a command always see the full entry — so you can always tell
        who shocked you.
      </p>
    </div>
  );
}

/** Dialog body: loads, edits and saves log privacy. */
export function LogPrivacySettings({
  onLoad,
  onSave,
}: {
  onLoad: () => Promise<LogPrivacy>;
  onSave: (next: LogPrivacy) => Promise<LogPrivacy>;
}) {
  const [value, setValue] = useState<LogPrivacy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    onLoad()
      .then((v) => {
        if (!cancelled) setValue(normalizeLogPrivacy(v));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setValue({ ...DEFAULT_LOG_PRIVACY });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onLoad]);

  if (!value) return <div className="text-grey-5 q-pa-md">Loading log settings…</div>;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      setValue(normalizeLogPrivacy(await onSave(value)));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ps-stack ps-stack--lg">
      <p className="text-grey-5 text-body2" style={{ margin: 0 }}>
        Decide how commands sent to you show up in the shared activity log and in share images.
      </p>
      {error ? (
        <div className="ps-callout ps-callout--error" role="alert">
          {error}
        </div>
      ) : null}
      {saved && !error ? (
        <div className="ps-callout ps-callout--success" role="status">
          Log sharing settings saved.
        </div>
      ) : null}
      <LogPrivacyForm
        value={value}
        disabled={saving}
        onChange={(v) => {
          setSaved(false);
          setValue(v);
        }}
      />
      <div className="row justify-end ps-actions">
        <button
          type="button"
          className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
          disabled={saving}
          onClick={() => void save()}
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
