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
  /** Both chips share one width so the composition is mirror-symmetric. */
  chipW: number;
  fromW: number;
  toW: number;
  heroY: number;
  metaY: number;
  /** Centre line of the segmented intensity meter (when intensity is known). */
  meterY: number;
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
  const inset = chipTextInset(height);
  const rightPad = Math.max(34, Math.round(height * 0.38));
  const lane = width - inset - rightPad;
  const labelW = measureLabel(ctx, label, fontPx);
  const textX = x + inset + Math.max(0, (lane - labelW) / 2);
  ctx.fillText(label, textX, y + height / 2 + 1);
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

/** Longest a name chip may grow before its label is truncated with an ellipsis. */
const MAX_CHIP_W = 330;
/** Content area between the header row (logo/title) and the footer caption. */
const BODY_TOP = 18 + 28 + 92 + 18;
const BODY_BOTTOM = CARD_H - 18 - 36 - 26;

function fitLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  chipW: number,
  chipH: number,
  chipFont: number,
): string {
  ctx.font = `700 ${chipFont}px ${FONT}`;
  const rightPad = Math.max(34, Math.round(chipH * 0.38));
  const room = chipW - chipTextInset(chipH) - rightPad;
  if (measureLabel(ctx, label, chipFont) <= room) return label;
  let out = label;
  while (out.length > 1 && measureLabel(ctx, `${out}…`, chipFont) > room) {
    out = [...graphemes(out)].slice(0, -1).join('');
  }
  return `${out.trimEnd()}…`;
}

function hasDeviceMeta(entry: OfficialLogEntry): boolean {
  return Boolean(
    deviceCaption(entry, 'hub') || deviceCaption(entry, 'shocker') || warningCaption(entry),
  );
}

function fitLayout(ctx: CanvasRenderingContext2D, entry: OfficialLogEntry): Layout {
  const headline = headlineFor(entry.action);
  const rawFrom = cleanName(entry.from.displayName);
  const rawTo = cleanName(entry.to.displayName);
  const maxW = CARD_W - 96;
  let fontSize = 100;
  let chipFont = 32;
  let gap = 56;

  const measure = () => {
    const chipH = Math.max(44, Math.round(chipFont * 2.05 + 14));
    const fromW = chipWidth(ctx, rawFrom, chipH, chipFont);
    const toW = chipWidth(ctx, rawTo, chipH, chipFont);
    const chipW = Math.min(MAX_CHIP_W, Math.max(fromW, toW));
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
      chipW,
      halfW: visualHalf,
      ascent,
      descent,
      // Headline stays on the card's centre line, so each side needs its own half.
      total: 2 * (visualHalf + gap + chipW),
    };
  };

  let m = measure();
  let guard = 0;
  while (m.total > maxW && guard < 120) {
    guard += 1;
    if (fontSize > 72) fontSize -= 4;
    else if (gap > 40) gap -= 2;
    else if (chipFont > 24) chipFont -= 1;
    else if (fontSize > 40) fontSize -= 2;
    else if (gap > 32) gap -= 2;
    else chipFont = Math.max(14, chipFont - 1);
    m = measure();
    if (chipFont <= 14 && fontSize <= 40 && gap <= 32) break;
  }

  const fromLabel = fitLabel(ctx, rawFrom, m.chipW, m.chipH, chipFont);
  const toLabel = fitLabel(ctx, rawTo, m.chipW, m.chipH, chipFont);

  // Build the vertical stack relative to the hero line, then centre it in the body.
  const lane = Math.min(36, Math.max(16, gap * 0.42));
  const orbitRx = m.halfW + lane * 0.62;
  const orbitRy = Math.max(m.ascent, m.descent) + 36;
  const boltScale = Math.min(1, lane / 34);
  const shock = entry.action === 'shock' || entry.action === 'other';
  // Shock arcs bow above/below the headline; vibrate's waveform needs similar clearance.
  const fxReach = shock ? orbitRy + 18 : entry.action === 'vibrate' ? m.ascent + 30 : m.ascent;
  const heroTop = -Math.max(m.chipH / 2, m.ascent, fxReach);
  const effectBottom = shock ? orbitRy + 22 : entry.action === 'vibrate' ? m.descent + 24 : m.descent;
  const detailRel = Math.max(effectBottom, m.chipH / 2) + 22;
  const hasDetail = detailSegments(entry).length > 0;
  const hasMeter = entry.intensity != null && Number.isFinite(entry.intensity);
  const meterRel = hasDetail ? detailRel + 44 : detailRel;
  const metaRel = hasMeter ? meterRel + 42 : hasDetail ? detailRel + 54 : detailRel;
  const blockBottom = hasDeviceMeta(entry)
    ? metaRel + 20
    : hasMeter
      ? meterRel + 10
      : hasDetail
        ? detailRel + 20
        : effectBottom;
  const blockCentre = (heroTop + blockBottom) / 2;
  const heroY = Math.round((BODY_TOP + BODY_BOTTOM) / 2 - blockCentre);

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
    chipW: m.chipW,
    fromW: m.chipW,
    toW: m.chipW,
    heroY,
    metaY: heroY + metaRel,
    meterY: heroY + meterRel,
    chipY: heroY - m.chipH / 2,
    fromX: Math.round(cx - m.halfW - gap - m.chipW),
    toX: Math.round(cx + m.halfW + gap),
    detailY: heroY + detailRel,
    orbitRx,
    orbitRy,
    boltScale,
  };
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

