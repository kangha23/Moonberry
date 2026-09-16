import { HOTBAR_SIZE } from '../systems/inventory';

/**
 * The HUD's fixed measurements.
 *
 * Sizes, not positions. Where each of these sits is worked out from the size
 * of the canvas every time the window changes, because the canvas is now the
 * window rather than a fixed rectangle in the middle of a web page — and the
 * bug that started all of this was a hotbar whose y came from a constant and
 * ended up below the fold on a 1440x900 screen.
 */
export const HUD = {
  margin: 14,
  /** The bar along the bottom carrying what is in hand, and the prompt. */
  promptHeight: 50,
  /** One hotbar cell at full size, and how far apart two of them sit. */
  cell: 36,
  /** The smallest a cell is ever drawn, however narrow the window gets. */
  cellMin: 14,
  gap: 4,
  /**
   * The wood round one cell, and the air inside it.
   *
   * `slotBorder` is the nine-slice's corner size, which does not stretch when
   * the cell does — so it is 4px of frame at every cell size, and the space a
   * picture actually has is the cell less twice that. `iconPad` is the gap
   * left inside the wood so the icon reads as sitting in the slot rather than
   * jammed against it: without it a tool drawn to the full width of its own
   * 16px tile crossed the frame and overlapped the cell next door.
   */
  slotBorder: 4,
  iconPad: 2,
  clock: { width: 196, height: 92 },
  quest: { width: 196, height: 72, bar: 6 },
  energy: { width: 24, height: 132, minHeight: 48 },
  /** The health tube stands this far to the left of the energy one. */
  healthGap: 10,
} as const;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HudLayout {
  width: number;
  height: number;
  /** Bottom bar: held item and prompt. Top-left corner and size. */
  prompt: Box;
  /** Cell centres run from `x + cell / 2`, and `y` is the centre line. */
  hotbar: { x: number; y: number; cell: number; gap: number; width: number };
  /** Top-left corners of the three plates that carry world information. */
  clock: Box;
  quest: Box;
  area: { x: number; y: number; maxWidth: number };
  /** The energy tube, filled from the bottom up. */
  energy: Box;
  /**
   * The health tube (spec 13), beside the energy tube and the same size, so
   * the two read as a pair: what the day has left, and what the mine has.
   * Always laid out; whether it is drawn is `showHealthBar`'s decision.
   */
  health: Box;
}

/**
 * How big an icon is drawn in a hotbar cell of this size.
 *
 * A size rather than a scale, so it does not matter whether the item's picture
 * is a 16px generated icon or something else that got assigned to it later: a
 * cell is a fixed hole and everything put in it is drawn to fit. The previous
 * arrangement multiplied a 16px icon by 1.75 to get 28, which is the inside of
 * a 36px cell to the pixel — no border, no margin, and any picture that used
 * its full tile ran over the frame onto its neighbour.
 *
 * Whole pixels, because half a pixel of a nearest-neighbour sprite is a row of
 * it that is twice as thick as the rest.
 */
