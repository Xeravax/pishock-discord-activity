import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { WARNING_PRESETS } from '../shared/warning';
import type { OfficialLogEntry } from './components/OfficialLogsPanel';
import markUrl from './assets/pishock-mark.png';

/** Wide banner matching the share-moment mock (1024×572 scaled up). */
const CARD_W = 1280;
const CARD_H = 715;

const COLORS = {
  card: '#12171c',
  cyan: '#5ad8ff',
  yellow: '#ffe500',
  magenta: '#ff4bd6',
  ghost: '#6ef3ff',
  white: '#f7f9fb',
  muted: '#9aa6ae',
  footer: '#8e9aa2',
  chipFrom: '#4eb6ff',
  chipTo: '#e6eaee',
} as const;

const FONT = 'geo, Oxanium, "Segoe UI", "Liberation Sans", system-ui, sans-serif';
const DISPLAY = `"Arial Black", Impact, geo, Oxanium, "Segoe UI", system-ui, sans-serif`;

const DISCORD_ICON =
  'M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.1.1 0 0 0-.1.05c-.17.3-.36.7-.5 1.01a16.3 16.3 0 0 0-4.8 0c-.14-.32-.33-.7-.5-1.01a.1.1 0 0 0-.1-.05c-1.5.26-2.93.71-4.27 1.33a.09.09 0 0 0-.04.03C2.2 9.05 1.5 12.58 1.8 16.06c0 .02.01.04.03.05 1.8 1.32 3.53 2.12 5.24 2.65.04 0 .08-.01.1-.05.4-.55.76-1.13 1.07-1.74.02-.04 0-.08-.04-.09-.57-.22-1.11-.48-1.64-.78-.04-.02-.04-.08-.01-.11.11-.08.22-.17.33-.25.02-.02.05-.02.07-.01 3.44 1.57 7.15 1.57 10.55 0 .02-.01.05-.01.07.01.11.09.22.17.33.26.04.03.04.09-.01.11-.52.31-1.07.56-1.64.78-.04.01-.05.06-.04.09.32.61.68 1.19 1.07 1.74.03.04.07.05.1.05 1.72-.53 3.45-1.33 5.25-2.65.02-.01.03-.03.03-.05.36-3.78-.61-7.27-2.58-10.7a.08.08 0 0 0-.04-.03zM8.52 14.1c-.99 0-1.8-.91-1.8-2.02 0-1.12.8-2.03 1.8-2.03 1 0 1.81.91 1.8 2.03 0 1.11-.8 2.02-1.8 2.02zm6.97 0c-.99 0-1.8-.91-1.8-2.02 0-1.12.8-2.03 1.8-2.03 1 0 1.81.91 1.8 2.03 0 1.11-.8 2.02-1.8 2.02z';

/** Fast buzz offsets. The neon frame stays put; the picture inside shakes. */
const VIBE: Array<[number, number]> = [
  [0, 0],
  [8, -4],
  [-8, 4],
  [7, 5],
  [-7, -5],
  [9, -2],
  [-9, 3],
  [4, -7],
];

type Assets = {
  fromImg: HTMLImageElement | null;
  toImg: HTMLImageElement | null;
  mark: HTMLImageElement | null;
  /** Guild or channel icon. Null when missing or the image failed to load. */
  placeImg: HTMLImageElement | null;
};

type Layout = {
  fontSize: number;
  chipFont: number;
  chipH: number;
  gap: number;
  headline: string;
  halfW: number;
  ascent: number;
  descent: number;
  fromLabel: string;
  toLabel: string;
  fromW: number;
  toW: number;
  heroY: number;
  chipY: number;
  fromX: number;
  toX: number;
  detailY: number;
  orbitRx: number;
  orbitRy: number;
  boltScale: number;
};

function headlineFor(action: OfficialLogEntry['action']): string {
  if (action === 'vibrate') return 'VIBRATED';
  if (action === 'beep') return 'BEEPED';
  if (action === 'shock') return 'SHOCKED';
  return 'ZAPPED';
}

/** 0 at 0%, 1 at 100%. Missing intensity sits in the middle. */
function intensityT(entry: OfficialLogEntry): number {
  if (entry.intensity == null || !Number.isFinite(entry.intensity)) return 0.55;
  return Math.min(1, Math.max(0, entry.intensity / 100));
}