// ---------------------------------------------------------------------------
// Animation engine
//
// Every card is a seamless loop: `p` runs 0 → 1 over the loop and every
// periodic effect uses an integer number of cycles, so the last frame flows
// back into the first. One-shot moments (the shock strike) sit inside the loop
// and fully settle before it restarts.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function easeOutCubic(x: number): number {
  const c = clamp01(x);
  return 1 - (1 - c) ** 3;
}

/** 0 → 1 → 0 bump centred on `c` with half-width `w`. */
function bump(p: number, c: number, w: number): number {
  const d = Math.abs(p - c) / w;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
}

/** Progress of `p` through [a, b], clamped to 0..1. */
function span(p: number, a: number, b: number): number {
  return clamp01((p - a) / (b - a));
}

type Motion = { frames: number; delay: number; t: number };

/** Loop length and speed per action. GIF delays are in 10 ms steps. */
function motionFor(entry: OfficialLogEntry): Motion {
  const t = intensityT(entry);
  if (entry.action === 'vibrate') return { frames: 24, delay: 40, t };
  if (entry.action === 'beep') return { frames: 24, delay: 50, t };
  return { frames: 32, delay: 40, t };
}

/** Accent colour per action as an "r, g, b" triple for rgba() strings. */
function accentRgb(action: OfficialLogEntry['action']): string {
  if (action === 'vibrate') return '255, 75, 214';
  if (action === 'beep') return '90, 216, 255';
  return '255, 229, 0';
}

/** Shock timeline (fractions of the loop). */
const SHOCK = {
  chargeEnd: 0.14,
  strike: 0.3,
  arcFade: 0.62,
} as const;

type Star = { x: number; y: number; r: number; color: string; alpha: number; big: boolean; k: number; ph: number };

/** Background stars, fixed per entry; they only twinkle. */
function makeStars(seedKey: string): Star[] {
  const rand = mulberry32(hashSeed(seedKey || 'pishock'));
  const stars: Star[] = [];
  for (let i = 0; i < 64; i++) {
    const x = 64 + rand() * (CARD_W - 128);
    const y = 130 + rand() * (CARD_H - 230);
    const big = rand() < 0.18;
    const r = big ? 2.8 + rand() * 3.2 : 0.8 + rand() * 1.5;
    const alpha = (big ? 0.7 : 0.35) + rand() * 0.28;
    const color = rand() > 0.28 ? '#ffe7a0' : '#f5fcff';
    if (y > CARD_H - 96) continue;
    stars.push({ x, y, r, color, alpha, big, k: rand() < 0.5 ? 1 : 2, ph: rand() });
  }
  return stars;
}

