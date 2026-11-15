import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { OfficialLogEntry } from './components/OfficialLogsPanel';
import markUrl from './assets/pishock-mark.png';

/** Wide banner matching the share-moment mock (1024×572 scaled up). */
const CARD_W = 1280;
const CARD_H = 715;

const COLORS = {
  outer: '#23282d',
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

function motionFor(action: OfficialLogEntry['action']): { frames: number; delay: number } {
  if (action === 'vibrate') return { frames: 8, delay: 45 };
  if (action === 'beep') return { frames: 12, delay: 70 };
  return { frames: 12, delay: 75 };
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
  ctx.fillText(label, x + height + 10, y + height / 2 + 1);
}

function drawDiscordBadge(ctx: CanvasRenderingContext2D, right: number, cy: number, label: string) {
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

  ctx.save();
  const scale = (icon * 0.62) / 24;
  ctx.translate(x + icon * 0.19, y + icon * 0.2);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#e7eef3';
  ctx.fill(new Path2D(DISCORD_ICON));
  ctx.restore();

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
    const textPad = Math.max(18, Math.round(chipH * 0.38));
    ctx.font = `700 ${chipFont}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const fromW = chipH + 12 + ctx.measureText(fromLabel).width + textPad;
    const toW = chipH + 12 + ctx.measureText(toLabel).width + textPad;
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
    entry.action === 'vibrate' ? heroY + m.descent : heroY + orbitRy + 30;
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
) {
  const spin = (frame / frames) * Math.PI * 2;
  const spots = [0, Math.PI];
  for (let i = 0; i < spots.length; i++) {
    const a = spin + spots[i];
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 229, 0, 0.8)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.shadowColor = COLORS.yellow;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, a - 0.85, a - 0.08);
    ctx.stroke();
    ctx.restore();

    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const tx = -Math.sin(a) * rx;
    const ty = Math.cos(a) * ry;
    const rot = Math.atan2(ty, tx) + Math.PI / 2;
    drawFilledBolt(ctx, x, y, (i === 0 ? 1.15 : 0.82) * boltScale, rot, COLORS.yellow);
    drawStar(ctx, cx + Math.cos(a - 0.45) * rx, cy + Math.sin(a - 0.45) * ry, 3.2, '#fff6c2', 0.95);
  }
}

function drawBeepWaves(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  frame: number,
  frames: number,
) {
  ctx.save();
  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 3.5;
  ctx.shadowColor = 'rgba(90, 216, 255, 0.85)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const waves = 3;
  for (let i = 0; i < waves; i++) {
    const t = (frame / frames + i / waves) % 1;
    const hGrow = t * 14;
    const vGrow = t * 42;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = i % 2 === 0 ? COLORS.cyan : '#d7f6ff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + hGrow, ry + 8 + vGrow, 0, Math.PI + 0.42, Math.PI * 2 - 0.42);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + hGrow, ry + 8 + vGrow, 0, 0.42, Math.PI - 0.42);
    ctx.stroke();
    ctx.restore();
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
) {
  const cx = CARD_W / 2;
  const color = wordColor(entry.action);
  ctx.font = `italic 800 ${layout.fontSize}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (entry.action === 'vibrate') {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = COLORS.ghost;
    ctx.fillText(layout.headline, cx - 6, layout.heroY);
    ctx.fillStyle = COLORS.magenta;
    ctx.globalAlpha = 0.28;
    ctx.fillText(layout.headline, cx + 5, layout.heroY + 1);
    ctx.restore();
  }
  ctx.fillStyle = color;
  ctx.shadowColor = entry.action === 'vibrate' ? 'rgba(255, 75, 214, 0.95)' : entry.action === 'beep' ? 'rgba(90, 216, 255, 0.9)' : 'rgba(255, 210, 0, 0.9)';
  ctx.shadowBlur = 14;
  ctx.fillText(layout.headline, cx, layout.heroY);
  ctx.shadowBlur = 0;
  ctx.fillText(layout.headline, cx, layout.heroY);
}

function paintCard(
  ctx: CanvasRenderingContext2D,
  entry: OfficialLogEntry,
  assets: Assets,
  layout: Layout,
  frame: number,
  frames: number,
) {
  const jitter = entry.action === 'vibrate' ? VIBE[frame % VIBE.length] : [0, 0];
  const jx = jitter[0] ?? 0;
  const jy = jitter[1] ?? 0;

  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = COLORS.outer;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

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
  ctx.translate(jx, jy);

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
  if (place) drawDiscordBadge(ctx, cardX + cardW - 36, logoY + logo / 2, place);

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
  if (entry.action === 'beep') {
    drawBeepWaves(ctx, cx, layout.heroY, layout.orbitRx, layout.orbitRy, frame, frames);
  }

  drawHeadline(ctx, entry, layout);

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
    );
  }

  drawDetail(ctx, entry, cx, layout.detailY);

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
  const [fromImg, toImg, mark] = await Promise.all([
    loadImage(entry.from.avatarUrl),
    loadImage(entry.to.avatarUrl),
    loadImage(markUrl),
  ]);
  return { fromImg, toImg, mark };
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

function encodeGif(frames: ImageData[], delayMs: number): Blob {
  const step = 4 * 23;
  let total = 0;
  const parts: Uint8Array[] = [];
  for (const frame of frames) {
    const src = frame.data;
    const n = Math.ceil(src.length / step);
    const buf = new Uint8Array(n * 4);
    let o = 0;
    for (let i = 0; i < src.length; i += step) {
      buf[o++] = src[i] ?? 0;
      buf[o++] = src[i + 1] ?? 0;
      buf[o++] = src[i + 2] ?? 0;
      buf[o++] = src[i + 3] ?? 255;
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
    [35, 40, 45],
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

  const palette = quantize(merged, 256);
  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    const index = applyPalette(frame.data, palette);
    gif.writeFrame(index, frame.width, frame.height, {
      palette: i === 0 ? palette : null,
      delay: delayMs,
      repeat: 0,
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
export async function renderLogShareCard(entry: OfficialLogEntry): Promise<Blob> {
  const plan = motionFor(entry.action);
  const assets = await loadAssets(entry);
  const { ctx } = makeCanvas();
  const layout = fitLayout(ctx, entry);
  const frames: ImageData[] = [];
  for (let i = 0; i < plan.frames; i++) {
    paintCard(ctx, entry, assets, layout, i, plan.frames);
    frames.push(ctx.getImageData(0, 0, CARD_W, CARD_H));
  }
  return encodeGif(frames, plan.delay);
}
