import type { ShockerView } from './ShockerCard';
import type { PerTargetSettings, MultiOperation } from './official/helpers';
import {
  shockerUsableDur,
  shockerUsableInt,
  shockerUsableMinDur,
  shockerUsableMinInt,
} from './official/helpers';
import {
  WARNING_LEVELS,
  atLeastWarning,
  normalizeWarningLevel,
  warningButtonLabel,
  warningRank,
} from '../../shared/warning';

type Props = {
  shockers: ShockerView[];
  selectedIds: number[];
  /** Individual mode: per-target action / intensity / duration / warning. */
  individual: boolean;
  values: Record<string, PerTargetSettings>;
  defaults: PerTargetSettings;
  keyFor: (s: ShockerView) => string;
  colorFor: (s: ShockerView) => string;
  personName: (discordUserId: string) => string;
  skipped?: Record<number, string>;
  onToggle: (id: number) => void;
  onSetGroup: (ids: number[], selected: boolean) => void;
  onValue: (key: string, value: PerTargetSettings) => void;
  /** Fire each selected target with its own plan. */
  onSend?: () => void;
  sendBusy?: boolean;
};

type Group = {
  key: string;
  label: string;
  hubs: Array<{ key: string; label: string; shockers: ShockerView[] }>;
};

function blockedReason(s: ShockerView): string | null {
  if (s.emergencyStop) return 'E-STOP';
  if (s.paused) return 'paused';
  return null;
}

function modeAllowed(s: ShockerView, operation: MultiOperation): boolean {
  if (operation === 'shock') return Boolean(s.canShock);
  if (operation === 'vibrate') return Boolean(s.canVibrate);
  return Boolean(s.canBeep);
}

/** Group person → hub → shocker, keeping the incoming order. */
function groupTargets(shockers: ShockerView[], personName: (id: string) => string): Group[] {
  const groups = new Map<string, Group>();
  for (const s of shockers) {
    const gKey = s.targetDiscordUserId ? `u:${s.targetDiscordUserId}` : s.owned ? 'own' : 'shared';
    const gLabel = s.targetDiscordUserId
      ? personName(s.targetDiscordUserId)
      : s.owned
        ? 'Your shockers'
        : 'Shared with you';
    let g = groups.get(gKey);
    if (!g) {
      g = { key: gKey, label: gLabel, hubs: [] };
      groups.set(gKey, g);
    }
    const hKey = `${gKey}:${s.clientId ?? s.hubName ?? 'hub'}`;
    let h = g.hubs.find((x) => x.key === hKey);
    if (!h) {
      h = { key: hKey, label: s.hubName || 'Hub', shockers: [] };
      g.hubs.push(h);
    }
    h.shockers.push(s);
  }
  return [...groups.values()];
}

function GroupCheck({
  ids,
  selected,
  label,
  onSetGroup,
}: {
  ids: number[];
  selected: Set<number>;
  label: string;
  onSetGroup: (ids: number[], on: boolean) => void;
}) {
  const count = ids.filter((id) => selected.has(id)).length;
  const all = count === ids.length && ids.length > 0;
  return (
    <input
      type="checkbox"
      className="ps-check"
      aria-label={`Select all of ${label}`}
      checked={all}
      ref={(el) => {
        if (el) el.indeterminate = count > 0 && !all;
      }}
      onChange={() => onSetGroup(ids, !all)}
    />
  );
}

const ACTIONS: Array<{ id: MultiOperation; label: string }> = [
  { id: 'shock', label: 'Shock' },
  { id: 'vibrate', label: 'Vibrate' },
  { id: 'beep', label: 'Beep' },
];

/**
 * Multishock target tray: pick targets across people and hubs, with group
 * checkboxes and (Individual mode) per-target action, intensity, duration, warning.
 */