function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], p: number) {
  for (const s of stars) {
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(TAU * (p * s.k + s.ph)));
    const a = s.alpha * tw;
    if (s.big) drawStar(ctx, s.x, s.y, s.r * (0.8 + 0.35 * tw), s.color, a);
    else {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ---- Lightning -------------------------------------------------------------

type Pt = [number, number];

/**
 * Jagged path along a cubic curve from A to B bowing by `bulge` (negative = below).
 * The control points sit straight above the endpoints, so the bolt leaves each end
 * steeply and clears whatever lies between them.
 */
function lightningPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bulge: number,
  jitter: number,
  rand: () => number,
  segs = 26,
): Pt[] {
  const c1x = ax + (bx - ax) * 0.12;
  const c2x = bx - (bx - ax) * 0.12;
  const c1y = ay - bulge * 1.45;
  const c2y = by - bulge * 1.45;
  const pts: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const v = 1 - u;
    const x = v ** 3 * ax + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u ** 3 * bx;
    const y = v ** 3 * ay + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u ** 3 * by;
    const dx = 3 * v * v * (c1x - ax) + 6 * v * u * (c2x - c1x) + 3 * u * u * (bx - c2x);
    const dy = 3 * v * v * (c1y - ay) + 6 * v * u * (c2y - c1y) + 3 * u * u * (by - c2y);
    const len = Math.hypot(dx, dy) || 1;
    const env = Math.sin(Math.PI * u);
    const off = (rand() * 2 - 1) * jitter * (0.25 + env * 0.75);
    pts.push([x + (-dy / len) * off, y + (dx / len) * off]);
  }
  return pts;
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[], upto: number) {
  const last = Math.max(1, Math.min(pts.length - 1, upto * (pts.length - 1)));
  const whole = Math.floor(last);
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i <= whole; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  const frac = last - whole;
  if (frac > 0 && whole + 1 < pts.length) {
    const a = pts[whole]!;
    const b = pts[whole + 1]!;
    ctx.lineTo(a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac);
  }
}

/** Three-layer neon stroke: wide haze, coloured body, white-hot core. */
function strokeBolt(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  upto: number,
  rgb: string,
  t: number,
  alpha: number,
) {
  if (alpha <= 0.01) return;
  const layers: Array<[number, string, number]> = [
    [12 + t * 12, `rgba(${rgb}, ${0.16 * alpha})`, 26],
    [4 + t * 3.5, `rgba(${rgb}, ${0.9 * alpha})`, 14],
    [1.6 + t * 1.4, `rgba(255, 255, 255, ${alpha})`, 4],
  ];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = `rgba(${rgb}, ${0.9 * alpha})`;
  for (const [w, color, blur] of layers) {
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.shadowBlur = blur;
    tracePath(ctx, pts, upto);
    ctx.stroke();
  }
  ctx.restore();
}

/** A few short forks splitting off a bolt. */
function strokeForks(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  upto: number,
  rgb: string,
  t: number,
  alpha: number,
  rand: () => number,
) {
  const forks = 2 + Math.round(t * 4);
  const reach = Math.floor(upto * (pts.length - 1));
  for (let f = 0; f < forks; f++) {
    const at = 3 + Math.floor(rand() * Math.max(1, reach - 5));
    const base = pts[at];
    if (!base) continue;
    const dir = rand() * TAU;
    const len = 26 + rand() * (40 + t * 50);
    const branch: Pt[] = [base];
    for (let i = 1; i <= 4; i++) {
      const u = i / 4;
      branch.push([
        base[0] + Math.cos(dir) * len * u + (rand() - 0.5) * 16,
        base[1] + Math.sin(dir) * len * u + (rand() - 0.5) * 16,
      ]);
    }
    strokeBolt(ctx, branch, 1, rgb, t * 0.4, alpha * 0.55);
  }
}

