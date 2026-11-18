import type { ShockerView } from './ShockerCard';

export type TargetValue = { intensity: number; durationMs: number };

type Props = {
  shockers: ShockerView[];
  selectedIds: number[];
  /** Individual mode: per-target sliders. */
  individual: boolean;
  values: Record<string, TargetValue>;
  defaults: TargetValue;
  keyFor: (s: ShockerView) => string;
  colorFor: (s: ShockerView) => string;
  personName: (discordUserId: string) => string;
  maxIntensityFor: (s: ShockerView) => number;
  minIntensityFor: (s: ShockerView) => number;
  maxDurationFor: (s: ShockerView) => number;
  minDurationFor: (s: ShockerView) => number;
  /** Targets that were skipped on the last fire, with the reason. */
  skipped?: Record<number, string>;
  onToggle: (id: number) => void;
  onSetGroup: (ids: number[], selected: boolean) => void;
  onValue: (key: string, value: TargetValue) => void;
};

type Group = { key: string; label: string; hubs: Array<{ key: string; label: string; shockers: ShockerView[] }> };

function blockedReason(s: ShockerView): string | null {
  if (s.emergencyStop) return 'E-STOP';
  if (s.paused) return 'paused';
  return null;
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

/**
 * Multishock target tray: one place to pick targets across people and hubs, with
 * group checkboxes and (Individual mode) per-target intensity + duration.
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
          <button type="button" className="safety-btn safety-btn--ghost" onClick={() => props.onSetGroup(allIds, false)}>
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
                      <GroupCheck ids={hIds} selected={selected} label={h.label} onSetGroup={props.onSetGroup} />
                      <span>{h.label}</span>
                    </label>
                  ) : null}
                  {h.shockers.map((s) => {
                    const on = selected.has(s.id);
                    const blocked = blockedReason(s);
                    const key = props.keyFor(s);
                    const max = props.maxIntensityFor(s);
                    const min = props.minIntensityFor(s);
                    const maxD = props.maxDurationFor(s);
                    const minD = props.minDurationFor(s);
                    const v = props.values[key] ?? props.defaults;
                    const intensity = Math.max(min, Math.min(max, v.intensity));
                    const durationMs = Math.max(minD, Math.min(maxD, v.durationMs));
                    const skippedWhy = props.skipped?.[s.id];
                    return (
                      <div
                        key={`${key}`}
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
                          <span className="multi-tray__name">{s.name}</span>
                          <span className="multi-tray__meta">
                            {blocked ? `${blocked} — will be skipped` : `max ${max}%`}
                            {skippedWhy && !blocked ? ` · skipped: ${skippedWhy}` : ''}
                          </span>
                        </label>
                        {individual && on && !blocked ? (
                          <div className="multi-tray__sliders">
                            <label>
                              <span>{intensity}%</span>
                              <input
                                type="range"
                                min={min}
                                max={max}
                                value={intensity}
                                aria-label={`${s.name} intensity`}
                                onChange={(e) =>
                                  props.onValue(key, { intensity: Number(e.target.value), durationMs })
                                }
                              />
                            </label>
                            <label>
                              <span>{(durationMs / 1000).toFixed(1)}s</span>
                              <input
                                type="range"
                                min={Math.max(100, Math.ceil(minD / 100) * 100)}
                                max={maxD}
                                step={100}
                                value={durationMs}
                                aria-label={`${s.name} duration`}
                                onChange={(e) =>
                                  props.onValue(key, { intensity, durationMs: Number(e.target.value) })
                                }
                              />
                            </label>
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
    </div>
  );
}
