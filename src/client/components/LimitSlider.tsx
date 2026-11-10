type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown next to the label; defaults to the raw value. */
  formatValue?: (value: number) => string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
};

/** Accessible range control for activity / share ceilings. */
export function LimitSlider({
  label,
  value,
  min,
  max,
  step = 1,
  formatValue,
  hint,
  disabled,
  onChange,
}: Props) {
  const safeMax = Math.max(min, max);
  const clamped = Math.max(min, Math.min(safeMax, value));
  const display = formatValue ? formatValue(clamped) : String(clamped);

  return (
    <label className={`limit-slider${disabled ? ' is-disabled' : ''}`}>
      <span className="limit-slider__head">
        <span className="limit-slider__label">{label}</span>
        <span className="limit-slider__value">{display}</span>
      </span>
      <input
        type="range"
        className="limit-slider__input"
        min={min}
        max={safeMax}
        step={step}
        value={clamped}
        disabled={disabled}
        aria-valuemin={min}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
        aria-valuetext={display}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <span className="limit-slider__hint">{hint}</span> : null}
    </label>
  );
}

export function formatIntensityPct(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatDurationMs(value: number): string {
  const sec = value / 1000;
  const text = Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
  return `${text}s`;
}
