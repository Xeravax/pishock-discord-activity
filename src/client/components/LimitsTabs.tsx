import type { ReactNode } from 'react';
import type { ModeLimitsValue } from './ModeLimitsEditor';

export type LimitsTab = 'personal' | 'shared';

type TabsProps = {
  value: LimitsTab;
  onChange: (tab: LimitsTab) => void;
  /** Number of shockers shared to Discord (shown as a count badge). */
  sharedCount: number;
};

/** Segmented switch between "My device defaults" and "Discord shared shockers". */
export function LimitsTabs({ value, onChange, sharedCount }: TabsProps) {
  const tabs: Array<{ id: LimitsTab; label: string; icon: string; count?: number }> = [
    { id: 'personal', label: 'My device defaults', icon: 'mdi-account-cog-outline' },
    { id: 'shared', label: 'Discord shared shockers', icon: 'mdi-account-group-outline', count: sharedCount },
  ];
  return (
    <div className="ps-tabs" role="tablist" aria-label="Limit type">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={`ps-tabs__tab${value === tab.id ? ' is-active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <i className={`q-icon mdi ${tab.icon}`} aria-hidden />
          <span className="ps-tabs__label">{tab.label}</span>
          {tab.count != null ? <span className="ps-tabs__count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

function secs(ms: number): string {
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
}

/** Explains what personal defaults do and that they cap every shared shocker. */
export function PersonalLimitsExplainer() {
  return (
    <div className="ps-callout limits-explainer">
      <div className="limits-explainer__title">
        <i className="q-icon mdi mdi-information-outline" aria-hidden /> Your device defaults
      </div>
      <p>
        These are the outer limits for <strong>everything sent to your own shockers</strong> from
        this activity. They also act as the ceiling for your Discord shared shockers:{' '}
        <strong>a shared shocker can never go higher than the maximums here</strong> (or lower than
        the minimums), even if its own limit is set higher.
      </p>
      <p>New shares start from these values, and the stricter warning requirement always wins.</p>
    </div>
  );
}

/** Explains share limits and shows the caps the personal defaults currently impose. */
export function SharedLimitsExplainer({ personal }: { personal: ModeLimitsValue }) {
  const caps: string[] = [];
  if (personal.canShock !== false) {
    caps.push(`Shock ≤ ${personal.shock.maxIntensity}% · ${secs(personal.shock.maxDurationMs)}`);
  }
  if (personal.canVibrate !== false) {
    caps.push(`Vibrate ≤ ${personal.vibrate.maxIntensity}% · ${secs(personal.vibrate.maxDurationMs)}`);
  }
  caps.push(`Beep ≤ ${personal.beep.maxIntensity}% · ${secs(personal.beep.maxDurationMs)}`);
  return (
    <div className="ps-callout limits-explainer">
      <div className="limits-explainer__title">
        <i className="q-icon mdi mdi-information-outline" aria-hidden /> Discord shared shockers
      </div>
      <p>
        Limits for <strong>other people in this activity</strong> controlling the shockers you
        share. Each range is also capped by <strong>My device defaults</strong> and by the
        shocker's PiShock max — the lowest maximum always wins.
      </p>
      <div className="limits-explainer__caps" aria-label="Current caps from your device defaults">
        {caps.map((c) => (
          <span key={c} className="limits-explainer__cap">
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One-line "effective max" summary for a shared shocker. */
export function EffectiveCap({
  share,
  personal,
  deviceMaxIntensity,
  deviceMaxDurationMs,
}: {
  share: ModeLimitsValue;
  personal: ModeLimitsValue;
  deviceMaxIntensity: number;
  deviceMaxDurationMs: number;
}) {
  const i = Math.min(share.shock.maxIntensity, personal.shock.maxIntensity, deviceMaxIntensity);
  const d = Math.min(share.shock.maxDurationMs, personal.shock.maxDurationMs, deviceMaxDurationMs);
  const capped =
    share.shock.maxIntensity > i || share.shock.maxDurationMs > d;
  return (
    <div className={`limits-effective${capped ? ' is-capped' : ''}`}>
      <i className={`q-icon mdi ${capped ? 'mdi-arrow-collapse-down' : 'mdi-check-circle-outline'}`} aria-hidden />
      {capped ? (
        <span>
          Others can shock up to <strong>{i}%</strong> for <strong>{secs(d)}</strong> — limited by
          your device defaults.
        </span>
      ) : (
        <span>
          Others can shock up to <strong>{i}%</strong> for <strong>{secs(d)}</strong>.
        </span>
      )}
    </div>
  );
}

export function TabPanel({ children }: { children: ReactNode }) {
  return (
    <div className="limits-tabpanel" role="tabpanel">
      {children}
    </div>
  );
}
