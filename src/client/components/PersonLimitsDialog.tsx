import { useEffect, useState } from 'react';
import { PsDialog } from './PsDialog';
import { LimitSlider, formatDurationMs, formatIntensityPct } from './LimitSlider';
import type { PersonLimit } from '../safety';

type Editable = Omit<PersonLimit, 'controllerDiscordUserId'>;

const EMPTY: Editable = {
  shockMaxIntensity: null,
  shockMaxDurationMs: null,
  vibMaxIntensity: null,
  vibMaxDurationMs: null,
  beepMaxIntensity: null,
  beepMaxDurationMs: null,
  canShock: true,
  canVibrate: true,
  canBeep: true,
};

type Props = {
  open: boolean;
  personName: string;
  initial: PersonLimit | null;
  onClose: () => void;
  onSave: (next: Editable) => Promise<void>;
  onClear: () => Promise<void>;
};

function CapSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  format: (n: number) => string;
  disabled?: boolean;
  onChange: (n: number | null) => void;
}) {
  // The top of the range means "no extra cap" (your normal limits apply).
  return (
    <LimitSlider
      label={label}
      value={value ?? max}
      min={min}
      max={max}
      step={step}
      formatValue={(n) => (n >= max ? 'Your normal limit' : format(n))}
      disabled={disabled}
      onChange={(n) => onChange(n >= max ? null : n)}
    />
  );
}

/** Wearer sets lower caps for one controller. Caps never raise the normal limits. */
export function PersonLimitsDialog({ open, personName, initial, onClose, onSave, onClear }: Props) {
  const [value, setValue] = useState<Editable>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!initial) {
      setValue(EMPTY);
      return;
    }
    const { controllerDiscordUserId: _ignored, ...rest } = initial;
    setValue(rest);
  }, [open, initial]);

  const set = (patch: Partial<Editable>) => setValue((v) => ({ ...v, ...patch }));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PsDialog open={open} title={`Limits for ${personName}`} onClose={onClose}>
      <div className="ps-stack ps-stack--lg">
        <p className="text-grey-5 text-body2" style={{ margin: 0 }}>
          Only applies when <strong>{personName}</strong> controls your shockers. These can only be
          lower than your normal limits.
        </p>
        {error ? (
          <div className="ps-callout ps-callout--error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="log-privacy__toggles log-privacy__toggles--row">
          {(
            [
              ['canShock', 'Shock'],
              ['canVibrate', 'Vibrate'],
              ['canBeep', 'Beep'],
            ] as const
          ).map(([key, title]) => (
            <label key={key} className={`log-privacy__toggle${value[key] ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                className="ps-check"
                checked={value[key]}
                disabled={busy}
                onChange={(e) => set({ [key]: e.target.checked })}
              />
              <span className="log-privacy__toggle-copy">
                <span className="log-privacy__toggle-title">{title}</span>
                <span className="log-privacy__toggle-hint">Allowed for them</span>
              </span>
            </label>
          ))}
        </div>

        {value.canShock ? (
          <div className="setup-limits-block">
            <div className="setup-limits-block__title">Shock</div>
            <CapSlider label="Max intensity" value={value.shockMaxIntensity} min={1} max={100} step={1} format={formatIntensityPct} disabled={busy} onChange={(n) => set({ shockMaxIntensity: n })} />
            <CapSlider label="Max duration" value={value.shockMaxDurationMs} min={100} max={15_000} step={100} format={formatDurationMs} disabled={busy} onChange={(n) => set({ shockMaxDurationMs: n })} />
          </div>
        ) : null}
        {value.canVibrate ? (
          <div className="setup-limits-block">
            <div className="setup-limits-block__title">Vibrate</div>
            <CapSlider label="Max intensity" value={value.vibMaxIntensity} min={1} max={100} step={1} format={formatIntensityPct} disabled={busy} onChange={(n) => set({ vibMaxIntensity: n })} />
            <CapSlider label="Max duration" value={value.vibMaxDurationMs} min={100} max={15_000} step={100} format={formatDurationMs} disabled={busy} onChange={(n) => set({ vibMaxDurationMs: n })} />
          </div>
        ) : null}

        <div className="row items-center justify-between q-gutter-sm">
          <button
            type="button"
            className="safety-btn safety-btn--ghost"
            disabled={busy || !initial}
            onClick={() => void run(onClear)}
          >
            Remove their limits
          </button>
          <button
            type="button"
            className="safety-btn safety-btn--accept"
            disabled={busy}
            onClick={() => void run(() => onSave(value))}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </PsDialog>
  );
}
