import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { clamp, DURATION_PRESETS_SEC, formatDurationSec } from './helpers';

export function DurationMetric({
  valueMs,
  minMs = 16,
  maxMs,
  open,
  disabled,
  side,
  limitMarkers = [],
  onToggle,
  onSelect,
}: {
  valueMs: number;
  minMs?: number;
  maxMs: number;
  open: boolean;
  disabled?: boolean;
  side: 'left' | 'right';
  limitMarkers?: Array<{
    key: string;
    color: string;
    durationMs: number;
    label: string;
  }>;
  onToggle: () => void;
  onSelect: (ms: number) => void;
}) {
  const floor = Math.max(16, Math.min(maxMs, minMs));
  const presets = DURATION_PRESETS_SEC.filter((sec) => {
    const ms = Math.round(sec * 1000);
    return ms >= floor && ms <= maxMs;
  });
  const presetChoices = presets.map((sec) => {
    const ms = Math.round(sec * 1000);
    const label = sec < 1 ? `.${String(sec).split('.')[1]}` : String(sec);
    return { choiceKey: String(sec), ms, label };
  });
  if (floor <= maxMs && !presetChoices.some((c) => c.ms === floor)) {
    presetChoices.unshift({
      choiceKey: `floor-${floor}`,
      ms: floor,
      label: formatDurationSec(floor),
    });
  }
  if (presetChoices.length === 0 && floor <= maxMs) {
    const lowest = Math.round(DURATION_PRESETS_SEC[0] * 1000);
    const highest = Math.round(DURATION_PRESETS_SEC[DURATION_PRESETS_SEC.length - 1]! * 1000);
    const endpoint = maxMs < lowest ? maxMs : floor > highest ? floor : maxMs;
    presetChoices.push({
      choiceKey: `endpoint-${endpoint}`,
      ms: endpoint,
      label: formatDurationSec(endpoint),
    });
  }
  const showLimits = limitMarkers.length > 1 && maxMs > 0;
  return (
    <div className="official-duration-wrap">
      <MetricStack
        icon="mdi-clock"
        value={formatDurationSec(valueMs)}
        label="Duration"
        disabled={disabled}
        onClick={onToggle}
      />
      {showLimits ? (
        <div className="official-duration-limits" aria-label="Per-shocker duration limits">
          {limitMarkers
            .slice()
            .sort((a, b) => a.durationMs - b.durationMs)
            .map((m) => {
              const over = valueMs > m.durationMs;
              return (
                <span
                  key={m.key}
                  className={`official-duration-limit-circle${over ? ' is-over' : ''}`}
                  title={`${m.label}: ${formatDurationSec(m.durationMs)}s max`}
                  style={{
                    borderColor: m.color,
                    color: m.color,
                    boxShadow: over ? `0 0 0 1px ${m.color}` : undefined,
                  }}
                >
                  {formatDurationSec(m.durationMs)}s
                </span>
              );
            })}
        </div>
      ) : null}
      {open && !disabled ? (
        <div
          className={`official-duration-menu official-duration-menu--${side}`}
          role="listbox"
          aria-label="Duration presets"
        >
          {presetChoices.map(({ choiceKey, ms, label }) => {
            const selected = valueMs === ms;
            const matchingLimits = showLimits
              ? limitMarkers.filter((m) => m.durationMs === ms)
              : [];
            const overLimit = showLimits
              ? limitMarkers.filter((m) => ms > m.durationMs)
              : [];
            const ringColor = matchingLimits[0]?.color;
            return (
              <button
                key={choiceKey}
                type="button"
                role="option"
                aria-selected={selected}
                className={`official-duration-chip${selected ? ' is-selected' : ''}${
                  matchingLimits.length ? ' has-limit-ring' : ''
                }${overLimit.length ? ' has-over-limit' : ''}`}
                title={
                  matchingLimits.length
                    ? `Limit for: ${matchingLimits.map((m) => m.label).join(', ')}`
                    : overLimit.length
                      ? `Over limit for: ${overLimit.map((m) => m.label).join(', ')}`
                      : undefined
                }
                onClick={() => onSelect(ms)}
                style={
                  ringColor
                    ? {
                        boxShadow: `0 0 0 2px ${ringColor}${
                          matchingLimits[1]
                            ? `, 0 0 0 4px ${matchingLimits[1].color}`
                            : ''
                        }`,
                      }
                    : undefined
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function MetricStack({
  icon,
  value,
  label,
  filled,
  active,
  disabled,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}: {
  icon: string;
  value: string;
  label: string;
  filled?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onPointerDown?: (ev: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
}) {
  return (
    <div className="flex column" style={{ borderRadius: 3 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => {
          if (onPointerDown) e.preventDefault();
        }}
        className={`q-btn q-btn-item non-selectable no-outline q-btn--${
          filled ? 'standard bg-secondary text-dark' : 'outline text-secondary'
        } q-btn--rectangle q-btn--actionable q-focusable q-hoverable q-btn--wrap`}
        style={{
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          boxShadow: active ? 'inset 0 0 0 2px #fff' : undefined,
          touchAction: onPointerDown ? 'none' : undefined,
          userSelect: onPointerDown ? 'none' : undefined,
        }}
      >
        <span className="q-btn__wrapper col row q-anchor--skip">
          <span className="q-btn__content text-center col items-center q-anchor--skip justify-center column">
            <i className={`q-icon mdi ${icon}`} aria-hidden />
            <span className="block">{value}</span>
          </span>
        </span>
      </button>
      <div
        className={`q-chip row inline no-wrap items-center text-center no-margin ${
          filled ? 'bg-dark text-secondary' : 'bg-secondary text-dark'
        } border-color-secondary q-chip--dense q-chip--square`}
        style={{
          fontSize: 10,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          border: '1px solid',
        }}
      >
        <div className="q-chip__content col row no-wrap items-center q-anchor--skip">
          <div className="full-width text-center text-caption">
            <span>{label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CenterControl({
  icon,
  caption,
  chip,
  outline,
  flat,
  danger,
  padding,
  active,
  disabled,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}: {
  icon: string;
  caption?: string;
  chip: string;
  outline?: boolean;
  flat?: boolean;
  danger?: boolean;
  padding?: number;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onPointerDown?: (ev: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
}) {
  const btnClass = outline
    ? 'q-btn--outline text-secondary'
    : flat
      ? 'q-btn--flat text-secondary'
      : danger
        ? 'q-btn--standard bg-secondary text-negative'
        : 'q-btn--standard bg-secondary text-dark';

  return (
    <div className="flex column">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => {
          if (onPointerDown) e.preventDefault();
        }}
        className={`q-btn q-btn-item non-selectable no-outline ${btnClass} q-btn--rectangle q-btn--actionable q-focusable q-hoverable q-btn--wrap ${
          outline || flat ? 'q-btn--dense' : ''
        } ${active && !danger ? 'bg-secondary text-dark' : ''} ${
          active && danger ? 'bg-negative text-white' : ''
        }`}
        style={{
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          fontSize: flat ? 10 : undefined,
          boxShadow: active ? 'inset 0 0 0 2px #fff' : undefined,
          touchAction: onPointerDown ? 'none' : undefined,
          userSelect: onPointerDown ? 'none' : undefined,
        }}
      >
        <span
          className="q-btn__wrapper col row q-anchor--skip"
          style={padding ? { padding, minWidth: 0, minHeight: 0 } : undefined}
        >
          <span
            className={`q-btn__content text-center col items-center q-anchor--skip justify-center ${
              caption ? 'column' : 'row'
            }`}
          >
            <i className={`q-icon mdi ${icon}`} aria-hidden />
            {caption ? <div className="text-caption" style={{ fontSize: 9 }}>{caption}</div> : null}
          </span>
        </span>
      </button>
      <div
        className={`q-chip row inline no-wrap items-center text-center no-margin ${
          active && danger
            ? 'bg-negative text-white'
            : outline
              ? 'bg-secondary text-dark'
              : 'bg-dark text-secondary'
        } border-color-secondary q-chip--dense ${flat ? '' : 'q-chip--square'}`}
        style={{
          fontSize: 10,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          border: '1px solid',
        }}
      >
        <div className="q-chip__content col row no-wrap items-center q-anchor--skip">
          <div className="full-width text-center text-caption">
            <span>{chip}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function IntensityEdgeRail({
  place,
  disabled,
  random,
  showRandom,
  onUp,
  onDown,
  onToggleRandom,
}: {
  /** Shock rail sits left of its track; vibrate rail sits right of its track. */
  place: 'shock' | 'vibrate';
  disabled?: boolean;
  random?: boolean;
  showRandom?: boolean;
  onUp: () => void;
  onDown: () => void;
  onToggleRandom?: () => void;
}) {
  const btnClass =
    'q-btn q-btn-item non-selectable no-outline q-my-xs q-py-xs bg-dark q-btn--outline q-btn--rectangle text-secondary q-btn--actionable q-focusable q-hoverable q-btn--wrap q-btn--dense official-slider-rail__btn';
  return (
    <div className={`official-slider-rail official-slider-rail--${place}`}>
      <button
        type="button"
        className={btnClass}
        disabled={disabled}
        aria-label="Increase intensity"
        onClick={onUp}
      >
        <span className="q-btn__wrapper col row q-anchor--skip">
          <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
            <i className="q-icon mdi mdi-chevron-double-up" aria-hidden />
          </span>
        </span>
      </button>
      {showRandom ? (
        <button
          type="button"
          className={`${btnClass} official-slider-rail__btn--dice${random ? ' is-active' : ''}`}
          disabled={disabled}
          aria-pressed={random}
          aria-label="Random intensity"
          title="Random intensity"
          onClick={onToggleRandom}
        >
          <span className="q-btn__wrapper col row q-anchor--skip">
            <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
              <i className="q-icon mdi mdi-dice-3" aria-hidden />
            </span>
          </span>
        </button>
      ) : null}
      <button
        type="button"
        className={btnClass}
        disabled={disabled}
        aria-label="Decrease intensity"
        onClick={onDown}
      >
        <span className="q-btn__wrapper col row q-anchor--skip">
          <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
            <i className="q-icon mdi mdi-chevron-double-down" aria-hidden />
          </span>
        </span>
      </button>
    </div>
  );
}

export function VerticalQuasarSlider({
  value,
  minValue = 0,
  maxValue = 0,
  random = false,
  deviceMax,
  activityMin = 1,
  activityMax,
  limitMarkers = [],
  onChange,
  onChangeMin,
  onChangeMax,
  disabled,
  trackMargin = 'left',
  rail,
}: {
  value: number;
  minValue?: number;
  maxValue?: number;
  random?: boolean;
  /** PiShock hard ceiling — red zone above this (scale 0–100) */
  deviceMax: number;
  /** Activity floor — shown as usable-band start; thumb may still sit below */
  activityMin?: number;
  /** Highest usable Activity Limit among the selection — thumb may reach this */
  activityMax: number;
  /** Multishock: per-person limit ticks (color-coded); optional value = set intensity */
  limitMarkers?: Array<{
    key: string;
    color: string;
    intensity: number;
    value?: number;
    label: string;
  }>;
  onChange: (n: number) => void;
  onChangeMin?: (n: number) => void;
  onChangeMax?: (n: number) => void;
  disabled?: boolean;
  /** Site shock slider uses a left margin; vibrate uses a right margin. */
  trackMargin?: 'left' | 'right';
  rail?: ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<'value' | 'min' | 'max' | null>(null);
  const scaleMax = 100;
  const device = clamp(deviceMax, 1, scaleMax);
  const activity = clamp(activityMax, 1, device);
  // Keep floor ≤ activity even if settings briefly invert.
  const floor = Math.min(activity, Math.max(1, activityMin || 1));
  // Thumb moves freely from 0..activity; operate path still clamps into [floor, activity].
  const usable = clamp(value, 0, activity);
  const lo = clamp(Math.min(minValue, maxValue), 0, activity);
  const hi = clamp(Math.max(minValue, maxValue), 0, activity);
  const pct = (usable / scaleMax) * 100;
  const loPct = (lo / scaleMax) * 100;
  const hiPct = (hi / scaleMax) * 100;
  const floorPct = (floor / scaleMax) * 100;
  const bandHeight = Math.max(0, (activity / scaleMax) * 100 - floorPct);
  const belowFloor = !random && usable < floor;
  const redFrom = device;
  const redHeight = Math.max(0, 100 - redFrom);
  const activityCapBottom = activity;

  const applyFromClientY = (clientY: number, mode: 'value' | 'min' | 'max') => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    const raw = Math.round(ratio * scaleMax);
    if (raw > device) return;
    const next = clamp(raw, 0, activity);
    if (mode === 'value') {
      onChange(next);
      return;
    }
    if (mode === 'min') {
      onChangeMin?.(clamp(next, 0, hi));
      return;
    }
    onChangeMax?.(clamp(next, lo, activity));
  };

  const pickHandle = (clientY: number): 'value' | 'min' | 'max' => {
    if (!random) return 'value';
    const el = trackRef.current;
    if (!el) return 'max';
    const rect = el.getBoundingClientRect();
    const ratio = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    const at = ratio * scaleMax;
    return Math.abs(at - lo) <= Math.abs(at - hi) ? 'min' : 'max';
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    const mode = pickHandle(e.clientY);
    dragRef.current = mode;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    applyFromClientY(e.clientY, mode);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    applyFromClientY(e.clientY, dragRef.current);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const nudge = (delta: number) => {
    if (disabled) return;
    if (!random) {
      onChange(clamp(usable + delta, 0, activity));
      return;
    }
    if (delta > 0) onChangeMax?.(clamp(hi + delta, lo, activity));
    else onChangeMin?.(clamp(lo + delta, 0, hi));
  };

  return (
    <div
      className={`q-card__section q-card__section--vert official-slider-col official-slider-col--${
        trackMargin === 'left' ? 'shock' : 'vibrate'
      }`}
    >
      {rail}
      <div className="flex column items-center q-gutter-sm justify-between">
        <div
          role="slider"
          aria-valuemin={0}
          aria-valuemax={activity}
          aria-orientation="vertical"
          aria-valuenow={random ? hi : usable}
          aria-valuetext={
            random
              ? `${lo}-${hi}`
              : belowFloor
                ? `${usable} (min ${floor})`
                : String(usable)
          }
          className="q-slider q-slider--v q-slider--inactive inline no-wrap row q-slider--enabled q-slider--editable q-slider--label q-slider--dark q-slider--dense q-slider--dense--v"
        >
          <div
            ref={trackRef}
            tabIndex={disabled ? -1 : 0}
            className="q-slider__track-container q-slider__track-container--v official-slider-hit"
            style={{ touchAction: 'none', cursor: disabled ? 'not-allowed' : 'ns-resize' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                e.preventDefault();
                nudge(1);
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                e.preventDefault();
                nudge(-1);
              }
            }}
          >
            <div
              className="q-slider__track relative-position no-outline"
              style={{ width: limitMarkers.length > 1 ? Math.min(4 + limitMarkers.length * 4, 22) : 5 }}
            >
              <div className="q-slider__inner absolute" style={{ bottom: '0%', height: '100%' }} />
              {floor > 1 ? (
                <div
                  className="absolute"
                  title={`Below activity minimum (${floor}%)`}
                  style={{
                    left: 0,
                    right: 0,
                    bottom: '0%',
                    height: `${floorPct}%`,
                    background: 'rgba(255, 255, 255, 0.06)',
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
              {bandHeight > 0 ? (
                <div
                  className="absolute official-slider-band"
                  title={`Activity band ${floor}% – ${activity}%`}
                  style={{
                    left: 0,
                    right: 0,
                    bottom: `${floorPct}%`,
                    height: `${bandHeight}%`,
                    background: 'rgba(121, 198, 219, 0.22)',
                    boxShadow: 'inset 0 0 0 1px rgba(121, 198, 219, 0.45)',
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
              {activity < device ? (
                <div
                  className="absolute"
                  title="Above Activity Limit"
                  style={{
                    left: 0,
                    right: 0,
                    bottom: `${activityCapBottom}%`,
                    height: `${device - activity}%`,
                    background: 'rgba(244, 214, 0, 0.35)',
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
              {redHeight > 0 ? (
                <div
                  className="absolute"
                  title="Above PiShock device limit"
                  style={{
                    left: 0,
                    right: 0,
                    bottom: `${redFrom}%`,
                    height: `${redHeight}%`,
                    background: 'rgba(229, 57, 53, 0.55)',
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
              {limitMarkers.length > 1 ? (
                <div
                  className="absolute"
                  style={{
                    left: 0,
                    right: 0,
                    bottom: 0,
                    top: 0,
                    display: 'flex',
                    gap: 1,
                    pointerEvents: 'none',
                    zIndex: 1,
                  }}
                >
                  {limitMarkers.map((m) => {
                    const setValue =
                      m.value != null ? clamp(m.value, 0, m.intensity) : usable;
                    const fillTo = random
                      ? Math.min(hi, m.intensity)
                      : Math.min(setValue, m.intensity);
                    const fillFrom = random ? Math.min(lo, fillTo) : 0;
                    const height = Math.max(0, fillTo - fillFrom);
                    return (
                      <div key={m.key} style={{ flex: 1, position: 'relative' }}>
                        <div
                          title={
                            m.value != null
                              ? `${m.label} · ${setValue}/${m.intensity}%`
                              : `${m.label} · up to ${m.intensity}%`
                          }
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: `${(fillFrom / scaleMax) * 100}%`,
                            height: `${(height / scaleMax) * 100}%`,
                            background: m.color,
                            borderRadius: 1,
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            left: -1,
                            right: -1,
                            bottom: `calc(${(clamp(m.intensity, 0, scaleMax) / scaleMax) * 100}% - 1px)`,
                            height: 2,
                            background: m.color,
                            boxShadow: '0 0 0 1px rgba(0,0,0,.35)',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : random ? (
                <div
                  className="q-slider__selection absolute text-secondary"
                  style={{ bottom: `${loPct}%`, height: `${Math.max(0, hiPct - loPct)}%` }}
                />
              ) : (
                <div
                  className="q-slider__selection absolute text-secondary"
                  style={{
                    bottom: '0%',
                    height: `${pct}%`,
                    opacity: belowFloor ? 0.45 : 1,
                  }}
                />
              )}
              {floor > 1 ? (
                <div
                  className="absolute"
                  title={`Activity minimum ${floor}%`}
                  style={{
                    left: -3,
                    right: -3,
                    bottom: `calc(${floorPct}% - 1px)`,
                    height: 2,
                    background: '#79c6db',
                    boxShadow: '0 0 0 1px rgba(0,0,0,.4)',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                />
              ) : null}
              <div
                className="q-slider__markers q-slider__markers--v absolute overflow-hidden"
                style={{ bottom: '0%', height: '100%', backgroundSize: '2px 10%' }}
              />
              {random ? (
                <>
                  <div
                    className="q-slider__thumb q-slider__thumb--v q-slider__thumb--v-rtl absolute non-selectable text-secondary"
                    style={{ width: 20, height: 20, bottom: `${loPct}%` }}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden className="q-slider__thumb-shape absolute-full">
                      <path d="M 4, 10 a 6,6 0 1,0 12,0 a 6,6 0 1,0 -12,0" />
                    </svg>
                  </div>
                  <div
                    className="q-slider__thumb q-slider__thumb--v q-slider__thumb--v-rtl absolute non-selectable text-secondary"
                    style={{ width: 20, height: 20, bottom: `${hiPct}%` }}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden className="q-slider__thumb-shape absolute-full">
                      <path d="M 4, 10 a 6,6 0 1,0 12,0 a 6,6 0 1,0 -12,0" />
                    </svg>
                  </div>
                </>
              ) : (
                <div
                  className={`q-slider__thumb q-slider__thumb--v q-slider__thumb--v-rtl absolute non-selectable ${
                    belowFloor ? 'text-grey-5' : 'text-secondary'
                  }`}
                  style={{ width: 20, height: 20, bottom: `${pct}%` }}
                >
                  <svg viewBox="0 0 20 20" aria-hidden className="q-slider__thumb-shape absolute-full">
                    <path d="M 4, 10 a 6,6 0 1,0 12,0 a 6,6 0 1,0 -12,0" />
                  </svg>
                  <div className="q-slider__focus-ring fit" />
                </div>
              )}
            </div>
          </div>
        </div>
        <i className="q-icon mdi mdi-speedometer" style={{ fontSize: 24 }} aria-hidden />
      </div>
    </div>
  );
}
