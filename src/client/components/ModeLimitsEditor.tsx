import { useState, type ReactNode } from 'react';
import {
  LimitSlider,
  formatDurationMs,
  formatIntensityPct,
} from './LimitSlider';
import {
  WARNING_LEVELS,
  warningButtonLabel,
  type WarningLevel,
  normalizeWarningLevel,
} from '../../shared/warning';

export type ModeBand = {
  minIntensity: number;
  maxIntensity: number;
  minDurationMs: number;
  maxDurationMs: number;
};

export type ModeLimitsValue = {
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
  shock: ModeBand;
  vibrate: ModeBand;
  beep: ModeBand;
  requiredWarningLevel: WarningLevel;
};

type ModeKey = 'shock' | 'vibrate' | 'extra';

type Props = {
  value: ModeLimitsValue;
  deviceMaxIntensity: number;
  deviceMaxDurationMs: number;
  disabled?: boolean;
  showWarning?: boolean;
  onChange: (next: ModeLimitsValue) => void;
};

function BandSliders({
  band,
  deviceMaxI,
  deviceMaxD,
  disabled,
  onChange,
}: {
  band: ModeBand;
  deviceMaxI: number;
  deviceMaxD: number;
  disabled?: boolean;
  onChange: (band: ModeBand) => void;
}) {
  return (
    <div className="mode-limits-band">
      <LimitSlider
        label="Min intensity"
        value={band.minIntensity}
        min={1}
        max={band.maxIntensity}
        formatValue={formatIntensityPct}
        disabled={disabled}
        onChange={(minIntensity) => onChange({ ...band, minIntensity })}
      />
      <LimitSlider
        label="Max intensity"
        value={band.maxIntensity}
        min={band.minIntensity}
        max={deviceMaxI}
        formatValue={formatIntensityPct}
        disabled={disabled}
        onChange={(maxIntensity) =>
          onChange({
            ...band,
            maxIntensity,
            minIntensity: Math.min(band.minIntensity, maxIntensity),
          })
        }
      />
      <LimitSlider
        label="Min duration"
        value={band.minDurationMs}
        min={16}
        max={band.maxDurationMs}
        step={100}
        formatValue={formatDurationMs}
        disabled={disabled}
        onChange={(minDurationMs) => onChange({ ...band, minDurationMs })}
      />
      <LimitSlider
        label="Max duration"
        value={band.maxDurationMs}
        min={band.minDurationMs}
        max={deviceMaxD}
        step={100}
        formatValue={formatDurationMs}
        disabled={disabled}
        onChange={(maxDurationMs) =>
          onChange({
            ...band,
            maxDurationMs,
            minDurationMs: Math.min(band.minDurationMs, maxDurationMs),
          })
        }
      />
    </div>
  );
}