function motionFor(entry: OfficialLogEntry): { frames: number; delay: number; t: number } {
  const t = intensityT(entry);
  const punch = t * t;
  if (entry.action === 'vibrate') {
    return { frames: 8, delay: Math.max(20, Math.round(76 - punch * 52)), t };
  }
  if (entry.action === 'beep') {
    return { frames: 12, delay: Math.max(24, Math.round(108 - punch * 64)), t };
  }
  return { frames: 12, delay: Math.max(24, Math.round(118 - punch * 72)), t };
}

function formatDuration(sec: number): string {
  if (Number.isInteger(sec)) return String(sec);
  return String(Math.round(sec * 10) / 10);
}

function cleanName(name: string): string {
  const t = name.replace(/\s+/g, ' ').trim();
  return t || 'Someone';
}

function serverLine(entry: OfficialLogEntry): string | null {
  const name = entry.location?.name?.trim();
  if (!name) return null;
  const kind = (entry.location?.kind ?? '').toLowerCase();
  const dm =
    kind === 'dm' ||
    kind === 'gm' ||
    /direct message|group dm|private channel/i.test(name);
  if (dm) return name;
  const guild = Boolean(entry.location?.guildId) || kind === 'gc' || kind === 'guild';
  if (guild && !/^server:/i.test(name)) return `Server: ${name}`;
  return name;
}

function wordColor(action: OfficialLogEntry['action']): string {
  if (action === 'vibrate') return COLORS.magenta;
  if (action === 'beep') return '#f4fbff';
  return COLORS.yellow;
}

function percentColor(action: OfficialLogEntry['action']): string {
  if (action === 'vibrate') return COLORS.magenta;
  if (action === 'beep') return COLORS.cyan;
  return COLORS.yellow;
}

/** Ask Discord's CDN for a size that stays sharp on the share banner. */
function placeIconUrl(entry: OfficialLogEntry): string {
  const url = entry.location?.iconUrl?.trim() ?? '';
  if (!url) return '';
  return url.replace(/([?&])size=\d+/i, '$1size=128');
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      (part) => part.segment,
    );
  }
  return [...text];
}

function isEmojiGrapheme(grapheme: string): boolean {
  return /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(grapheme);
}

/** Advance width plus the ink that emoji fonts paint outside that advance. */
function measureLabel(ctx: CanvasRenderingContext2D, text: string, fontPx: number): number {
  let width = 0;
  for (const grapheme of graphemes(text)) {
    const measured = ctx.measureText(grapheme);
    const ink = Math.max(
      measured.width,
      (measured.actualBoundingBoxLeft || 0) + (measured.actualBoundingBoxRight || 0),
    );
    width += isEmojiGrapheme(grapheme) ? Math.max(ink, fontPx * 1.45) : Math.max(measured.width, ink);
  }
  return width;
}

function chipTextInset(chipH: number): number {
  const avatarR = Math.max(10, chipH / 2 - 7);
  return chipH / 2 + avatarR + 22;
}

