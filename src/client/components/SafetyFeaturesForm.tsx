import { useState, type ReactNode } from 'react';
import { LimitSlider, formatDurationMs } from './LimitSlider';
import type { BudgetPeriod, WearerSafety } from '../safety';

type FeatureId = 'favorites' | 'approve' | 'cooldown' | 'budget' | 'checkin' | 'person';

type Props = {
  value: WearerSafety;
  onChange: (next: WearerSafety) => void;
  disabled?: boolean;
  /** Command queue is on — cooldown copy explains how they combine. */
  queueEnabled?: boolean;
  /** Extra sections (e.g. the command queue in setup) rendered first in the same list. */
  leading?: ReactNode;
};

function formatSeconds(ms: number): string {
  if (ms <= 0) return 'Off';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function formatMinutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`;
}

function Feature({
  id,
  open,
  onToggle,
  icon,
  title,
  summary,
  on,
  children,
}: {
  id: FeatureId;
  open: boolean;
  onToggle: (id: FeatureId) => void;
  icon: string;
  title: string;
  summary: string;
  on: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`setup-feature${open ? ' is-open' : ''}${on ? ' is-on' : ''}`}>
      <button
        type="button"
        className="setup-feature__head"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span className="setup-feature__icon">
          <i className={`q-icon mdi ${icon}`} aria-hidden />
        </span>
        <span>
          <span className="setup-feature__title">{title}</span>
          <span className="setup-feature__summary">{summary}</span>
        </span>
        <i
          className={`q-icon mdi setup-feature__chevron ${open ? 'mdi-chevron-up' : 'mdi-chevron-down'}`}
          aria-hidden
        />
      </button>
      {open ? <div className="setup-feature__body">{children}</div> : null}
    </section>
  );
}

function Switch({
  checked,
  title,
  hint,
  disabled,
  onChange,
}: {
  checked: boolean;
  title: string;
  hint: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`auth-boot__shocker${checked ? ' is-on' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="auth-boot__shocker-copy">
        <span className="auth-boot__shocker-name">{title}</span>
        <span className="auth-boot__shocker-hub">{hint}</span>
      </span>
    </label>
  );
}

const PERIODS: Array<{ id: BudgetPeriod; title: string; hint: string }> = [
  { id: 'session', title: 'Per session', hint: 'Refills after you’ve been away 10 min' },
  { id: 'day', title: 'Per day', hint: 'Refills at midnight (your timezone)' },
  { id: 'manual', title: 'Manual', hint: 'Only refills when you reset it' },
];

/**
 * Wearer "extra features": favorites only, approve each, cooldowns, shock budget,
 * check-ins and per-person limits. Controlled; used in setup and the menu dialog.
 */