function ModeColumn({
  modeKey,
  title,
  enabled,
  open,
  showEnableToggle,
  disabled,
  summary,
  onToggleOpen,
  onToggleEnabled,
  children,
}: {
  modeKey: ModeKey;
  title: string;
  enabled: boolean;
  open: boolean;
  showEnableToggle: boolean;
  disabled?: boolean;
  summary: string;
  onToggleOpen: () => void;
  onToggleEnabled?: (enabled: boolean) => void;
  children?: ReactNode;
}) {
  const expanded = enabled && open;
  return (
    <section
      className={`mode-limits-col${expanded ? ' is-open' : ' is-collapsed'}${
        enabled ? '' : ' is-disabled'
      }${modeKey === 'extra' ? ' mode-limits-col--wide' : ''}`}
      data-mode={modeKey}
    >
      <header className="mode-limits-col__head">
        {showEnableToggle && onToggleEnabled ? (
          <input
            type="checkbox"
            className="mode-limits-col__enable"
            checked={enabled}
            disabled={disabled}
            title={`Allow ${title.toLowerCase()}`}
            aria-label={`Allow ${title.toLowerCase()}`}
            style={{ accentColor: '#79c6db' }}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
        <button
          type="button"
          className="mode-limits-col__toggle"
          disabled={disabled || !enabled}
          aria-expanded={expanded}
          onClick={onToggleOpen}
        >
          <span className="mode-limits-col__title">{title}</span>
          <i
            className={`q-icon mdi mode-limits-col__chevron ${
              expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'
            }`}
            aria-hidden
          />
        </button>
      </header>
      {expanded ? (
        <div className="mode-limits-col__body">{children}</div>
      ) : (
        <button
          type="button"
          className="mode-limits-col__summary"
          disabled={disabled || !enabled}
          onClick={onToggleOpen}
        >
          {enabled ? summary : 'Off'}
        </button>
      )}
    </section>
  );
}

function bandSummary(band: ModeBand): string {
  return `${formatIntensityPct(band.minIntensity)}–${formatIntensityPct(band.maxIntensity)} · ${formatDurationMs(band.minDurationMs)}–${formatDurationMs(band.maxDurationMs)}`;
}

function extraSummary(value: ModeLimitsValue, showWarning: boolean): string {
  const parts: string[] = [];
  parts.push(value.canBeep ? 'Beep on' : 'Beep off');
  parts.push(value.canHold ? 'Hold on' : 'Hold off');
  if (showWarning) {
    parts.push(
      value.requiredWarningLevel === 'none'
        ? 'Warning free'
        : `${warningButtonLabel(value.requiredWarningLevel)} warn`,
    );
  }
  return parts.join(' · ');
}

/** Shock / vibe menus + Extra options (beep, hold, warning). */
export function ModeLimitsEditor({
  value,
  deviceMaxIntensity,
  deviceMaxDurationMs,
  disabled,
  showWarning = true,
  onChange,
}: Props) {
  const deviceMaxI = Math.min(100, deviceMaxIntensity);
  const deviceMaxD = Math.min(15_000, deviceMaxDurationMs);

  const [openModes, setOpenModes] = useState<Record<ModeKey, boolean>>({
    shock: true,
    vibrate: true,
    extra: true,
  });

  const toggleOpen = (key: ModeKey) => {
    setOpenModes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="mode-limits-editor">
      <div className="mode-limits-row">
        <ModeColumn
          modeKey="shock"
          title="Shock"
          enabled={value.canShock}
          open={openModes.shock}
          showEnableToggle
          disabled={disabled}
          summary={bandSummary(value.shock)}
          onToggleOpen={() => toggleOpen('shock')}
          onToggleEnabled={(canShock) => onChange({ ...value, canShock })}
        >
          <BandSliders
            band={value.shock}
            deviceMaxI={deviceMaxI}
            deviceMaxD={deviceMaxD}
            disabled={disabled}
            onChange={(shock) => onChange({ ...value, shock })}
          />
        </ModeColumn>

        <ModeColumn
          modeKey="vibrate"
          title="Vibrate"
          enabled={value.canVibrate}
          open={openModes.vibrate}
          showEnableToggle
          disabled={disabled}
          summary={bandSummary(value.vibrate)}
          onToggleOpen={() => toggleOpen('vibrate')}
          onToggleEnabled={(canVibrate) => onChange({ ...value, canVibrate })}
        >
          <BandSliders
            band={value.vibrate}
            deviceMaxI={deviceMaxI}
            deviceMaxD={deviceMaxD}
            disabled={disabled}
            onChange={(vibrate) => onChange({ ...value, vibrate })}
          />
        </ModeColumn>

        <ModeColumn
          modeKey="extra"
          title="Extra options"
          enabled
          open={openModes.extra}
          showEnableToggle={false}
          disabled={disabled}
          summary={extraSummary(value, showWarning)}
          onToggleOpen={() => toggleOpen('extra')}
        >
          <div className="mode-limits-extra">
            <label className="mode-limits-extra__row">
              <input
                type="checkbox"
                checked={value.canBeep}
                disabled={disabled}
                style={{ accentColor: '#79c6db' }}
                onChange={(e) => onChange({ ...value, canBeep: e.target.checked })}
              />
              <span>
                <span className="mode-limits-extra__label">Beep</span>
                <span className="mode-limits-col__hint">Allow beep commands</span>
              </span>
            </label>

            <label className="mode-limits-extra__row">
              <input
                type="checkbox"
                checked={value.canHold}
                disabled={disabled}
                style={{ accentColor: '#79c6db' }}
                onChange={(e) => onChange({ ...value, canHold: e.target.checked })}
              />
              <span>
                <span className="mode-limits-extra__label">Hold</span>
                <span className="mode-limits-col__hint">
                  Press-and-hold operate until release
                </span>
              </span>
            </label>

            {showWarning ? (
              <label className="mode-limits-warning">
                <span className="text-caption text-secondary">Required warning before shock</span>
                <select
                  className="q-field__native q-placeholder mode-limits-warning__select"
                  disabled={disabled || !value.canVibrate}
                  value={normalizeWarningLevel(value.requiredWarningLevel)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      requiredWarningLevel: normalizeWarningLevel(e.target.value),
                    })
                  }
                >
                  {WARNING_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {warningButtonLabel(level)}
                      {level === 'none' ? ' (guests choose)' : ' (enforced)'}
                    </option>
                  ))}
                </select>
                {!value.canVibrate ? (
                  <span className="text-caption text-negative">
                    Enable vibrate to enforce a warning.
                  </span>
                ) : null}
              </label>
            ) : null}
          </div>
        </ModeColumn>
      </div>
    </div>
  );
}