function chipWidth(
  ctx: CanvasRenderingContext2D,
  label: string,
  chipH: number,
  chipFont: number,
): number {
  ctx.font = `700 ${chipFont}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const rightPad = Math.max(34, Math.round(chipH * 0.38));
  return Math.ceil(chipTextInset(chipH) + measureLabel(ctx, label, chipFont) + rightPad);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i - Math.PI / 2;
    const b = a + Math.PI / 4;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(b) * r * 0.28, Math.sin(b) * r * 0.28);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSparkleField(ctx: CanvasRenderingContext2D, seedKey: string) {
  const rand = mulberry32(hashSeed(seedKey || 'pishock'));
  for (let i = 0; i < 56; i++) {
    const x = 64 + rand() * (CARD_W - 128);
    const y = 130 + rand() * (CARD_H - 230);
    if (y > CARD_H - 96) continue;
    const big = rand() < 0.18;
    const r = big ? 2.8 + rand() * 3.2 : 0.8 + rand() * 1.5;
    const alpha = (big ? 0.7 : 0.35) + rand() * 0.28;
    const color = rand() > 0.28 ? '#ffe7a0' : '#f5fcff';
    if (big) drawStar(ctx, x, y, r, color, alpha);
    else {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawLetterAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  name: string,
  fill: string,
) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  const letter = (name.trim().charAt(0) || '?').toUpperCase();
  ctx.fillStyle = COLORS.white;
  ctx.font = `700 ${Math.round(radius * 0.95)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, cx, cy + 1);
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  cx: number,
  cy: number,
  radius: number,
  name: string,
  fallbackFill: string,
  ring: string,
) {
  if (!img) drawLetterAvatar(ctx, cx, cy, radius, name, fallbackFill);
  else {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawPersonChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fontPx: number,
  avatar: HTMLImageElement | null,
  name: string,
  label: string,
  border: string,
  glow: boolean,
  avatarFallback: string,
) {
  roundRect(ctx, x, y, width, height, height / 2);
  ctx.save();
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + width, y);
  if (glow) {
    g.addColorStop(0, 'rgba(46, 150, 220, 0.34)');
    g.addColorStop(0.42, 'rgba(18, 26, 34, 0.55)');
    g.addColorStop(1, 'rgba(12, 16, 22, 0.35)');
  } else {
    g.addColorStop(0, 'rgba(255, 255, 255, 0.07)');
    g.addColorStop(1, 'rgba(10, 14, 18, 0.28)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(x, y, width, height);
  ctx.restore();

  roundRect(ctx, x, y, width, height, height / 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = border;
  if (glow) {
    ctx.save();
    ctx.shadowColor = 'rgba(70, 180, 255, 0.85)';
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.restore();
  }
  ctx.stroke();

  const avatarR = Math.max(10, height / 2 - 7);
  drawAvatar(
    ctx,
    avatar,
    x + height / 2,
    y + height / 2,
    avatarR,
    name,
    avatarFallback,
    glow ? 'rgba(160, 220, 255, 0.85)' : 'rgba(255,255,255,0.8)',
  );

  ctx.fillStyle = COLORS.white;
  ctx.font = `700 ${fontPx}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + chipTextInset(height), y + height / 2 + 1);
}

function drawDefaultDiscordIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  icon: number,
) {
  ctx.save();
  const scale = (icon * 0.62) / 24;
  ctx.translate(x + icon * 0.19, y + icon * 0.2);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#e7eef3';
  ctx.fill(new Path2D(DISCORD_ICON));
  ctx.restore();
}

function drawDiscordBadge(
  ctx: CanvasRenderingContext2D,
  right: number,
  cy: number,
  label: string,
  iconImg: HTMLImageElement | null,
) {
  ctx.font = `600 26px ${FONT}`;
  const text = truncate(ctx, label, 420);
  const textW = ctx.measureText(text).width;
  const icon = 38;
  const gap = 12;
  const x = right - textW - gap - icon;
  const y = cy - icon / 2;

  roundRect(ctx, x, y, icon, icon, 10);
  ctx.fillStyle = '#3e464e';
  ctx.fill();

  if (iconImg) {
    ctx.save();
    roundRect(ctx, x, y, icon, icon, 10);
    ctx.clip();
    ctx.drawImage(iconImg, x, y, icon, icon);
    ctx.restore();
  } else {
    drawDefaultDiscordIcon(ctx, x, y, icon);
  }

  ctx.fillStyle = COLORS.white;
  ctx.font = `600 26px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + icon + gap, cy + 1);
}

function drawFilledBolt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  rotation: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(1, -18);
  ctx.lineTo(-8, 1);
  ctx.lineTo(-1.5, 0.5);
  ctx.lineTo(-5, 18);
  ctx.lineTo(8, -1.5);
  ctx.lineTo(1.2, -1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFallbackMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.fillStyle = '#0c0c0c';
  ctx.fillRect(x, y, size, size);
  ctx.save();
  ctx.translate(x + size * 0.18, y + size * 0.16);
  ctx.scale(size / 120, size / 120);
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(18, 10);
  ctx.lineTo(62, 10);
  ctx.lineTo(78, 28);
  ctx.lineTo(48, 78);
  ctx.lineTo(28, 78);
  ctx.lineTo(18, 64);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = COLORS.cyan;
  ctx.beginPath();
  ctx.moveTo(58, 4);
  ctx.lineTo(34, 42);
  ctx.lineTo(48, 42);
  ctx.lineTo(30, 86);
  ctx.lineTo(70, 36);
  ctx.lineTo(54, 36);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function fillTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}

function fitLayout(ctx: CanvasRenderingContext2D, entry: OfficialLogEntry): Layout {
  const headline = headlineFor(entry.action);
  const fromLabel = cleanName(entry.from.displayName);
  const toLabel = cleanName(entry.to.displayName);
  const maxW = CARD_W - 88;
  let fontSize = 100;
  let chipFont = 32;
  let gap = 72;

  const measure = () => {
    const chipH = Math.max(44, Math.round(chipFont * 2.05 + 14));
    const fromW = chipWidth(ctx, fromLabel, chipH, chipFont);
    const toW = chipWidth(ctx, toLabel, chipH, chipFont);
    ctx.font = `italic 800 ${fontSize}px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const m = ctx.measureText(headline);
    const halfW = Math.max(
      m.width / 2,
      ((m.actualBoundingBoxLeft || m.width / 2) + (m.actualBoundingBoxRight || m.width / 2)) / 2,
    );
    const ascent = m.actualBoundingBoxAscent || fontSize * 0.42;
    const descent = m.actualBoundingBoxDescent || fontSize * 0.22;
    const visualHalf = halfW + fontSize * 0.06;
    return {
      chipH,
      fromW,
      toW,
      halfW: visualHalf,
      ascent,
      descent,
      total: fromW + gap + visualHalf * 2 + gap + toW,
    };
  };

  let m = measure();
  let guard = 0;
  while (m.total > maxW && guard < 120) {
    guard += 1;
    if (fontSize > 58) fontSize -= 4;
    else if (chipFont > 16) chipFont -= 1;
    else if (gap > 56) gap -= 2;
    else if (fontSize > 34) fontSize -= 2;
    else if (gap > 40) gap -= 2;
    else chipFont = Math.max(9, chipFont - 1);
    m = measure();
    if (chipFont <= 9 && fontSize <= 34 && gap <= 40) break;
  }

  const heroY = Math.round(CARD_H * 0.45);
  const chipY = heroY - m.chipH / 2;
  const lane = Math.min(36, Math.max(16, gap * 0.42));
  const orbitRx = m.halfW + lane * 0.62;
  const orbitRy = Math.max(m.ascent, m.descent) + 36;
  const boltScale = Math.min(1, lane / 34);
  const effectBottom =
    entry.action === 'shock' ? heroY + orbitRy + 30 : heroY + m.descent;
  const detailY = Math.max(effectBottom, chipY + m.chipH) + 22;
  const cx = CARD_W / 2;

  return {
    fontSize,
    chipFont,
    chipH: m.chipH,
    gap,
    headline,
    halfW: m.halfW,
    ascent: m.ascent,
    descent: m.descent,
    fromLabel,
    toLabel,
    fromW: m.fromW,
    toW: m.toW,
    heroY,
    chipY,
    fromX: cx - m.halfW - gap - m.fromW,
    toX: cx + m.halfW + gap,
    detailY,
    orbitRx,
    orbitRy,
    boltScale,
  };
}

function drawOrbitingBolts(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  frame: number,
  frames: number,
  boltScale: number,
  t: number,
) {
  const spin = (frame / frames) * Math.PI * 2;
  const count = t < 0.28 ? 1 : t < 0.8 ? 2 : 3;
  const spots = count === 1 ? [0] : count === 2 ? [0, Math.PI] : [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  const trail = 0.22 + t * 1.05;
  const width = 1.3 + t * 3.4;
  const blur = 3 + t * 16;
  const scaleMul = 0.38 + t * 1.35;
  const sparkR = 1.4 + t * 4.2;
  for (let i = 0; i < spots.length; i++) {
    const a = spin + spots[i]!;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 229, 0, ${0.35 + t * 0.6})`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.shadowColor = COLORS.yellow;
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, a - trail, a - 0.05);
    ctx.stroke();
    ctx.restore();

    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const tx = -Math.sin(a) * rx;
    const ty = Math.cos(a) * ry;
    const rot = Math.atan2(ty, tx) + Math.PI / 2;
    drawFilledBolt(ctx, x, y, (i === 0 ? 1.15 : 0.78) * boltScale * scaleMul, rot, COLORS.yellow);
    if (t > 0.12) {
      drawStar(
        ctx,
        cx + Math.cos(a - 0.4) * rx,
        cy + Math.sin(a - 0.4) * ry,
        sparkR,
        '#fff6c2',
        0.4 + t * 0.55,
      );
    }
  }
}

/** Speaker-style pings on either side of the word. Arcs open outward and fade as they travel. */
function drawBeepWaves(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfW: number,
  sideGap: number,
  frame: number,
  frames: number,
  t: number,
) {
  const maxR = Math.max(12, Math.min(10 + t * 26, sideGap - 12));
  const waves = t < 0.3 ? 1 : t < 0.72 ? 2 : 3;
  const loud = 0.28 + t * 0.72;
  for (const dir of [-1, 1] as const) {
    const ox = cx + dir * (halfW + 12);
    for (let i = 0; i < waves; i++) {
      const travel = (frame / frames + i / waves) % 1;
      const radius = 6 + travel * (maxR - 6);
      ctx.save();
      ctx.globalAlpha = (1 - travel) * loud;
      ctx.strokeStyle = travel < 0.45 ? '#e9fbff' : COLORS.cyan;
      ctx.lineWidth = (1.3 + t * 3.6) * (1 - travel * 0.45);
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(90, 216, 255, 0.85)';
      ctx.shadowBlur = 3 + t * 12;
      ctx.beginPath();
      if (dir > 0) ctx.arc(ox, cy, radius, -1.05, 1.05);
      else ctx.arc(ox, cy, radius, Math.PI - 1.05, Math.PI + 1.05);
      ctx.stroke();
      ctx.restore();
    }
  }
}

type DetailSeg = { text: string; color: string };

function detailSegments(entry: OfficialLogEntry): DetailSeg[] {
  const segs: DetailSeg[] = [];
  if (entry.intensity != null) {
    segs.push({ text: 'at ', color: COLORS.white });
    segs.push({ text: `${Math.round(entry.intensity)}%`, color: percentColor(entry.action) });
  }
  if (entry.durationSec != null) {
    segs.push({ text: segs.length ? ' for ' : 'for ', color: COLORS.white });
    const durColor = entry.action === 'vibrate' ? COLORS.magenta : COLORS.cyan;
    segs.push({ text: `${formatDuration(entry.durationSec)}s`, color: durColor });
  }
  return segs;
}

function drawMiniMark(
  ctx: CanvasRenderingContext2D,
  action: OfficialLogEntry['action'],
  x: number,
  y: number,
) {
  if (action === 'shock') {
    drawFilledBolt(ctx, x, y, 0.62, 0.15, COLORS.cyan);
    return;
  }
  if (action === 'vibrate') {
    ctx.save();
    ctx.strokeStyle = COLORS.magenta;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 8, y + 1);
    ctx.lineTo(x - 3, y - 6);
    ctx.lineTo(x + 2, y + 6);
    ctx.lineTo(x + 7, y - 5);
    ctx.lineTo(x + 11, y + 1);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 6, -0.9, 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 11, -0.8, 0.8);
  ctx.stroke();
  ctx.restore();
}

