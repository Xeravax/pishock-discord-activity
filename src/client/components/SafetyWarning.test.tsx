import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsentGate } from './ConsentGate';
import { SAFETY_ACK_ITEMS, SAFETY_ACK_VERSION } from './SafetyWarning';

const acceptBtn = () => screen.getByRole('button', { name: /acknowledge and accept/i });

describe('ConsentGate (safety acknowledgment)', () => {
  it('cannot be accepted until every item is acknowledged', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<ConsentGate onAccept={onAccept} />);

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(SAFETY_ACK_ITEMS.length);
    expect(acceptBtn()).toBeDisabled();

    // all but the last: still blocked
    for (const box of boxes.slice(0, -1)) await user.click(box);
    expect(acceptBtn()).toBeDisabled();
    await user.click(acceptBtn()); // no-op on a disabled button
    expect(onAccept).not.toHaveBeenCalled();

    await user.click(boxes.at(-1)!);
    expect(acceptBtn()).toBeEnabled();
  });

  it('un-ticking any item blocks acceptance again', async () => {
    const user = userEvent.setup();
    render(<ConsentGate onAccept={vi.fn()} />);
    const boxes = screen.getAllByRole('checkbox');
    for (const box of boxes) await user.click(box);
    expect(acceptBtn()).toBeEnabled();
    await user.click(boxes[2]!);
    expect(acceptBtn()).toBeDisabled();
  });

  it('reports exactly the acknowledged items and version', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<ConsentGate onAccept={onAccept} />);
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    await user.click(acceptBtn());
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith({
      acknowledged: true,
      items: [...SAFETY_ACK_ITEMS],
      version: SAFETY_ACK_VERSION,
    });
  });

  it('stays disabled while busy even when everything is ticked', async () => {
    const user = userEvent.setup();
    render(<ConsentGate onAccept={vi.fn()} busy />);
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    expect(acceptBtn()).toBeDisabled();
  });
});