/** Glowing orb, used for the travelling bolt head and the charge-up. */
function drawOrb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, alpha: number) {
  if (alpha <= 0.01 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
  g.addColorStop(0.3, `rgba(${rgb}, ${0.85 * alpha})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

type Spark = { a: number; v: number; life: number; delay: number; w: number; hot: boolean };

function makeSparks(seedKey: string, t: number): Spark[] {
  const rand = mulberry32(hashSeed(`${seedKey}:sparks`));
  const n = 20 + Math.round(t * 30);
  const out: Spark[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      a: rand() * TAU,
      v: 240 + rand() * (360 + t * 520),
      life: 0.22 + rand() * 0.3,
      delay: rand() * 0.04,
      w: 1.5 + rand() * (1.5 + t * 2),
      hot: rand() < 0.45,
    });
  }
  return out;
}

function drawSparks(
  ctx: CanvasRenderingContext2D,
  sparks: Spark[],
  ox: number,
  oy: number,
  p: number,
  start: number,
) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const s of sparks) {
    const tau = span(p, start + s.delay, start + s.delay + s.life);
    if (tau <= 0 || tau >= 1) continue;
    const dist = s.v * easeOutCubic(tau) * 0.42;
    const x = ox + Math.cos(s.a) * dist;
    const y = oy + Math.sin(s.a) * dist + 120 * tau * tau;
    const tail = 10 + s.v * 0.05 * (1 - tau);
    ctx.globalAlpha = (1 - tau) ** 1.2;
    ctx.strokeStyle = s.hot ? '#ffffff' : COLORS.yellow;
    ctx.shadowColor = 'rgba(255, 214, 0, 0.9)';
    ctx.shadowBlur = 8;
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(s.a) * tail, y - Math.sin(s.a) * tail - 6 * tau);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Shared effects ---------------------------------------------------------

/** Shockwave / ripple ring. */
function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rgb: string,
  alpha: number,
  width: number,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = width;
  ctx.shadowColor = `rgba(${rgb}, ${alpha})`;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** Expanding rounded-rect outline around a chip (vibrate ripples, beep flashes). */
function drawChipOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  pad: number,
  rgb: string,
  alpha: number,
  width = 2.5,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, h / 2 + pad);
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = width;
  ctx.shadowColor = `rgba(${rgb}, ${alpha})`;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.restore();
}

/** Oscilloscope trace across the card (vibrate). */
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  cy: number,
  amp: number,
  cycles: number,
  phase: number,
  rgb: string,
  alpha: number,
  width: number,
) {
  const x0 = 70;
  const x1 = CARD_W - 70;
  ctx.save();
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.shadowColor = `rgba(${rgb}, ${alpha})`;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += 6) {
    const u = (x - x0) / (x1 - x0);
    const taper = Math.sin(Math.PI * u) ** 0.8;
    const y = cy + Math.sin(u * cycles * TAU - phase) * amp * taper;
    if (x === x0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function roundRectPerimeter(w: number, h: number, r: number): number {
  return 2 * (w + h) - 8 * r + TAU * r;
}

/** Two bright comets running around the neon frame — one lap per loop. */
function drawBorderRunners(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  p: number,
  rgb: string,
) {
  const perim = roundRectPerimeter(w, h, r);
  const len = 240;
  ctx.save();
  ctx.lineCap = 'round';
  for (const offset of [0, 0.5]) {
    for (const [lw, color, blur, frac] of [
      [8, `rgba(${rgb}, 0.55)`, 26, 1],
      [3, 'rgba(255, 255, 255, 0.95)', 10, 0.55],
    ] as Array<[number, string, number, number]>) {
      ctx.setLineDash([len * frac, perim - len * frac]);
      ctx.lineDashOffset = -((p + offset) % 1) * perim - len * (1 - frac) * 0.5;
      ctx.lineWidth = lw;
      ctx.strokeStyle = color;
      ctx.shadowColor = `rgba(${rgb}, 0.9)`;
      ctx.shadowBlur = blur;
      roundRect(ctx, x, y, w, h, r);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---- Headline ---------------------------------------------------------------

type HeadlineFx = {
  dx: number;
  dy: number;
  scale: number;
  /** RGB-split distance in px (0 = none). */
  split: number;
  /** Extra glow 0..1 on top of the base glow. */
  glow: number;
  /** Sheen band position 0..1 across the word, or null for none. */
  sheen: number | null;
};

function setHeadlineFont(ctx: CanvasRenderingContext2D, layout: Layout) {
  ctx.font = `italic 800 ${layout.fontSize}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
}

function drawHeadlineFx(
  ctx: CanvasRenderingContext2D,
  entry: OfficialLogEntry,
  layout: Layout,
  fx: HeadlineFx,
  t: number,
  sheenCanvas: HTMLCanvasElement | null,
) {
  const cx = CARD_W / 2 + fx.dx;
  const cy = layout.heroY + fx.dy;
  const color = wordColor(entry.action);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(fx.scale, fx.scale);
  setHeadlineFont(ctx, layout);

  if (fx.split > 0.3) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = COLORS.ghost;
    ctx.fillText(layout.headline, -fx.split, 0);
    ctx.fillStyle = COLORS.magenta;
    ctx.fillText(layout.headline, fx.split * 0.9, 1);
    ctx.restore();
  }

  ctx.fillStyle = color;
  ctx.shadowColor = `rgba(${accentRgb(entry.action)}, 0.95)`;
  ctx.shadowBlur = 8 + t * 14 + fx.glow * 26;
  ctx.fillText(layout.headline, 0, 0);
  ctx.shadowBlur = 0;
  ctx.fillText(layout.headline, 0, 0);
  ctx.restore();

  // Light sheen sweeping across the letters
  if (fx.sheen != null && sheenCanvas) {
    const sctx = sheenCanvas.getContext('2d');
    if (!sctx) return;
    const w = sheenCanvas.width;
    const h = sheenCanvas.height;
    sctx.clearRect(0, 0, w, h);
    sctx.save();
    sctx.translate(w / 2, h / 2);
    sctx.scale(fx.scale, fx.scale);
    setHeadlineFont(sctx, layout);
    sctx.fillStyle = '#fff';
    sctx.fillText(layout.headline, 0, 0);
    sctx.restore();
    sctx.save();
    sctx.globalCompositeOperation = 'source-in';
    const bx = -0.3 * w + fx.sheen * 1.6 * w;
    const g = sctx.createLinearGradient(bx - 90, 0, bx + 90, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, w, h);
    sctx.restore();
    ctx.drawImage(sheenCanvas, cx - w / 2, cy - h / 2);
  }
}

// ---- Intensity meter --------------------------------------------------------

const METER_SEGMENTS = 20;

function meterColor(i: number): string {
  const u = i / (METER_SEGMENTS - 1);
  // cyan → yellow → hot red
  const stops: Array<[number, number, number]> = [
    [90, 216, 255],
    [255, 229, 0],
    [255, 70, 60],
  ];
  const seg = u < 0.55 ? 0 : 1;
  const local = seg === 0 ? u / 0.55 : (u - 0.55) / 0.45;
  const a = stops[seg]!;
  const b = stops[seg + 1]!;
  const mix = (k: number) => Math.round(a[k]! + (b[k]! - a[k]!) * local);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/** Segmented intensity meter with a light front sweeping across the lit part. */
function drawMeter(ctx: CanvasRenderingContext2D, entry: OfficialLogEntry, cy: number, sweep: number) {
  if (entry.intensity == null || !Number.isFinite(entry.intensity)) return;
  const lit = Math.max(1, Math.round((clamp01(entry.intensity / 100) * METER_SEGMENTS)));
  const segW = 18;
  const gap = 5;
  const h = 14;
  const total = METER_SEGMENTS * segW + (METER_SEGMENTS - 1) * gap;
  const x0 = CARD_W / 2 - total / 2;
  const front = sweep * (lit + 2) - 1;
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const x = x0 + i * (segW + gap);
    ctx.save();
    roundRect(ctx, x, cy - h / 2, segW, h, 3);
    if (i < lit) {
      const near = Math.max(0, 1 - Math.abs(i - front) / 2.2);
      ctx.fillStyle = meterColor(i);
      ctx.globalAlpha = 0.72 + near * 0.28;
      ctx.shadowColor = meterColor(i);
      ctx.shadowBlur = 6 + near * 18;
      ctx.fill();
      if (near > 0.05) {
        ctx.globalAlpha = near * 0.75;
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 0;
        roundRect(ctx, x, cy - h / 2, segW, h, 3);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---- Frame composition --------------------------------------------------------

const CARD_INSET = 18;
const CARD_RADIUS = 32;

type Scene = {
  bg: HTMLCanvasElement;
  stars: Star[];
  sparks: Spark[];
  sheen: HTMLCanvasElement;
  seed: number;
};

/** Everything that never moves: card, wash, branding, detail text, device line, base frame. */
function paintBackground(
  ctx: CanvasRenderingContext2D,
  entry: OfficialLogEntry,
  assets: Assets,
  layout: Layout,
) {
  const cardX = CARD_INSET;
  const cardY = CARD_INSET;
  const cardW = CARD_W - CARD_INSET * 2;
  const cardH = CARD_H - CARD_INSET * 2;
  const cx = CARD_W / 2;

  ctx.clearRect(0, 0, CARD_W, CARD_H);
  roundRect(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
  ctx.fillStyle = COLORS.card;
  ctx.fill();

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
  ctx.clip();

  const rgb = accentRgb(entry.action);
  const wash = ctx.createRadialGradient(cx, layout.heroY, 40, cx, layout.heroY + 20, 640);
  wash.addColorStop(0, `rgba(${rgb}, 0.10)`);
  wash.addColorStop(0.35, 'rgba(40, 70, 90, 0.10)');
  wash.addColorStop(1, 'rgba(0, 0, 0, 0.32)');
  ctx.fillStyle = wash;
  ctx.fillRect(cardX - 8, cardY - 8, cardW + 16, cardH + 16);

  // Faint diagonal speed lines, echoing the slanted P of the logo
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 200, 230, 0.035)';
  ctx.lineWidth = 2;
  for (let x = -CARD_H; x < CARD_W + CARD_H; x += 46) {
    ctx.beginPath();
    ctx.moveTo(x, CARD_H);
    ctx.lineTo(x + CARD_H * 0.52, 0);
    ctx.stroke();
  }
  ctx.restore();

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

  drawDetail(ctx, entry, cx, layout.detailY);
  drawDeviceMeta(ctx, entry, cx, layout.metaY);

  ctx.font = `italic 600 22px ${FONT}`;
  ctx.fillStyle = COLORS.footer;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Shared from PiShock controller', cx, cardY + cardH - 36);
  ctx.restore();

  roundRect(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
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

function drawChips(
  ctx: CanvasRenderingContext2D,
  entry: OfficialLogEntry,
  assets: Assets,
  layout: Layout,
  from: { dx: number; dy: number },
  to: { dx: number; dy: number },
) {
  ctx.save();
  ctx.translate(from.dx, from.dy);
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
  ctx.restore();
  ctx.save();
  ctx.translate(to.dx, to.dy);
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
  ctx.restore();
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  entry: OfficialLogEntry,
  assets: Assets,
  layout: Layout,
  scene: Scene,
  frame: number,
  frames: number,
  t: number,
) {
  const p = frame / frames;
  const rgb = accentRgb(entry.action);
  const cardX = CARD_INSET;
  const cardY = CARD_INSET;
  const cardW = CARD_W - CARD_INSET * 2;
  const cardH = CARD_H - CARD_INSET * 2;
  const cy = layout.heroY;
  const fromEdge = layout.fromX + layout.fromW;
  const toEdge = layout.toX;
  const toAvatarX = layout.toX + layout.chipH / 2;

  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.drawImage(scene.bg, 0, 0);

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
  ctx.clip();

  drawStars(ctx, scene.stars, p);

  const fromOff = { dx: 0, dy: 0 };
  let toOff = { dx: 0, dy: 0 };
  const head: HeadlineFx = { dx: 0, dy: 0, scale: 1, split: 0, glow: 0, sheen: null };
  let meterSweep = p;
  const after: Array<() => void> = [];

  if (entry.action === 'vibrate') {
    // Oscilloscope traces behind everything, two beats per loop
    const beat = 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(TAU * p * 2));
    const amp = (layout.chipH * 0.5 + 10 + t * 34) * beat;
    drawWaveform(ctx, cy, amp, 7, TAU * p * 3, '255, 75, 214', 0.7, 3.5);
    drawWaveform(ctx, cy, amp * 0.72, 11, TAU * p * 2 + 1.3, '110, 243, 255', 0.42, 2.2);
    drawWaveform(ctx, cy, amp * 1.15, 4, -TAU * p + 0.6, '255, 75, 214', 0.18, 6);

    // Target chip buzzes; ghost outlines split into magenta / cyan
    const unit = VIBE[frame % VIBE.length] ?? [0, 0];
    const buzz = 0.6 + t * 1.6;
    toOff = { dx: unit[0] * buzz * 0.6, dy: unit[1] * buzz * 0.5 };
    for (let k = 0; k < 3; k++) {
      const q = (p * 2 + k / 3) % 1;
      drawChipOutline(ctx, layout.toX, layout.chipY, layout.toW, layout.chipH, 4 + q * (34 + t * 40), '255, 75, 214', (1 - q) * 0.55, 2.5 * (1 - q) + 0.8);
    }
    after.push(() => {
      drawChipOutline(ctx, layout.toX + toOff.dx - 5, layout.chipY + toOff.dy, layout.toW, layout.chipH, 0, '110, 243, 255', 0.35 * t + 0.1, 2);
      drawChipOutline(ctx, layout.toX + toOff.dx + 5, layout.chipY + toOff.dy, layout.toW, layout.chipH, 0, '255, 75, 214', 0.35 * t + 0.1, 2);
    });

    const hUnit = VIBE[(frame + 3) % VIBE.length] ?? [0, 0];
    const hAmp = (1.15 + t * t * 32) / 9;
    head.dx = hUnit[0] * hAmp;
    head.dy = hUnit[1] * hAmp * 0.6;
    head.split = 2 + t * 10 * (0.6 + 0.4 * beat);
    head.glow = 0.3 * beat;
    head.sheen = p < 0.45 ? span(p, 0.05, 0.45) : null;
  } else if (entry.action === 'beep') {
    // Sonar rings launched on each of the two pings per loop
    for (const start of [0.04, 0.54]) {
      for (let k = 0; k < 2; k++) {
        const raw = p - start - k * 0.07;
        const q = span(raw < 0 ? raw + 1 : raw, 0, 0.62);
        if (q <= 0 || q >= 1) continue;
        const r = layout.halfW * 0.75 + easeOutCubic(q) * 560;
        drawRing(ctx, CARD_W / 2, cy, r, r * 0.4, '90, 216, 255', (1 - q) ** 1.6 * 0.85, 4 * (1 - q) + 1.2);
      }
    }
    drawBeepWaves(ctx, CARD_W / 2, cy, layout.halfW, layout.gap, frame, frames, t);
    const ping = Math.max(bump(p, 0.06, 0.08), bump(p, 0.56, 0.08), bump(p, 1.06, 0.08));
    head.scale = 1 + 0.06 * ping * (0.6 + t * 0.6);
    head.glow = ping;
    head.sheen = span(p, 0.15, 0.5) > 0 && p < 0.5 ? span(p, 0.15, 0.5) : null;
    after.push(() => {
      drawChipOutline(ctx, layout.fromX, layout.chipY, layout.fromW, layout.chipH, 2 + ping * 6, '90, 216, 255', ping * 0.8);
      drawChipOutline(ctx, layout.toX, layout.chipY, layout.toW, layout.chipH, 2 + ping * 6, '90, 216, 255', ping * 0.8);
    });
  } else {
    // SHOCK: charge → bolt travels sender → target → strike → crackling afterglow
    const rand = mulberry32(scene.seed + frame * 7919);
    const charge = span(p, 0, SHOCK.chargeEnd);
    const travel = span(p, SHOCK.chargeEnd, SHOCK.strike);
    const sinceStrike = p - SHOCK.strike;
    const struck = sinceStrike >= 0;
    const arcAlpha = !struck
      ? p >= SHOCK.chargeEnd
        ? 1
        : 0
      : 1 - span(p, SHOCK.strike + 0.12, SHOCK.arcFade);
    const flicker = 0.75 + rand() * 0.25;
    const jitter = 14 + t * 22;
    // Arcs leave from the chips' top/bottom inner corners and bow clear of the word
    const lift = layout.chipH * 0.32;
    const bulgeUp = layout.ascent + 18;
    const bulgeDown = -(layout.descent + 18);
    meterSweep = span(p, SHOCK.chargeEnd, SHOCK.strike + 0.05);

    // Charge-up: orb + crackles at the sender
    if (p < SHOCK.strike) {
      drawOrb(ctx, fromEdge + 6, cy, 18 + charge * (26 + t * 26), rgb, 0.35 + charge * 0.6);
      const crackles = 2 + Math.round(charge * 3);
      for (let i = 0; i < crackles; i++) {
        const a = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.4;
        const len = 30 + rand() * 50 * (0.4 + charge);
        const path = lightningPath(fromEdge, cy, fromEdge + Math.cos(a) * len + 20, cy + Math.sin(a) * len, 0, 9, rand, 6);
        strokeBolt(ctx, path, 1, rgb, t * 0.5, (0.3 + charge * 0.6) * flicker);
      }
    }

    // Main arcs above and below the word
    if (arcAlpha > 0) {
      const upto = struck ? 1 : easeOutCubic(travel);
      for (const bulge of [bulgeUp, bulgeDown]) {
        const y = cy - Math.sign(bulge) * lift;
        const path = lightningPath(fromEdge - 14, y, toEdge + 14, y, bulge, jitter, rand);
        strokeBolt(ctx, path, upto, rgb, t, arcAlpha * flicker);
        if (struck && t > 0.15) strokeForks(ctx, path, upto, rgb, t, arcAlpha * flicker, rand);
        if (!struck) {
          const lead = path[Math.round(upto * (path.length - 1))];
          if (lead) drawOrb(ctx, lead[0], lead[1], 22 + t * 16, rgb, 0.9);
        }
      }
    }

    // Impact: shockwave rings + sparks + shake + flash
    if (struck) {
      for (let k = 0; k < 2; k++) {
        const q = span(p, SHOCK.strike + k * 0.06, SHOCK.strike + k * 0.06 + 0.36);
        if (q > 0 && q < 1) {
          const r = layout.chipH * 0.5 + easeOutCubic(q) * (150 + t * 210);
          drawRing(ctx, toAvatarX, cy, r, r * 0.8, rgb, (1 - q) * 0.85, 2 + (1 - q) * (3 + t * 4));
        }
      }
      after.push(() => drawSparks(ctx, scene.sparks, toAvatarX, cy, p, SHOCK.strike));
      const decay = 1 - span(p, SHOCK.strike, SHOCK.strike + 0.2);
      const shake = (3 + t * 13) * decay * decay;
      const ang = sinceStrike * 140;
      toOff = { dx: Math.sin(ang) * shake * 1.4, dy: Math.cos(ang * 1.3) * shake * 0.8 };
      head.dx = Math.sin(ang * 0.9 + 1) * shake * 0.6;
      head.dy = Math.cos(ang * 1.1) * shake * 0.4;
      after.push(() => {
        const hit = bump(p, SHOCK.strike + 0.02, 0.07);
        drawChipOutline(ctx, layout.toX + toOff.dx, layout.chipY + toOff.dy, layout.toW, layout.chipH, 0, rgb, 0.4 + hit * 0.6, 3 + hit * 3);
      });

      // Residual crackle on the target after the arcs fade
      if (p > SHOCK.arcFade - 0.05 && p < 0.92 && rand() < 0.55 * (0.4 + t)) {
        const a = rand() * TAU;
        const len = 24 + rand() * 40;
        const path = lightningPath(toAvatarX, cy, toAvatarX + Math.cos(a) * len, cy + Math.sin(a) * len, 0, 7, rand, 5);
        strokeBolt(ctx, path, 1, rgb, 0.2, 0.55);
      }
    }

    const punch = bump(p, SHOCK.strike + 0.02, 0.07);
    head.scale = 1 + (0.06 + t * 0.1) * punch;
    head.split = (3 + t * 12) * punch;
    head.glow = Math.max(punch, 0.15 + 0.15 * (0.5 + 0.5 * Math.sin(TAU * p * 2)));
    head.sheen = p > 0.6 && p < 0.92 ? span(p, 0.6, 0.92) : null;

    // Brief white-gold flash across the whole card on impact
    const flash = bump(p, SHOCK.strike + 0.01, 0.035) * (0.1 + t * 0.16);
    if (flash > 0.005) {
      after.push(() => {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255, 240, 180, ${flash})`;
        ctx.fillRect(cardX, cardY, cardW, cardH);
        ctx.restore();
      });
    }
  }

  drawChips(ctx, entry, assets, layout, fromOff, toOff);
  drawHeadlineFx(ctx, entry, layout, head, t, scene.sheen);
  drawMeter(ctx, entry, layout.meterY, meterSweep);
  for (const fn of after) fn();

  ctx.restore();

  drawBorderRunners(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS, p, rgb);
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
  let prev: Uint8Array | null = null;
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
    // Frame-diff: pixels identical to the previous frame become transparent and the
    // previous frame is kept (dispose 1). Unchanged areas then compress to almost
    // nothing, which keeps the longer, richer loops small enough to upload.
    let out = index;
    if (prev) {
      out = new Uint8Array(index);
      for (let k = 0; k < out.length; k++) {
        if (out[k] === prev[k]) out[k] = 0;
      }
    }
    prev = index;
    gif.writeFrame(out, frame.width, frame.height, {
      palette: i === 0 ? palette : null,
      delay: delayMs,
      repeat: 0,
      transparent: true,
      transparentIndex: 0,
      dispose: 1,
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
async function buildScene(
  entry: OfficialLogEntry,
  assets: Assets,
  layout: Layout,
  t: number,
): Promise<Scene> {
  const bg = document.createElement('canvas');
  bg.width = CARD_W;
  bg.height = CARD_H;
  const bctx = bg.getContext('2d');
  if (!bctx) throw new Error('Canvas unsupported');
  paintBackground(bctx, entry, assets, layout);
  const sheen = document.createElement('canvas');
  sheen.width = Math.ceil(layout.halfW * 2 + layout.fontSize * 1.2);
  sheen.height = Math.ceil(layout.fontSize * 1.8);
  return {
    bg,
    sheen,
    stars: makeStars(entry.id),
    sparks: makeSparks(entry.id, t),
    seed: hashSeed(entry.id),
  };
}

/** Render every frame of the looping card (also used by the demo preview). */
export async function renderLogShareFrames(
  entry: OfficialLogEntry,
): Promise<{ frames: ImageData[]; delay: number }> {
  const plan = motionFor(entry);
  const assets = await loadAssets(entry);
  const { ctx } = makeCanvas();
  const layout = fitLayout(ctx, entry);
  const scene = await buildScene(entry, assets, layout, plan.t);
  const frames: ImageData[] = [];
  for (let i = 0; i < plan.frames; i++) {
    paintFrame(ctx, entry, assets, layout, scene, i, plan.frames, plan.t);
    frames.push(ctx.getImageData(0, 0, CARD_W, CARD_H));
  }
  return { frames, delay: plan.delay };
}

/**
 * Render a branded share banner for one public log entry.
 * Shock, vibrate, and beep are seamless looping GIFs.
 */
export async function renderLogShareCard(entry: OfficialLogEntry): Promise<Blob> {
  const { frames, delay } = await renderLogShareFrames(entry);
  return encodeGif(frames, delay);
}