export function SafetyFeaturesForm({ value, onChange, disabled, queueEnabled, leading }: Props) {
  const [open, setOpen] = useState<FeatureId | null>(null);
  const toggle = (id: FeatureId) => setOpen((cur) => (cur === id ? null : id));
  const set = (patch: Partial<WearerSafety>) => onChange({ ...value, ...patch });
  const cooldownOn = value.cooldownPerSenderMs > 0 || value.cooldownGlobalMs > 0;

  return (
    <div className="setup-features">
      {leading}

      <Feature
        id="favorites"
        open={open === 'favorites'}
        onToggle={toggle}
        icon="mdi-star-outline"
        title="Favorites only"
        on={value.favoritesOnly}
        summary={
          value.favoritesOnly
            ? 'On — only people you star can control you'
            : 'Off — anyone in the activity can control you'
        }
      >
        <Switch
          checked={value.favoritesOnly}
          disabled={disabled}
          title="Only my favorites"
          hint="Star people in the people list or PIP. Everyone else is refused."
          onChange={(favoritesOnly) => set({ favoritesOnly })}
        />
      </Feature>

      <Feature
        id="approve"
        open={open === 'approve'}
        onToggle={toggle}
        icon="mdi-hand-back-left-outline"
        title="Approve each command"
        on={value.approveEachCommand}
        summary={
          value.approveEachCommand
            ? `On — you accept or deny every command (${formatSeconds(value.approvalTimeoutMs)} to answer)`
            : 'Off — commands run without asking you'
        }
      >
        <Switch
          checked={value.approveEachCommand}
          disabled={disabled}
          title="Ask me before every command"
          hint="You get an Accept / Deny prompt. No answer in time = denied. A banner shows while this is on."
          onChange={(approveEachCommand) => set({ approveEachCommand })}
        />
        {value.approveEachCommand ? (
          <div className="setup-limits-block">
            <LimitSlider
              label="Time to answer"
              value={value.approvalTimeoutMs}
              min={5_000}
              max={60_000}
              step={5_000}
              formatValue={formatSeconds}
              disabled={disabled}
              onChange={(approvalTimeoutMs) => set({ approvalTimeoutMs })}
            />
          </div>
        ) : null}
      </Feature>

      <Feature
        id="cooldown"
        open={open === 'cooldown'}
        onToggle={toggle}
        icon="mdi-timer-sand"
        title="Cooldowns"
        on={cooldownOn}
        summary={
          cooldownOn
            ? `Per person ${formatSeconds(value.cooldownPerSenderMs)} · overall ${formatSeconds(value.cooldownGlobalMs)}`
            : 'Off — no minimum gap between commands'
        }
      >
        <p className="auth-boot__hint" style={{ textAlign: 'left' }}>
          A minimum gap between commands.
          {queueEnabled
            ? ' Your command queue is on: it waits for whichever is longer — this cooldown or the queue’s own spacing.'
            : ' Commands sent too soon are refused with a countdown.'}
        </p>
        <div className="setup-limits-block">
          <LimitSlider
            label="Per person"
            value={value.cooldownPerSenderMs}
            min={0}
            max={300_000}
            step={5_000}
            formatValue={formatSeconds}
            hint="How long one person must wait between their own commands"
            disabled={disabled}
            onChange={(cooldownPerSenderMs) => set({ cooldownPerSenderMs })}
          />
          <LimitSlider
            label="Overall"
            value={value.cooldownGlobalMs}
            min={0}
            max={300_000}
            step={5_000}
            formatValue={formatSeconds}
            hint="Minimum gap between any two commands, whoever sends them"
            disabled={disabled}
            onChange={(cooldownGlobalMs) => set({ cooldownGlobalMs })}
          />
        </div>
      </Feature>

      <Feature
        id="budget"
        open={open === 'budget'}
        onToggle={toggle}
        icon="mdi-battery-charging-60"
        title="Shock budget"
        on={value.budgetEnabled}
        summary={
          value.budgetEnabled
            ? `On — ${value.budgetMaxShocks ?? '∞'} shocks${
                value.budgetMaxShockMs != null ? ` / ${formatSeconds(value.budgetMaxShockMs)}` : ''
              } ${value.budgetPeriod === 'day' ? 'per day' : value.budgetPeriod === 'session' ? 'per session' : 'until reset'}`
            : 'Off — no cap on how many shocks you get'
        }
      >
        <Switch
          checked={value.budgetEnabled}
          disabled={disabled}
          title="Cap my shocks"
          hint="Once used up, shocks are refused (vibrate and beep still work). You can reset or raise it any time."
          onChange={(budgetEnabled) =>
            set({
              budgetEnabled,
              budgetMaxShocks: budgetEnabled && value.budgetMaxShocks == null ? 20 : value.budgetMaxShocks,
            })
          }
        />
        {value.budgetEnabled ? (
          <div className="setup-limits-block">
            <div className="setup-limits-block__title">Refills</div>
            <div className="safety-periods" role="radiogroup" aria-label="Budget period">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={value.budgetPeriod === p.id}
                  disabled={disabled}
                  className={`log-privacy__scope${value.budgetPeriod === p.id ? ' is-active' : ''}`}
                  onClick={() => set({ budgetPeriod: p.id })}
                >
                  <span className="log-privacy__scope-title">{p.title}</span>
                  <span className="log-privacy__scope-hint">{p.hint}</span>
                </button>
              ))}
            </div>
            <LimitSlider
              label="Max shocks"
              value={value.budgetMaxShocks ?? 0}
              min={0}
              max={200}
              step={1}
              formatValue={(n) => (n <= 0 ? 'No cap' : String(n))}
              disabled={disabled}
              onChange={(n) => set({ budgetMaxShocks: n <= 0 ? null : n })}
            />
            <LimitSlider
              label="Max total shock time"
              value={value.budgetMaxShockMs ?? 0}
              min={0}
              max={600_000}
              step={5_000}
              formatValue={(ms) => (ms <= 0 ? 'No cap' : formatSeconds(ms))}
              disabled={disabled}
              onChange={(ms) => set({ budgetMaxShockMs: ms <= 0 ? null : ms })}
            />
          </div>
        ) : null}
      </Feature>

      <Feature
        id="checkin"
        open={open === 'checkin'}
        onToggle={toggle}
        icon="mdi-account-heart-outline"
        title="Check-ins"
        on={value.checkInEnabled}
        summary={
          value.checkInEnabled
            ? `On — “Still OK?” every ${formatMinutes(value.checkInIntervalMs)}`
            : 'Off — no periodic check'
        }
      >
        <Switch
          checked={value.checkInEnabled}
          disabled={disabled}
          title="Ask me if I’m still OK"
          hint="The app beeps (never your shocker) and asks you to confirm. No answer in time = all your shares are paused and your queue is cleared."
          onChange={(checkInEnabled) => set({ checkInEnabled })}
        />
        {value.checkInEnabled ? (
          <div className="setup-limits-block">
            <LimitSlider
              label="Ask every"
              value={value.checkInIntervalMs}
              min={60_000}
              max={2 * 60 * 60_000}
              step={60_000}
              formatValue={formatMinutes}
              disabled={disabled}
              onChange={(checkInIntervalMs) => set({ checkInIntervalMs })}
            />
            <LimitSlider
              label="Time to answer"
              value={value.checkInGraceMs}
              min={15_000}
              max={300_000}
              step={15_000}
              formatValue={(ms) => formatDurationMs(ms)}
              disabled={disabled}
              onChange={(checkInGraceMs) => set({ checkInGraceMs })}
            />
          </div>
        ) : null}
      </Feature>

      <Feature
        id="person"
        open={open === 'person'}
        onToggle={toggle}
        icon="mdi-account-cog-outline"
        title="Per-person limits"
        on={value.perPersonLimitsEnabled}
        summary={
          value.perPersonLimitsEnabled
            ? 'On — a ⚙ next to each person sets their own caps'
            : 'Off — everyone gets the same limits'
        }
      >
        <Switch
          checked={value.perPersonLimitsEnabled}
          disabled={disabled}
          title="Set lower limits for specific people"
          hint="Adds a settings cog next to people in the list. Their caps can only be lower than your normal limits."
          onChange={(perPersonLimitsEnabled) => set({ perPersonLimitsEnabled })}
        />
      </Feature>
    </div>
  );
}
