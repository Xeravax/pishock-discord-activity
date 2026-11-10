export type DefaultStartMenu = 'friends' | 'own';

const keyFor = (discordUserId: string) => `pishock-default-menu:${discordUserId}`;

/** Returns null when the user has not chosen yet. */
export function loadDefaultStartMenu(discordUserId: string): DefaultStartMenu | null {
  try {
    const raw = localStorage.getItem(keyFor(discordUserId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { menu?: string };
    if (parsed.menu === 'friends' || parsed.menu === 'own') return parsed.menu;
    return null;
  } catch {
    return null;
  }
}

export function saveDefaultStartMenu(discordUserId: string, menu: DefaultStartMenu) {
  localStorage.setItem(keyFor(discordUserId), JSON.stringify({ menu }));
}

export function clearDefaultStartMenu(discordUserId: string) {
  localStorage.removeItem(keyFor(discordUserId));
}
