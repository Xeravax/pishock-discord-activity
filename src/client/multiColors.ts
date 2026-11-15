/** Hash a string to an unsigned 32-bit int. */
export function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = light - c / 2;
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function baseHueForUser(userKey: string): number {
  return hashString(userKey) % 360;
}

/** Stable accent for a Discord participant row. */
export function colorForUser(userKey: string): string {
  return hslToHex(baseHueForUser(userKey), 62, 58);
}

/**
 * Per-shocker color in the same hue family as the owner/participant.
 * Multiple devices on one person stay related but individually distinct.
 */
export function colorForShocker(userKey: string, shockerId: number): string {
  const base = baseHueForUser(userKey);
  const h = hashString(`s:${shockerId}`);
  const hue = (base + ((h % 5) - 2) * 10 + 360) % 360;
  const sat = 58 + (h % 4) * 7;
  const light = 52 + ((h >> 3) % 4) * 5;
  return hslToHex(hue, sat, light);
}
