import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ShockerView } from './ShockerCard';
import { MultiTargetTray } from './MultiTargetTray';
import { multiColorKey, type PerTargetSettings } from './official/helpers';

const shocker = (over: Partial<ShockerView> = {}) =>
  ({
    id: 1,
    name: 'Collar',
    owned: true,
    hubName: 'Hub A',
    canShock: true,
    canVibrate: true,
    canBeep: true,
    canHold: false,
    deviceMaxIntensity: 100,
    deviceMaxDuration: 15_000,
    activityMaxIntensity: 30,
    activityMaxDuration: 2_000,
    vibMaxIntensity: 70,
    vibMaxDuration: 6_000,
    ...over,
  }) as ShockerView;

const DEFAULTS: PerTargetSettings = {
  operation: 'shock',
  intensity: 10,
  durationMs: 1_000,
  warningLevel: 'none',
};

function Harness({
  shockers,
  onSend,
  initial = {},
}: {
  shockers: ShockerView[];
  onSend?: () => void;
  initial?: Record<string, PerTargetSettings>;
}) {
  const [values, setValues] = useState(initial);
  return (
    <MultiTargetTray
      shockers={shockers}
      selectedIds={shockers.map((s) => s.id)}
      individual
      values={values}
      defaults={DEFAULTS}
      keyFor={multiColorKey}
      colorFor={() => '#79c6db'}
      personName={() => 'Friend'}
      onToggle={() => {}}
      onSetGroup={() => {}}
      onValue={(key, v) => setValues((prev) => ({ ...prev, [key]: v }))}
      onSend={onSend}
    />
  );
}

describe('MultiTargetTray (Individual)', () => {
  it('slider max follows the chosen action cap', async () => {
    const user = userEvent.setup();
    render(<Harness shockers={[shocker()]} />);
    expect(screen.getByRole('slider', { name: /collar intensity/i })).toHaveAttribute('max', '30');
    expect(screen.getByRole('slider', { name: /collar duration/i })).toHaveAttribute('max', '2000');

    await user.click(screen.getByRole('radio', { name: 'Vibrate' }));
    expect(screen.getByRole('slider', { name: /collar intensity/i })).toHaveAttribute('max', '70');
    expect(screen.getByRole('slider', { name: /collar duration/i })).toHaveAttribute('max', '6000');
  });

  it('disables actions the shocker does not allow', () => {
    render(<Harness shockers={[shocker({ canShock: false })]} />);
    expect(screen.getByRole('radio', { name: 'Shock' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Vibrate' })).toBeEnabled();
  });

  it('hides warning levels below the wearer floor', () => {
    render(<Harness shockers={[shocker({ requiredWarningLevel: 'mid' })]} />);
    const group = screen.getByRole('radiogroup', { name: /collar warning/i });
    const labels = [...group.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['MID', 'LONG']);
    expect(screen.getByRole('radio', { name: 'MID' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Send button counts ready targets and fires onSend', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <Harness
        shockers={[shocker({ id: 1 }), shocker({ id: 2, name: 'Cuff' }), shocker({ id: 3, name: 'Off', emergencyStop: true })]}
        onSend={onSend}
      />,
    );
    const send = screen.getByRole('button', { name: 'Send to 2 targets' });
    await user.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
