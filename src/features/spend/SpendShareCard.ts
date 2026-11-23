import type { SpendCategoryTotal, SpendMonth } from "./api";
import { spendCategory } from "./categories";
import { changeLabel, changePercent, money, monthLabel, plural, shares } from "./format";

/**
 * "My beauty month": a 9:16 card made for Stories and monthly photo dumps,
 * drawn on a canvas so it can be downloaded or shared as a PNG with no
 * screenshot library. Same layout as the app's `SpendShareCard`: laid out on a
 * 360×640 grid and drawn at 3× for a 1080×1920 Story. Always the cream design
 * (never dark mode) so it looks the same wherever it is posted. With
 * `showAmounts` off, cedi amounts are replaced by percentages and counts.
 */
export const CARD_WIDTH = 360;
export const CARD_HEIGHT = 640;
export const CARD_SCALE = 3;

const INK = "#2E2326";
const SOFT_INK = "#8A767C";
const CREAM = "#FBF1EC";
const ROSE = "#C77489";
const FROST = "rgba(255,255,255,0.7)";
const PAD_X = 28;
const INNER = CARD_WIDTH - PAD_X * 2;

export type CardFonts = { sans: string; script: string };

/** Category icons as images, by slug (see `loadIconImages`). */
export type CardIcons = Map<string, HTMLImageElement>;

/** The app's fonts as the page loaded them (next/font family names), ready to draw with. */
export async function loadCardFonts(): Promise<CardFonts> {
  const style = getComputedStyle(document.documentElement);
  const sans = style.getPropertyValue("--font-jakarta").trim() || "ui-sans-serif, system-ui, sans-serif";
  const script = style.getPropertyValue("--font-sacramento").trim() || "cursive";
  await Promise.all(
    [`500 16px ${sans}`, `700 16px ${sans}`, `40px ${script}`].map((font) =>
      document.fonts.load(font, "Sheree GH₵ 0123456789").catch(() => []),
    ),
  );
  return { sans, script };
}

/**
 * Turns rendered lucide `<svg data-icon="key" data-color="#hex" data-px="16">`
 * elements (the category slug for list rows, `slug:leader` for the stat)
 * into images the canvas can draw, sized for the 3× output so they stay sharp.
 */