export function MultiTargetTray(props: Props) {
  const { shockers, selectedIds, individual } = props;
  const selected = new Set(selectedIds);
  const groups = groupTargets(shockers, props.personName);
  const allIds = shockers.map((s) => s.id);
  const usable = shockers.filter((s) => selected.has(s.id) && !blockedReason(s)).length;

  return (
    <div className="multi-tray" role="group" aria-label="Multishock targets">
      <div className="multi-tray__head">
        <span>
          Targets · <strong>{usable}</strong> of {shockers.length} ready
        </span>
        <span className="multi-tray__bulk">
          <button type="button" className="safety-btn" onClick={() => props.onSetGroup(allIds, true)}>
            Select all
          </button>
          <button
            type="button"
            className="safety-btn safety-btn--ghost"
            onClick={() => props.onSetGroup(allIds, false)}
          >
            None
          </button>
        </span>
      </div>
      {groups.map((g) => {
        const gIds = g.hubs.flatMap((h) => h.shockers.map((s) => s.id));
        return (
          <div key={g.key} className="multi-tray__group">
            <label className="multi-tray__group-head">
              <GroupCheck ids={gIds} selected={selected} label={g.label} onSetGroup={props.onSetGroup} />
              <span className="multi-tray__person">{g.label}</span>
            </label>
            {g.hubs.map((h) => {
              const hIds = h.shockers.map((s) => s.id);
              return (
                <div key={h.key} className="multi-tray__hub">
                  {g.hubs.length > 1 || h.shockers.length > 1 ? (
                    <label className="multi-tray__hub-head">
                      <GroupCheck
                        ids={hIds}
                        selected={selected}
                        label={h.label}
                        onSetGroup={props.onSetGroup}
                      />
                      <span>{h.label}</span>
                    </label>
                  ) : null}
                  {h.shockers.map((s) => {
                    const on = selected.has(s.id);
                    const blocked = blockedReason(s);
                    const key = props.keyFor(s);
                    const stored = props.values[key] ?? props.defaults;
                    const operation: MultiOperation = individual ? stored.operation : 'shock';
                    const max = shockerUsableInt(s, operation);
                    const min = shockerUsableMinInt(s, operation);
                    const maxD = shockerUsableDur(s, operation);
                    const minD = shockerUsableMinDur(s, operation);
                    const intensity = Math.max(min, Math.min(max, stored.intensity));
                    const durationMs = Math.max(minD, Math.min(maxD, stored.durationMs));
                    const floor = normalizeWarningLevel(s.requiredWarningLevel);
                    const warningLevel = atLeastWarning(
                      normalizeWarningLevel(stored.warningLevel),
                      floor,
                    );
                    const skippedWhy = props.skipped?.[s.id];
                    const set = (patch: Partial<PerTargetSettings>) => {
                      const nextOp = patch.operation ?? operation;
                      const nextMax = shockerUsableInt(s, nextOp);
                      const nextMin = shockerUsableMinInt(s, nextOp);
                      const nextMaxD = shockerUsableDur(s, nextOp);
                      const nextMinD = shockerUsableMinDur(s, nextOp);
                      props.onValue(key, {
                        operation: nextOp,
                        intensity: Math.max(
                          nextMin,
                          Math.min(nextMax, patch.intensity ?? intensity),
                        ),
                        durationMs: Math.max(
                          nextMinD,
                          Math.min(nextMaxD, patch.durationMs ?? durationMs),
                        ),
                        warningLevel: atLeastWarning(
                          normalizeWarningLevel(patch.warningLevel ?? warningLevel),
                          floor,
                        ),
                      });
                    };
                    return (
                      <div
                        key={key}
                        className={`multi-tray__row${on ? ' is-on' : ''}${blocked ? ' is-blocked' : ''}`}
                        style={{ ['--tray-color' as string]: props.colorFor(s) }}
                      >
                        <label className="multi-tray__row-main">
                          <input
                            type="checkbox"
                            className="ps-check"
                            checked={on}
                            onChange={() => props.onToggle(s.id)}
                          />
                          <span className="multi-tray__swatch" aria-hidden />
                          <span className="multi-tray__name">
                            {s.name}
                            {h.label && g.hubs.length > 1 ? (
                              <span className="multi-tray__where"> · {h.label}</span>
                            ) : null}
                          </span>
                          <span className="multi-tray__meta">
                            {blocked
                              ? `${blocked} — will be skipped`
                              : individual && on && !modeAllowed(s, operation)
                                ? `${operation} not allowed — pick another action`
                                : operation === 'beep'
                                  ? `max ${(maxD / 1000).toFixed(1)}s`
                                  : `max ${max}% · ${(maxD / 1000).toFixed(1)}s`}
                            {skippedWhy && !blocked ? ` · skipped: ${skippedWhy}` : ''}
                          </span>
                        </label>
                        {individual && on && !blocked ? (
                          <div className="multi-tray__controls">
                            <div
                              className="multi-tray__actions"
                              role="radiogroup"
                              aria-label={`${s.name} action`}
                            >
                              {ACTIONS.map((a) => {
                                const allowed = modeAllowed(s, a.id);
                                return (
                                  <button
                                    key={a.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={operation === a.id}
                                    disabled={!allowed}
                                    className={`multi-tray__action${operation === a.id ? ' is-active' : ''}`}
                                    onClick={() => set({ operation: a.id })}
                                  >
                                    {a.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="multi-tray__sliders">
                              {operation === 'beep' ? null : (
                                <label>
                                  <span>{intensity}%</span>
                                  <input
                                    type="range"
                                    min={min}
                                    max={max}
                                    value={intensity}
                                    aria-label={`${s.name} intensity`}
                                    onChange={(e) =>
                                      set({ intensity: Number(e.target.value) })
                                    }
                                  />
                                </label>
                              )}
                              <label>
                                <span>{(durationMs / 1000).toFixed(1)}s</span>
                                <input
                                  type="range"
                                  min={Math.min(maxD, Math.max(100, Math.ceil(minD / 100) * 100))}
                                  max={maxD}
                                  step={100}
                                  value={durationMs}
                                  aria-label={`${s.name} duration`}
                                  onChange={(e) =>
                                    set({ durationMs: Number(e.target.value) })
                                  }
                                />
                              </label>
                            </div>
                            {operation === 'shock' ? (
                              <div
                                className="multi-tray__warnings"
                                role="radiogroup"
                                aria-label={`${s.name} warning`}
                              >
                                {WARNING_LEVELS.filter(
                                  (level) => warningRank(level) >= warningRank(floor),
                                ).map((level) => (
                                  <button
                                    key={level}
                                    type="button"
                                    role="radio"
                                    aria-checked={warningLevel === level}
                                    className={`multi-tray__action${warningLevel === level ? ' is-active' : ''}`}
                                    onClick={() => set({ warningLevel: level })}
                                  >
                                    {warningButtonLabel(level)}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
      {props.onSend ? (
        <div className="multi-tray__send">
          <button
            type="button"
            className="safety-btn safety-btn--accept"
            disabled={props.sendBusy || usable === 0}
            onClick={props.onSend}
          >
            Send to {usable} {usable === 1 ? 'target' : 'targets'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