function deviceCaption(entry: OfficialLogEntry, kind: 'hub' | 'shocker'): string | null {
  if (kind === 'hub') {
    const name = entry.hubName?.trim();
    if (name) return name;
    const id = entry.hubClientId?.trim();
    return id || null;
  }
  const name = entry.shockerName?.trim();
  if (name) return name;
  return entry.shockerId != null ? String(entry.shockerId) : null;
}

function warningCaption(entry: OfficialLogEntry): string | null {
  const level = entry.warningLevel;
  if (level !== 'small' && level !== 'mid' && level !== 'long') return null;
  return WARNING_PRESETS[level].label;
}

/** Hub, shocker, and a warning pill when a warning vibe was sent before the shock. */
function drawDeviceMeta(
  ctx: CanvasRenderingContext2D,
  entry: OfficialLogEntry,
  cx: number,
  cy: number,
) {
  const hub = deviceCaption(entry, 'hub');
  const shocker = deviceCaption(entry, 'shocker');
  const warning = warningCaption(entry);
  if (!hub && !shocker && !warning) return;

  const labelFont = `700 18px ${FONT}`;
  const valueFont = `700 28px ${FONT}`;
  const pillFont = `700 18px ${FONT}`;
  const maxW = CARD_W - 128;
  const fieldGap = 26;
  const labelGap = 8;
  const fields: Array<{ label: string; value: string; color: string }> = [];
  if (hub) fields.push({ label: 'HUB', value: hub, color: COLORS.white });
  if (shocker) fields.push({ label: 'SHOCKER', value: shocker, color: COLORS.cyan });

  const pillText = warning ? `WARNING ${warning}` : '';
  ctx.font = pillFont;
  const pillPadX = 14;
  const pillW = warning ? ctx.measureText(pillText).width + pillPadX * 2 : 0;
  const pillH = 36;

  ctx.font = labelFont;
  let overhead = 0;
  for (let i = 0; i < fields.length; i++) {
    if (i > 0) overhead += fieldGap;
    overhead += ctx.measureText(fields[i]!.label).width + labelGap;
  }
  if (warning) overhead += (fields.length ? fieldGap : 0) + pillW;
  const valueBudget = Math.max(48, maxW - overhead);
  const each = fields.length ? valueBudget / fields.length : 0;
  ctx.font = valueFont;
  const values = fields.map((field) => truncate(ctx, field.value, each));

  ctx.font = labelFont;
  let total = overhead;
  ctx.font = valueFont;
  for (const value of values) total += ctx.measureText(value).width;

  let x = cx - total / 2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let i = 0; i < fields.length; i++) {
    if (i > 0) x += fieldGap;
    const field = fields[i]!;
    ctx.font = labelFont;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(field.label, x, cy + 1);
    x += ctx.measureText(field.label).width + labelGap;
    ctx.font = valueFont;
    ctx.fillStyle = field.color;
    const shown = values[i] ?? '';
    ctx.fillText(shown, x, cy);
    x += ctx.measureText(shown).width;
  }

  if (!warning) return;
  if (fields.length) x += fieldGap;
  const pillY = cy - pillH / 2;
  roundRect(ctx, x, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = 'rgba(255, 229, 0, 0.16)';
  ctx.fill();
  roundRect(ctx, x, pillY, pillW, pillH, pillH / 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.yellow;
  ctx.stroke();
  ctx.font = pillFont;
  ctx.fillStyle = COLORS.yellow;
  ctx.textAlign = 'center';
  ctx.fillText(pillText, x + pillW / 2, cy + 1);
  ctx.textAlign = 'left';
}

function drawDetail(ctx: CanvasRenderingContext2D, entry: OfficialLogEntry, cx: number, cy: number) {
  const segs = detailSegments(entry);
  if (!segs.length) return;
  ctx.font = `700 36px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const widths = segs.map((s) => ctx.measureText(s.text).width);
  const markGap = 12;
  const markW = 22;
  const total = widths.reduce((a, b) => a + b, 0) + markGap + markW;
  let x = cx - total / 2;
  for (let i = 0; i < segs.length; i++) {
    ctx.fillStyle = segs[i].color;
    ctx.fillText(segs[i].text, x, cy);
    x += widths[i];
  }
  drawMiniMark(ctx, entry.action, x + markGap + 8, cy + 1);
}

function drawHeadline(
  ctx: CanvasRenderingContext2D,
  entry: OfficialLogEntry,
  layout: Layout,
  dx = 0,
  dy = 0,
  t = 0,
) {
  const cx = CARD_W / 2 + dx;
  const cy = layout.heroY + dy;
  const color = wordColor(entry.action);
  ctx.font = `italic 800 ${layout.fontSize}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (entry.action === 'vibrate') {
    const ghost = 2 + t * 16;
    ctx.save();
    ctx.globalAlpha = 0.12 + t * 0.5;
    ctx.fillStyle = COLORS.ghost;
    ctx.fillText(layout.headline, cx - ghost, cy);
    ctx.fillStyle = COLORS.magenta;
    ctx.globalAlpha = 0.08 + t * 0.38;
    ctx.fillText(layout.headline, cx + ghost * 0.85, cy + 1);
    if (t > 0.72) {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = COLORS.ghost;
      ctx.fillText(layout.headline, cx + ghost * 1.45, cy + 2);
    }
    ctx.restore();
  }
  ctx.fillStyle = color;
  ctx.shadowColor = entry.action === 'vibrate' ? 'rgba(255, 75, 214, 0.95)' : entry.action === 'beep' ? 'rgba(90, 216, 255, 0.9)' : 'rgba(255, 210, 0, 0.9)';
  ctx.shadowBlur = entry.action === 'vibrate' ? 6 + t * 11 : 6 + t * 18;
  ctx.fillText(layout.headline, cx, cy);
  ctx.shadowBlur = 0;
  ctx.fillText(layout.headline, cx, cy);
}

function paintCard(
  ctx: CanvasRenderingContext2D,
  entry: OfficialLogEntry,
  assets: Assets,
  layout: Layout,
  frame: number,
  frames: number,
  t: number,
) {
  const unit = entry.action === 'vibrate' ? VIBE[frame % VIBE.length] : [0, 0];
  const amp = entry.action === 'vibrate' ? (1.15 + t * t * 32) / 9 : 0;
  const jx = (unit?.[0] ?? 0) * amp;
  const rawY = (unit?.[1] ?? 0) * amp;
  const jy = rawY < 0 ? rawY * 0.55 : rawY;

  ctx.clearRect(0, 0, CARD_W, CARD_H);

  const inset = 18;
  const radius = 32;
  const cardX = inset;
  const cardY = inset;
  const cardW = CARD_W - inset * 2;
  const cardH = CARD_H - inset * 2;

  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = COLORS.card;
  ctx.fill();

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.clip();

  const wash = ctx.createRadialGradient(
    CARD_W * 0.5,
    CARD_H * 0.46,
    40,
    CARD_W * 0.5,
    CARD_H * 0.5,
    620,
  );
  wash.addColorStop(0, 'rgba(70, 110, 130, 0.18)');
  wash.addColorStop(0.45, 'rgba(20, 28, 36, 0.05)');
  wash.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
  ctx.fillStyle = wash;
  ctx.fillRect(cardX - 8, cardY - 8, cardW + 16, cardH + 16);

  drawSparkleField(ctx, entry.id);

  const logo = 92;
  const logoX = cardX + 36;
  const logoY = cardY + 28;
  roundRect(ctx, logoX, logoY, logo, logo, 18);
  ctx.save();
  ctx.clip();
  if (assets.mark) ctx.drawImage(assets.mark, logoX, logoY, logo, logo);
  else drawFallbackMark(ctx, logoX, logoY, logo);
  ctx.restore();

  const titleX = logoX + logo + 18;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 52px ${FONT}`;
  ctx.fillStyle = COLORS.white;
  ctx.fillText('PiShock', titleX, logoY + 48);
  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = COLORS.muted;
  fillTracked(ctx, 'DISCORD ACTIVITY', titleX + 1, logoY + 78, 2.8);

  const place = serverLine(entry);
  if (place) {
    drawDiscordBadge(ctx, cardX + cardW - 36, logoY + logo / 2, place, assets.placeImg);
  }

  drawPersonChip(
    ctx,
    layout.fromX,
    layout.chipY,
    layout.fromW,
    layout.chipH,
    layout.chipFont,
    assets.fromImg,
    entry.from.displayName,
    layout.fromLabel,
    COLORS.chipFrom,
    true,
    '#17607a',
  );
  drawPersonChip(
    ctx,
    layout.toX,
    layout.chipY,
    layout.toW,
    layout.chipH,
    layout.chipFont,
    assets.toImg,
    entry.to.displayName,
    layout.toLabel,
    COLORS.chipTo,
    false,
    '#3c444c',
  );

  const cx = CARD_W / 2;
  drawHeadline(ctx, entry, layout, jx, jy, t);

  if (entry.action === 'beep') {
    drawBeepWaves(ctx, cx, layout.heroY, layout.halfW, layout.gap, frame, frames, t);
  }

  if (entry.action === 'shock') {
    drawOrbitingBolts(
      ctx,
      cx,
      layout.heroY,
      layout.orbitRx,
      layout.orbitRy,
      frame,
      frames,
      layout.boltScale,
      t,
    );
  }

  drawDetail(ctx, entry, cx, layout.detailY);
  const footerY = cardY + cardH - 36;
  const metaY = Math.min(
    detailSegments(entry).length ? layout.detailY + 54 : layout.detailY,
    footerY - 46,
  );
  drawDeviceMeta(ctx, entry, cx, metaY);

  ctx.font = `italic 600 22px ${FONT}`;
  ctx.fillStyle = COLORS.footer;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Shared from PiShock controller', cx, cardY + cardH - 36);

  ctx.restore();

  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 6;
  ctx.shadowColor = 'rgba(70, 220, 255, 0.95)';
  ctx.shadowBlur = 22;
  ctx.stroke();
  ctx.shadowBlur = 8;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#c8f6ff';
  ctx.stroke();
  ctx.restore();
}

async function loadAssets(entry: OfficialLogEntry): Promise<Assets> {
  const [fromImg, toImg, mark, placeImg] = await Promise.all([
    loadImage(entry.from.avatarUrl),
    loadImage(entry.to.avatarUrl),
    loadImage(markUrl),
    loadImage(placeIconUrl(entry)),
  ]);
  return { fromImg, toImg, mark, placeImg };
}

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** Pixels below this alpha are outside the card (or a soft fringe) and stay transparent. */
const ALPHA_CUT = 128;

function nearestOpaqueIndex(
  r: number,
  g: number,
  b: number,
  palette: Array<Array<number>>,
): number {
  let best = 1;
  let bestD = Infinity;
  for (let i = 1; i < palette.length; i++) {
    const c = palette[i] ?? [0, 0, 0];
    const d =
      (r - (c[0] ?? 0)) ** 2 + (g - (c[1] ?? 0)) ** 2 + (b - (c[2] ?? 0)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function encodeGif(frames: ImageData[], delayMs: number): Blob {
  const step = 4 * 23;
  let total = 0;
  const parts: Uint8Array[] = [];
  for (const frame of frames) {
    const src = frame.data;
    const buf = new Uint8Array(Math.ceil(src.length / step) * 4);
    let o = 0;
    for (let i = 0; i < src.length; i += step) {
      if ((src[i + 3] ?? 0) < ALPHA_CUT) continue;
      buf[o++] = src[i] ?? 0;
      buf[o++] = src[i + 1] ?? 0;
      buf[o++] = src[i + 2] ?? 0;
      buf[o++] = 255;
    }
    parts.push(buf.subarray(0, o));
    total += o;
  }
  const keys: Array<[number, number, number]> = [
    [255, 229, 0],
    [255, 75, 214],
    [90, 216, 255],
    [110, 243, 255],
    [247, 249, 251],
    [18, 23, 28],
  ];
  const keyBytes = keys.length * 40 * 4;
  const merged = new Uint8Array(total + keyBytes);
  let off = 0;
  for (const part of parts) {
    merged.set(part, off);
    off += part.length;
  }
  for (const [r, g, b] of keys) {
    for (let n = 0; n < 40; n++) {
      merged[off++] = r;
      merged[off++] = g;
      merged[off++] = b;
      merged[off++] = 255;
    }
  }

  // Index 0 is the GIF transparent color. gifenc also uses index 0 as the screen background.
  const quantized = quantize(merged, 255);
  const palette = [[0, 0, 0], ...(quantized.length ? quantized : [[18, 23, 28]])].slice(0, 256);
  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    const index = applyPalette(frame.data, palette);
    const src = frame.data;
    for (let p = 0, o = 0; o < src.length; o += 4, p++) {
      if ((src[o + 3] ?? 0) < ALPHA_CUT) {
        index[p] = 0;
        continue;
      }
      if (index[p] === 0) {
        index[p] = nearestOpaqueIndex(src[o] ?? 0, src[o + 1] ?? 0, src[o + 2] ?? 0, palette);
      }
    }
    gif.writeFrame(index, frame.width, frame.height, {
      palette: i === 0 ? palette : null,
      delay: delayMs,
      repeat: 0,
      transparent: true,
      transparentIndex: 0,
      dispose: 2,
    });
  });
  gif.finish();
  const bytes = gif.bytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'image/gif' });
}

/**
 * Render a branded share banner for one public log entry.
 * Shock, vibrate, and beep are short looping GIFs.
 */
export async function renderLogShareCard(entry: OfficialLogEntry): Promise<Blob> {
  const plan = motionFor(entry);
  const assets = await loadAssets(entry);
  const { ctx } = makeCanvas();
  const layout = fitLayout(ctx, entry);
  const frames: ImageData[] = [];
  for (let i = 0; i < plan.frames; i++) {
    paintCard(ctx, entry, assets, layout, i, plan.frames, plan.t);
    frames.push(ctx.getImageData(0, 0, CARD_W, CARD_H));
  }
  return encodeGif(frames, plan.delay);
}