export async function loadIconImages(root: HTMLElement): Promise<CardIcons> {
  const icons: CardIcons = new Map();
  const serializer = new XMLSerializer();
  await Promise.all(
    Array.from(root.querySelectorAll<SVGSVGElement>("svg[data-icon]")).map(async (svg) => {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const px = Number(svg.dataset.px ?? 24) * CARD_SCALE;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(px));
      clone.setAttribute("height", String(px));
      clone.setAttribute("stroke", svg.dataset.color ?? INK);
      clone.removeAttribute("class");
      const image = new Image(px, px);
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializer.serializeToString(clone))}`;
      try {
        await image.decode();
        icons.set(svg.dataset.icon ?? "", image);
      } catch {
        // A missing icon leaves its tinted circle empty rather than failing the card.
      }
    }),
  );
  return icons;
}

/** Draws the card onto a 1080×1920 canvas. */
export function drawSpendCard(
  canvas: HTMLCanvasElement,
  data: SpendMonth,
  { showAmounts, fonts, icons }: { showAmounts: boolean; fonts: CardFonts; icons: CardIcons },
) {
  canvas.width = CARD_WIDTH * CARD_SCALE;
  canvas.height = CARD_HEIGHT * CARD_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.setTransform(CARD_SCALE, 0, 0, CARD_SCALE, 0, 0);
  ctx.textBaseline = "middle";

  const font = (weight: 500 | 700, size: number) => `${weight} ${size}px ${fonts.sans}`;
  const spacing = (px: number) => {
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
  };
  const text = (value: string, x: number, lineTop: number, lineHeight: number, align: CanvasTextAlign = "left") => {
    ctx.textAlign = align;
    ctx.fillText(value, x, lineTop + lineHeight / 2);
  };

  // Background and blobs.
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  circle(ctx, 330, 20, 140, "#F5CAD5");
  circle(ctx, 30, 630, 120, "#F8DACB");
  circle(ctx, 349, 245, 35, "#EFD3E4");

  const top = data.categories.slice(0, 4);
  const pct = shares(data.categories.map((c) => c.amount));
  const treats = data.entries.length;
  const leader = data.categories[0] ? spendCategory(data.categories[0].slug, data.categories[0].name) : null;
  const change = changePercent(data.total, data.previous_total);

  // Head: wordmark and pill.
  ctx.fillStyle = ROSE;
  ctx.font = `40px ${fonts.script}`;
  spacing(0);
  text("Sheree", PAD_X, 30, 50);
  ctx.font = font(700, 10);
  spacing(0.4);
  const pillText = "my beauty month";
  const pillW = ctx.measureText(pillText).width + 20;
  roundRect(ctx, CARD_WIDTH - PAD_X - pillW, 43, pillW, 24, 12, FROST);
  ctx.fillStyle = INK;
  text(pillText, CARD_WIDTH - PAD_X - pillW / 2, 43, 24, "center");

  // Month and year.
  ctx.fillStyle = INK;
  ctx.font = font(700, 46);
  spacing(-1);
  text(monthLabel(data.month, { year: false }), PAD_X, 102, 52);
  ctx.fillStyle = SOFT_INK;
  ctx.font = font(500, 16);
  spacing(4);
  text(data.month.slice(0, 4), PAD_X, 154, 22);
  spacing(0);

  // Total.
  let y = 200;
  ctx.fillStyle = SOFT_INK;
  ctx.font = font(500, 13);
  text(showAmounts ? "I spent" : "I treated myself", PAD_X, y, 18);
  y += 18;
  ctx.fillStyle = INK;
  const totalText = showAmounts ? money(data.total) : plural(treats, "time");
  ctx.font = font(700, fitSize(ctx, totalText, 40, INNER, (s) => font(700, s)));
  text(totalText, PAD_X, y, 48);
  y += 48;
  if (showAmounts && change !== null) {
    ctx.fillStyle = ROSE;
    ctx.font = font(700, 12);
    text(changeLabel(data.month, change, { lower: true }), PAD_X, y + 2, 16);
    y += 18;
  }
  y += 16;

  // Category bar.
  drawCategoryBar(ctx, data.categories, PAD_X, y, INNER, 14, 3);
  y += 14 + 18;

  // Top four categories.
  for (const [i, c] of top.entries()) {
    const cat = spendCategory(c.slug, c.name);
    drawIcon(ctx, icons.get(c.slug), cat.color, PAD_X, y, 34);
    const value = showAmounts ? money(c.amount) : `${pct[i]}%`;
    ctx.font = font(700, 15);
    ctx.fillStyle = INK;
    const valueW = ctx.measureText(value).width;
    text(value, CARD_WIDTH - PAD_X, y, 34, "right");
    ctx.font = font(500, 15);
    const nameX = PAD_X + 34 + 10;
    text(ellipsize(ctx, cat.name, CARD_WIDTH - PAD_X - valueW - 10 - nameX), nameX, y, 34);
    y += 34 + 10;
  }

  // Stats, pinned to the bottom above the footer.
  const statsTop = 522;
  const statW = (INNER - 16) / 3;
  const stats: Array<{ value?: string; icon?: string; color?: string; label: string }> = [
    { value: String(data.appointments), label: data.appointments === 1 ? "appointment" : "appointments" },
    { value: String(treats), label: treats === 1 ? "treat" : "treats" },
    {
      icon: `${leader?.slug ?? "other"}:leader`,
      color: leader?.color ?? ROSE,
      label: leader ? `top: ${leader.name.toLowerCase()}` : "top pick",
    },
  ];
  stats.forEach((stat, i) => {
    const x = PAD_X + i * (statW + 8);
    const cx = x + statW / 2;
    roundRect(ctx, x, statsTop, statW, 63, 18, FROST);
    if (stat.icon) {
      const image = icons.get(stat.icon);
      if (image) ctx.drawImage(image, cx - 10, statsTop + 12 + 3, 20, 20);
    } else {
      ctx.fillStyle = INK;
      ctx.font = font(700, 20);
      text(stat.value ?? "", cx, statsTop + 12, 26, "center");
    }
    ctx.fillStyle = SOFT_INK;
    ctx.font = font(500, 10);
    text(ellipsize(ctx, stat.label, statW - 12), cx, statsTop + 12 + 26, 13, "center");
  });

  // Footer.
  ctx.fillStyle = ROSE;
  ctx.font = font(700, 11);
  text("sheree.world", CARD_WIDTH - PAD_X, 601, 15, "right");
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  color: string,
  x: number,
  y: number,
  size: number,
) {
  circle(ctx, x + size / 2, y + size / 2, size / 2, `${color}2E`);
  const inner = Math.round(size * 0.48);
  if (image) ctx.drawImage(image, x + (size - inner) / 2, y + (size - inner) / 2, inner, inner);
}

/** The app's CategoryBar: flex segments with a minimum width, clipped to a pill. */
function drawCategoryBar(
  ctx: CanvasRenderingContext2D,
  categories: SpendCategoryTotal[],
  x: number,
  y: number,
  width: number,
  height: number,
  gap: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height / 2);
  ctx.clip();
  ctx.fillStyle = "#F1DCD9";
  ctx.fillRect(x, y, width, height);
  const widths = segmentWidths(
    categories.map((c) => c.amount),
    width - gap * Math.max(categories.length - 1, 0),
    height / 2,
  );
  let left = x;
  categories.forEach((c, i) => {
    if (widths[i] <= 0) return;
    ctx.fillStyle = spendCategory(c.slug, c.name).color;
    ctx.fillRect(left, y, widths[i], height);
    left += widths[i] + gap;
  });
  ctx.restore();
}

/** Proportional widths where none is narrower than `min` (flex-grow + min-width). */
export function segmentWidths(amounts: number[], available: number, min: number): number[] {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (total <= 0) return amounts.map(() => 0);
  const fixed = new Set<number>();
  let widths = amounts.map((a) => (a / total) * available);
  for (let pass = 0; pass < amounts.length; pass++) {
    const small = widths.findIndex((w, i) => !fixed.has(i) && w < min);
    if (small === -1) break;
    fixed.add(small);
    const free = available - fixed.size * min;
    const flexTotal = amounts.reduce((sum, a, i) => (fixed.has(i) ? sum : sum + a), 0);
    widths = amounts.map((a, i) => (fixed.has(i) ? min : flexTotal > 0 ? (a / flexTotal) * free : 0));
  }
  return widths;
}

/** The largest size up to `max` at which `value` fits `width` (adjustsFontSizeToFit). */
function fitSize(
  ctx: CanvasRenderingContext2D,
  value: string,
  max: number,
  width: number,
  fontAt: (size: number) => string,
) {
  for (let size = max; size > 16; size -= 1) {
    ctx.font = fontAt(size);
    if (ctx.measureText(value).width <= width) return size;
  }
  return 16;
}

function ellipsize(ctx: CanvasRenderingContext2D, value: string, width: number) {
  if (ctx.measureText(value).width <= width) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