export function hotbarIconSize(cell: number): number {
  const inner = cell - HUD.slotBorder * 2;
  return Math.max(6, Math.floor(inner - HUD.iconPad * 2));
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Where every piece of the HUD goes, for a canvas of this size.
 *
 * A pure function of the two numbers, so the arrangement can be checked
 * without a browser — the hotbar being on screen at 1366x768 is the reason
 * this whole visual pass exists, and it should not take a screenshot to know
 * whether it still is.
 *
 * Read in screen pixels with the origin at the top-left of the canvas. The
 * camera's zoom does not appear anywhere in here on purpose: the HUD is drawn
 * at 1:1 whatever the world is magnified to, which is what keeps a 12px label
 * readable on a 4K monitor.
 */
export function hudLayout(width: number, height: number): HudLayout {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const m = HUD.margin;

  const prompt: Box = {
    x: m,
    y: Math.max(0, h - m - HUD.promptHeight),
    width: Math.max(80, w - m * 2),
    height: HUD.promptHeight,
  };

  // Twelve cells always, even when the last of them are empty: a bar that
  // shrank with the inventory would slide slot 5 out from under the 5 key.
  // On a narrow window the cells get smaller rather than fewer.
  const cell = clamp(
    Math.floor((w - m * 2 + HUD.gap) / HOTBAR_SIZE) - HUD.gap,
    HUD.cellMin,
    HUD.cell,
  );
  const hotbarWidth = HOTBAR_SIZE * (cell + HUD.gap) - HUD.gap;
  const hotbar = {
    x: Math.max(0, Math.round((w - hotbarWidth) / 2)),
    y: Math.max(m + cell / 2, prompt.y - 10 - cell / 2),
    cell,
    gap: HUD.gap,
    width: hotbarWidth,
  };

  const clock: Box = { x: w - m - HUD.clock.width, y: m, ...HUD.clock };
  const quest: Box = { x: w - m - HUD.quest.width, y: clock.y + clock.height + 8, ...HUD.quest };
  const area = { x: m, y: m, maxWidth: Math.max(96, clock.x - m - 12) };

  // The tube stands on the hotbar rather than beside it, because the hotbar
  // is centred and on a narrow window its right-hand end reaches the margin.
  const floor = hotbar.y - cell / 2 - 12;
  const ceiling = quest.y + quest.height + 12;
  const energyHeight = Math.max(
    HUD.energy.minHeight,
    Math.min(HUD.energy.height, Math.max(0, floor - ceiling)),
  );
  const energy: Box = {
    x: w - m - HUD.energy.width,
    y: floor - energyHeight,
    width: HUD.energy.width,
    height: energyHeight,
  };

  const health: Box = {
    x: Math.max(0, energy.x - HUD.healthGap - HUD.energy.width),
    y: energy.y,
    width: HUD.energy.width,
    height: energy.height,
  };

  return { width: w, height: h, prompt, hotbar, clock, quest, area, energy, health };
}

/**
 * The boxes a click lands on the HUD rather than on the world.
 *
 * Listed as separate rectangles rather than one band along the bottom, so the
 * empty canvas either side of the hotbar is still world you can hoe.
 */
export function hudZones(layout: HudLayout): Box[] {
  const { hotbar, prompt, clock, quest, energy, health, area } = layout;
  return [
    { x: area.x - 6, y: area.y - 6, width: Math.min(area.maxWidth, 300), height: 62 },
    { x: clock.x - 6, y: clock.y - 6, width: clock.width + 12, height: clock.height + 12 },
    { x: quest.x - 6, y: quest.y - 6, width: quest.width + 12, height: quest.height + 12 },
    { x: energy.x - 8, y: energy.y - 18, width: energy.width + 16, height: energy.height + 26 },
    { x: health.x - 8, y: health.y - 18, width: health.width + 16, height: health.height + 26 },
    {
      x: hotbar.x - 8,
      y: hotbar.y - hotbar.cell / 2 - 8,
      width: hotbar.width + 16,
      height: hotbar.cell + 16,
    },
    prompt,
  ];
}

/**
 * Where the board is on a shop front, as fractions of the drawing.
 *
 * Fractions rather than pixels so it holds for the placeholder front and for
 * whatever replaces it: the stand-in in `createPixelArtTextures` paints its
 * blank board inside exactly this box, and a hand-drawn front has to leave its
 * board here too. Written down once, so the picture and the lettering over it
 * cannot disagree about where the board is.
 */
export const SIGNBOARD = { left: 0.12, right: 0.88, top: 0.1, bottom: 0.28 } as const;

/** The smallest the lettering on a board is drawn, in world pixels. */
export const SIGN_FONT_MIN = 6;

/**
 * How wide one capital is against its height in the system faces the sign
 * uses — a little generous, so a board never has to be measured twice.
 */
const SIGN_GLYPH_WIDTH = 0.66;

export interface SignLayout {
  /** The centre of the board, in world pixels. The text is centred on it. */
  x: number;
  y: number;
  /** The board itself, which the lettering never leaves. */
  board: Box;
  /** The pixel size of the lettering. */
  fontSize: number;
}

/**
 * Where a shop's sign goes, and how big, over the drawing as it stands.
 *
 * Pure, so the arithmetic is tested rather than eyeballed: `drawn` is the
 * picture's rectangle in the world (a front taller than its footprint rises
 * out of it), and the lettering is as tall as the board allows and then
 * shrunk until the whole name fits across it. A long name on a narrow front
 * gets smaller letters rather than letters off the edge of the board.
 */
export function signLayout(drawn: Box, text: string): SignLayout {
  return letter(place(drawn, SIGNBOARD), text);
}

/** A box as fractions of a drawing, the way `SIGNBOARD` is. */
export interface FractionBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The road sign's board, and where each of its lines goes on it.
 *
 * Modelled on a Vietnamese direction sign: a small line ("Khu phố"), the place
 * in capitals, the arrow, and a small line under it. A sign with fewer lines
 * uses the first slots it needs from the top, and always the capitals.
 */
export const SIGNPOST = {
  board: { left: 0.03, right: 0.97, top: 0.02, bottom: 0.66 },
  top: { left: 0.1, right: 0.9, top: 0.07, bottom: 0.2 },
  name: { left: 0.07, right: 0.93, top: 0.2, bottom: 0.38 },
  arrow: { left: 0.22, right: 0.78, top: 0.4, bottom: 0.51 },
  bottom: { left: 0.1, right: 0.9, top: 0.52, bottom: 0.63 },
} as const satisfies Record<string, FractionBox>;

/** The cột mốc: a line on the red cap, and a line on the white stone. */
export const MILESTONE = {
  cap: { left: 0.12, right: 0.88, top: 0.1, bottom: 0.36 },
  stone: { left: 0.08, right: 0.92, top: 0.46, bottom: 0.78 },
} as const satisfies Record<string, FractionBox>;

export type BoardKind = 'shopfront' | 'signpost' | 'milestone';

export interface BoardLine extends SignLayout {
  text: string;
  /** Which slot on the board the line is in, for its colour. */
  slot: string;
}

export interface BoardLayout {
  lines: BoardLine[];
  /** Where the arrow goes, for a board that has one. */
  arrow: Box | null;
}

function place(drawn: Box, box: FractionBox): Box {
  return {
    x: drawn.x + drawn.width * box.left,
    y: drawn.y + drawn.height * box.top,
    width: drawn.width * (box.right - box.left),
    height: drawn.height * (box.bottom - box.top),
  };
}

/**
 * The smallest a road sign is lettered, in world pixels.
 *
 * Below the shop fronts' floor, because a road sign is one tile and a shop is
 * five: at the camera's zoom and `SIGN_RESOLUTION` this is still a crisp line
 * on screen, where the shop fronts' floor would push the name off the board.
 */
export const SIGNPOST_FONT_MIN = 3;

function letter(board: Box, text: string, min = SIGN_FONT_MIN): SignLayout {
  const characters = Math.max(1, [...text].length);
  const byHeight = Math.floor(board.height * 0.72);
  const byWidth = Math.floor(board.width / (characters * SIGN_GLYPH_WIDTH));
  return {
    x: board.x + board.width / 2,
    y: board.y + board.height / 2,
    board,
    fontSize: Math.max(min, Math.min(byHeight, byWidth)),
  };
}

/** Which slots a board of this kind fills, for this many lines, top to bottom. */
function slotsFor(kind: BoardKind, count: number): Array<[string, FractionBox]> {
  if (kind === 'shopfront') return [['board', SIGNBOARD]];
  if (kind === 'milestone') {
    return count >= 2
      ? [
          ['cap', MILESTONE.cap],
          ['stone', MILESTONE.stone],
        ]
      : [['stone', MILESTONE.stone]];
  }
  const all: Array<[string, FractionBox]> = [
    ['top', SIGNPOST.top],
    ['name', SIGNPOST.name],
    ['bottom', SIGNPOST.bottom],
  ];
  if (count <= 1) return [all[1]];
  if (count === 2) return all.slice(0, 2);
  return all;
}

/**
 * Every line of a board, placed and sized, and where its arrow goes.
 *
 * Pure for the same reason `signLayout` is. Each line is sized to its own slot,
 * so the place name in capitals is big and the distance under the arrow is
 * small, and a long name shrinks rather than running off the board. Lines past
 * what the board has slots for are dropped — the map parser has already
 * refused a sign with too many, so this never happens in a shipped map.
 */
export function boardLayout(kind: BoardKind, drawn: Box, lines: readonly string[]): BoardLayout {
  const slots = slotsFor(kind, lines.length);
  return {
    lines: slots
      .slice(0, lines.length)
      .map(([slot, box], index) => ({
        ...letter(place(drawn, box), lines[index], kind === 'shopfront' ? SIGN_FONT_MIN : SIGNPOST_FONT_MIN),
        text: lines[index],
        slot,
      })),
    arrow: kind === 'signpost' ? place(drawn, SIGNPOST.arrow) : null,
  };
}
