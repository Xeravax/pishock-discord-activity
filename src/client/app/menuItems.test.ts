import { describe, expect, it } from 'vitest';
import { activityMenuItems } from './menuItems';

describe('activityMenuItems', () => {
  it('hides the admin panel entry when the user is not an admin', () => {
    const ids = activityMenuItems({ isAdmin: false, pishockLinked: true }).map(([id]) => id);
    expect(ids).not.toContain('admin');
    expect(ids).toContain('myData');
  });

  it('shows the admin panel entry for admins', () => {
    const ids = activityMenuItems({ isAdmin: true, pishockLinked: false }).map(([id]) => id);
    expect(ids).toContain('admin');
    expect(ids).toContain('logs');
    expect(ids).not.toContain('shares');
  });
});
