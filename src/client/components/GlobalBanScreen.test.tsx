import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GlobalBanScreen } from './GlobalBanScreen';

const ban = {
  id: 'ban_test_ref',
  reason: 'Ignored limits after repeated warnings from moderators.',
  createdAt: '2026-11-18T10:00:00.000Z',
  expiresAt: '2026-11-25T10:00:00.000Z',
  appealUrl: 'https://discord.gg/example',
};

describe('GlobalBanScreen', () => {
  it('documents the ban reason, length, reference and data rights', () => {
    render(<GlobalBanScreen ban={ban} token="tok" displayName="Alex" />);

    expect(screen.getByRole('heading', { name: /banned from this activity/i })).toBeInTheDocument();
    expect(screen.getByText(ban.reason)).toBeInTheDocument();
    expect(screen.getByText('ban_test_ref')).toBeInTheDocument();
    expect(screen.queryByText('Permanent')).not.toBeInTheDocument();
    expect(screen.getByText(/Until /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my data/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /appeal on discord/i })).toBeInTheDocument();
  });

  it('shows permanent when there is no expiry', () => {
    render(
      <GlobalBanScreen
        ban={{ ...ban, expiresAt: null }}
        token={null}
        displayName="Alex"
      />,
    );
    expect(screen.getByText('Permanent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /my data/i })).not.toBeInTheDocument();
  });
});
