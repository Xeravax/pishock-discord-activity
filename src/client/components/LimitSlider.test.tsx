import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatDurationMs, formatIntensityPct, LimitSlider } from './LimitSlider';

const slider = () => screen.getByRole('slider');

describe('LimitSlider', () => {
  it('clamps an out-of-range value into [min, max] for display and input', () => {
    const { rerender } = render(
      <LimitSlider label="Max" value={250} min={1} max={100} onChange={vi.fn()} />,
    );
    expect(slider()).toHaveValue('100');
    expect(slider()).toHaveAttribute('aria-valuenow', '100');
    rerender(<LimitSlider label="Max" value={-5} min={1} max={100} onChange={vi.fn()} />);
    expect(slider()).toHaveValue('1');
  });

  it('never lets max fall below min', () => {
    render(<LimitSlider label="Max" value={50} min={30} max={10} onChange={vi.fn()} />);
    expect(slider()).toHaveAttribute('max', '30');
    expect(slider()).toHaveValue('30');
  });

  it('emits numbers, not strings', () => {
    const onChange = vi.fn();
    render(<LimitSlider label="Max" value={10} min={0} max={100} onChange={onChange} />);
    fireEvent.change(slider(), { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith(42);
    expect(typeof onChange.mock.calls[0]![0]).toBe('number');
  });

  it('is not interactive when disabled and uses the formatter for text + aria', () => {
    render(
      <LimitSlider
        label="Intensity"
        value={30}
        min={1}
        max={100}
        disabled
        formatValue={formatIntensityPct}
        onChange={vi.fn()}
      />,
    );
    expect(slider()).toBeDisabled();
    expect(slider()).toHaveAttribute('aria-valuetext', '30%');
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('formats durations', () => {
    expect(formatDurationMs(1500)).toMatch(/1\.5|1,5/);
  });
});
