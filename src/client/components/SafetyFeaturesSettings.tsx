import { useEffect, useState } from 'react';
import { SafetyFeaturesForm } from './SafetyFeaturesForm';
import {
  formatBudgetUsage,
  normalizeWearerSafety,
  type SafetySnapshot,
  type WearerSafety,
} from '../safety';

type Props = {
  onLoad: () => Promise<SafetySnapshot>;
  onSave: (next: WearerSafety) => Promise<SafetySnapshot>;
  onResetBudget: () => Promise<SafetySnapshot>;
  onRaiseBudget: (add: { shocks?: number; shockMs?: number }) => Promise<SafetySnapshot>;
  queueEnabled?: boolean;
};

/** Menu → Extra features: loads, edits and saves the wearer safety settings. */
export function SafetyFeaturesSettings({
  onLoad,
  onSave,
  onResetBudget,
  onRaiseBudget,
  queueEnabled,
}: Props) {
  const [snap, setSnap] = useState<SafetySnapshot | null>(null);
  const [value, setValue] = useState<WearerSafety | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    onLoad()
      .then((s) => {
        if (cancelled) return;
        setSnap(s);
        setValue(normalizeWearerSafety(s.settings));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [onLoad]);

  if (!value || !snap) {
    return error ? (
      <div className="ps-callout ps-callout--error" role="alert">
        {error}
      </div>
    ) : (
      <div className="text-grey-5 q-pa-md">Loading extra features…</div>
    );
  }

  const run = async (fn: () => Promise<SafetySnapshot>) => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await fn();
      setSnap(next);
      setValue(normalizeWearerSafety(next.settings));
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
        Optional safety tools for when other people control your shockers. E-STOP always works,
        whatever you set here.
      </p>
      {error ? (
        <div className="ps-callout ps-callout--error" role="alert">
          {error}
        </div>
      ) : null}

      {snap.settings.budgetEnabled ? (
        <div className="ps-callout safety-budget-status" aria-live="polite">
          <span>
            <i className="q-icon mdi mdi-battery-charging-60" aria-hidden /> Budget used:{' '}
            <strong>{formatBudgetUsage(snap.settings, snap.budget)}</strong>
          </span>
          <span className="safety-budget-status__actions">
            <button
              type="button"
              className="safety-btn"
              disabled={saving}
              onClick={() => void run(onResetBudget)}
            >
              Reset
            </button>
            {snap.settings.budgetMaxShocks != null ? (
              <button
                type="button"
                className="safety-btn"
                disabled={saving}
                onClick={() => void run(() => onRaiseBudget({ shocks: 5 }))}
              >
                +5 shocks
              </button>
            ) : null}
          </span>
        </div>
      ) : null}

      <SafetyFeaturesForm
        value={value}
        disabled={saving}
        queueEnabled={queueEnabled}
        onChange={(next) => {
          setSaved(false);
          setValue(next);
        }}
      />

      <div className="row items-center justify-end q-gutter-sm">
        {saved ? <span className="safety-saved">Saved</span> : null}
        <button
          type="button"
          className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
          disabled={saving}
          onClick={() => void run(() => onSave(value))}
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
