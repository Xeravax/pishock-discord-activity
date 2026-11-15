import type { OfficialLogEntry } from './components/OfficialLogsPanel';

const CARD_W = 1280;
const CARD_H = 640;

const COLORS = {
  bg: '#121212',
  panel: '#1a1f24',
  cyan: '#79c6db',
  yellow: '#f4d600',
  muted: '#cfd8dc',
  white: '#f5f5f5',
  fromChip: '#79c6db',
  toChip: '#e8e8e8',
  ink: '#121212',
} as const;

function actionVerb(action: OfficialLogEntry['action']): string {
  if (action === 'vibrate') return 'vibrated';
  if (action === 'beep') return 'beeped';
  if (action === 'shock') return 'shocked';
  return 'hit';
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
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
  ctx.fillStyle = COLORS.ink;
  ctx.font = `700 ${Math.round(radius * 0.95)}px geo, Oxanium, system-ui, sans-serif`;
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
) {
  if (!img) {
    drawLetterAvatar(ctx, cx, cy, radius, name, fallbackFill);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function truncate(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function drawPersonChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  avatar: HTMLImageElement | null,
  name: string,
  chipFill: string,
  avatarFallback: string,
): number {
  const padX = 18;
  const avatarR = 36;
  const height = 84;
  ctx.font = '700 34px geo, Oxanium, system-ui, sans-serif';
  const label = truncate(ctx, name, 280);
  const textW = ctx.measureText(label).width;
  const width = padX + avatarR * 2 + 14 + textW + padX;

  // chip
  const r = height / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  ctx.fillStyle = chipFill;
  ctx.fill();

  drawAvatar(ctx, avatar, x + padX + avatarR, y + height / 2, avatarR, name, avatarFallback);

  ctx.fillStyle = COLORS.ink;
  ctx.font = '700 34px geo, Oxanium, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padX + avatarR * 2 + 14, y + height / 2 + 1);

  return width;
}

/**
 * Render a branded 1280×640 share banner for one public log entry.
 * Returns a PNG blob suitable for Discord’s activity attachment upload.
 */
export async function renderLogShareCard(entry: OfficialLogEntry): Promise<Blob> {
  const [fromImg, toImg] = await Promise.all([
    loadImage(entry.from.avatarUrl),
    loadImage(entry.to.avatarUrl),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  // Background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Soft cyan glow
  const glow = ctx.createRadialGradient(CARD_W * 0.5, CARD_H * 0.35, 40, CARD_W * 0.5, CARD_H * 0.4, 520);
  glow.addColorStop(0, 'rgba(121,198,219,0.18)');
  glow.addColorStop(1, 'rgba(121,198,219,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Inner panel
  const inset = 36;
  roundRect(ctx, inset, inset, CARD_W - inset * 2, CARD_H - inset * 2, 28);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.strokeStyle = 'rgba(121,198,219,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Wordmark
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 42px geo, Oxanium, system-ui, sans-serif';
  ctx.fillStyle = COLORS.white;
  ctx.fillText('Pi', inset + 48, inset + 70);
  const piW = ctx.measureText('Pi').width;
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText('Shock', inset + 48 + piW, inset + 70);

  ctx.font = '600 22px geo, Oxanium, system-ui, sans-serif';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('Discord Activity', inset + 48, inset + 104);

  // Yellow accent bar under brand
  ctx.fillStyle = COLORS.yellow;
  ctx.fillRect(inset + 48, inset + 118, 120, 5);

  // Center stage: person chips + verb
  const stageY = 250;
  const verb = actionVerb(entry.action);

  // Measure chips to center the group
  ctx.font = '700 34px geo, Oxanium, system-ui, sans-serif';
  const fromLabel = truncate(ctx, entry.from.displayName, 280);
  const toLabel = truncate(ctx, entry.to.displayName, 280);
  const fromChipW = 18 + 72 + 14 + ctx.measureText(fromLabel).width + 18;
  const toChipW = 18 + 72 + 14 + ctx.measureText(toLabel).width + 18;

  ctx.font = '700 40px geo, Oxanium, system-ui, sans-serif';
  const verbW = ctx.measureText(verb).width;
  const gap = 28;
  const totalW = fromChipW + gap + verbW + gap + toChipW;
  let x = (CARD_W - totalW) / 2;

  drawPersonChip(ctx, x, stageY, fromImg, entry.from.displayName, COLORS.fromChip, COLORS.cyan);
  x += fromChipW + gap;

  ctx.fillStyle = COLORS.yellow;
  ctx.font = '700 40px geo, Oxanium, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(verb, x, stageY + 42);
  x += verbW + gap;

  drawPersonChip(ctx, x, stageY, toImg, entry.to.displayName, COLORS.toChip, '#bdbdbd');

  // Intensity / duration line
  const bits: string[] = [];
  if (entry.intensity != null) bits.push(`at ${entry.intensity}`);
  if (entry.durationSec != null) {
    const d =
      Number.isInteger(entry.durationSec)
        ? String(entry.durationSec)
        : String(Math.round(entry.durationSec * 10) / 10);
    bits.push(`${d}s`);
  }
  if (bits.length) {
    ctx.font = '700 36px geo, Oxanium, system-ui, sans-serif';
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bits.join('  ·  '), CARD_W / 2, stageY + 160);
  }

  // Footer
  ctx.font = '600 20px geo, Oxanium, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(207,216,220,0.65)';
  ctx.textAlign = 'center';
  ctx.fillText('Shared from PiShock', CARD_W / 2, CARD_H - inset - 36);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Failed to encode share image'));
        else resolve(blob);
      },
      'image/png',
    );
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
