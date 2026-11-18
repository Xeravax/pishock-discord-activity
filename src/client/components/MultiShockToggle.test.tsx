import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IndividualIntensityToggle, MultiShockToggle } from './MultiShockToggle';

describe('multishock toggles', () => {
  it('expose state via aria-pressed and call onToggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<MultiShockToggle active={false} onToggle={onToggle} />);
    const btn = screen.getByRole('button', { name: /multi/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await user.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<MultiShockToggle active onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: /multi/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('per-person toggle is labelled and pressable', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<IndividualIntensityToggle active onToggle={onToggle} />);
    const btn = screen.getByRole('button', { name: /individually/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn);
    expect(onToggle).toHaveBeenCalled();
  });
});
