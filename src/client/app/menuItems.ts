export type ActivityMenuItemId =
  | 'availability'
  | 'settings'
  | 'shares'
  | 'logs'
  | 'logPrivacy'
  | 'safety'
  | 'history'
  | 'myData'
  | 'admin';

const ALL_MENU_ITEMS: ReadonlyArray<[ActivityMenuItemId, string, string]> = [
  ['availability', 'Available in Discord', 'mdi-account-check'],
  ['settings', 'Activity Limits', 'mdi-tune'],
  ['shares', 'Shares', 'mdi-share-variant'],
  ['logs', 'Logs', 'mdi-message-text-clock'],
  ['logPrivacy', 'Log sharing', 'mdi-eye-settings-outline'],
  ['safety', 'Extra features', 'mdi-shield-account-outline'],
  ['history', 'My history', 'mdi-history'],
  ['myData', 'My data', 'mdi-database-lock-outline'],
  ['admin', 'Admin panel', 'mdi-shield-crown-outline'],
];

/** Menu entries visible for the current user (admin panel only for admins). */
export function activityMenuItems(opts: {
  isAdmin: boolean;
  pishockLinked: boolean;
}): Array<[ActivityMenuItemId, string, string]> {
  return ALL_MENU_ITEMS.filter(([id]) => id !== 'admin' || opts.isAdmin).filter(
    ([id]) =>
      id === 'admin' ||
      opts.pishockLinked ||
      id === 'logs' ||
      id === 'logPrivacy' ||
      id === 'myData' ||
      id === 'history',
  );
}
