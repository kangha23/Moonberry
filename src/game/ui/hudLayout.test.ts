import { describe, expect, it } from 'vitest';
import {
  HUD,
  SIGNBOARD,
  SIGNPOST,
  SIGN_FONT_MIN,
  boardLayout,
  hotbarIconSize,
  hudLayout,
  hudZones,
  signLayout,
} from './hudLayout';
import { HOTBAR_SIZE } from '../systems/inventory';

/** Every window worth caring about, plus a few nobody should have to. */
const SIZES: Array<[number, number]> = [
  [400, 700],
  [640, 400],
  [1024, 640],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [320, 240],
];

describe('hudLayout', () => {
  /**
   * The regression the whole visual pass was written for.
   *
   * The hotbar used to sit at a y measured from a 640px-tall canvas that was
   * then placed 300px down a scrolling page: on a 1440x900 screen a player had
   * to scroll to see what they were holding. There is no page to scroll now,
   * and this is the assertion that keeps it that way.
   */
  it('keeps the hotbar on screen at every size', () => {
    for (const [width, height] of SIZES) {
      const { hotbar, prompt } = hudLayout(width, height);

      expect(hotbar.x).toBeGreaterThanOrEqual(0);
      expect(hotbar.x + hotbar.width).toBeLessThanOrEqual(width);
      expect(hotbar.y - hotbar.cell / 2).toBeGreaterThanOrEqual(0);
      expect(hotbar.y + hotbar.cell / 2).toBeLessThanOrEqual(height);
      // And above the prompt bar rather than under it.
      expect(hotbar.y + hotbar.cell / 2).toBeLessThanOrEqual(prompt.y);
    }
  });

  it('keeps every plate inside the canvas', () => {
    for (const [width, height] of SIZES) {
      const layout = hudLayout(width, height);
      for (const box of [layout.prompt, layout.clock, layout.quest, layout.energy, layout.health]) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(height);
      }
    }
  });

  it('centres the hotbar', () => {
    const { hotbar } = hudLayout(1440, 900);
    expect(Math.abs(hotbar.x - (1440 - hotbar.width - hotbar.x))).toBeLessThanOrEqual(1);
  });

  it('always draws twelve cells, shrinking them rather than dropping any', () => {
    for (const [width, height] of SIZES) {
      const { hotbar } = hudLayout(width, height);
      expect(hotbar.width).toBe(HOTBAR_SIZE * (hotbar.cell + hotbar.gap) - hotbar.gap);
      expect(hotbar.cell).toBeGreaterThanOrEqual(HUD.cellMin);
      expect(hotbar.cell).toBeLessThanOrEqual(HUD.cell);
    }
  });

  it('never grows the cells past their design size on a huge screen', () => {
    expect(hudLayout(3840, 2160).hotbar.cell).toBe(HUD.cell);
  });

  it('keeps every icon inside the wood of its own cell', () => {
    // The bug this replaces: a scale, not a size. Sixteen pixels of icon at
    // 1.75x is 28, the inside of a 36px cell to the pixel, so a picture drawn
    // to the edge of its own tile sat on the frame and spilled into the slot
    // next door. An icon has to fit inside the border with room to spare at
    // every cell size the bar is ever drawn at, not just the design one.
    for (const [width, height] of SIZES) {
      const { hotbar } = hudLayout(width, height);
      const icon = hotbarIconSize(hotbar.cell);
      expect(icon).toBeLessThanOrEqual(hotbar.cell - HUD.slotBorder * 2);
      expect(icon).toBeGreaterThan(0);
      expect(Number.isInteger(icon)).toBe(true);
    }
  });

  it('gives the energy tube a height even when there is no room for one', () => {
    const { energy } = hudLayout(640, 400);
    expect(energy.height).toBeGreaterThanOrEqual(HUD.energy.minHeight);
  });

  it('stands the health tube beside the energy tube, the same size and never on top of it', () => {
    for (const [width, height] of SIZES) {
      const { energy, health } = hudLayout(width, height);
      expect(health.height).toBe(energy.height);
      expect(health.width).toBe(energy.width);
      expect(health.y).toBe(energy.y);
      expect(health.x + health.width).toBeLessThanOrEqual(energy.x);
    }
  });

  it('claims the health tube for the HUD, so a click on it is not a swing', () => {
    const layout = hudLayout(1440, 900);
    const { health } = layout;
    const inside = hudZones(layout).some(
      (z) => health.x + 4 >= z.x && health.x + 4 <= z.x + z.width && health.y + 4 >= z.y && health.y + 4 <= z.y + z.height,
    );
    expect(inside).toBe(true);
  });

  it('leaves the middle of the screen free of HUD', () => {
    const layout = hudLayout(1440, 900);
    const middle = { x: 720, y: 450 };
    for (const zone of hudZones(layout)) {
      const inside =
        middle.x >= zone.x &&
        middle.x <= zone.x + zone.width &&
        middle.y >= zone.y &&
        middle.y <= zone.y + zone.height;
      expect(inside).toBe(false);
    }
  });

  it('claims the hotbar and the prompt bar for the HUD', () => {
    const layout = hudLayout(1440, 900);
    const zones = hudZones(layout);
    const covers = (x: number, y: number) =>
      zones.some((z) => x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height);

    expect(covers(layout.hotbar.x + 4, layout.hotbar.y)).toBe(true);
    expect(covers(layout.prompt.x + 20, layout.prompt.y + 10)).toBe(true);
    expect(covers(layout.clock.x + 10, layout.clock.y + 10)).toBe(true);
  });
});

describe('signLayout', () => {
  /** A shop front as the street draws it: five tiles wide, four tall. */
  const FRONT = { x: 32, y: 160, width: 160, height: 128 };

  it('puts the board where the drawing leaves it blank, and centres the name on it', () => {
    const layout = signLayout(FRONT, 'CHÈ');
    expect(layout.board.x).toBeCloseTo(FRONT.x + FRONT.width * SIGNBOARD.left);
    expect(layout.board.y).toBeCloseTo(FRONT.y + FRONT.height * SIGNBOARD.top);
    expect(layout.board.x + layout.board.width).toBeCloseTo(FRONT.x + FRONT.width * SIGNBOARD.right);
    expect(layout.board.y + layout.board.height).toBeCloseTo(FRONT.y + FRONT.height * SIGNBOARD.bottom);
    expect(layout.x).toBeCloseTo(layout.board.x + layout.board.width / 2);
    expect(layout.y).toBeCloseTo(layout.board.y + layout.board.height / 2);
  });

  it('letters a short name as tall as the board allows, and no taller', () => {
    const layout = signLayout(FRONT, 'CHÈ');
    expect(layout.fontSize).toBeLessThanOrEqual(layout.board.height);
    expect(layout.fontSize).toBe(Math.floor(layout.board.height * 0.72));
  });

  it('shrinks a long name until it fits across the board', () => {
    const short = signLayout(FRONT, 'CHÈ');
    const long = signLayout(FRONT, 'CƠM BÌNH DÂN NGON');
    expect(long.fontSize).toBeLessThan(short.fontSize);
    // A generous estimate of the lettering's width still stays on the board.
    expect([...'CƠM BÌNH DÂN NGON'].length * long.fontSize * 0.66).toBeLessThanOrEqual(long.board.width);
  });

  it('follows the drawing wherever it stands and however big it is', () => {
    const moved = signLayout({ ...FRONT, x: FRONT.x + 320, y: FRONT.y - 64 }, 'TẠP HOÁ');
    const here = signLayout(FRONT, 'TẠP HOÁ');
    expect(moved.x - here.x).toBeCloseTo(320);
    expect(moved.y - here.y).toBeCloseTo(-64);
    expect(signLayout({ ...FRONT, width: 320, height: 256 }, 'TẠP HOÁ').fontSize).toBeGreaterThan(here.fontSize);
  });

  it('never letters smaller than the floor, even on a sliver of a front', () => {
    expect(signLayout({ x: 0, y: 0, width: 8, height: 8 }, 'BÁNH BAO').fontSize).toBe(SIGN_FONT_MIN);
  });
});

describe('boardLayout', () => {
  const POST = { x: 100, y: 50, width: 96, height: 96 };

  it('letters a two-line road sign small on top and big underneath, with the arrow below both', () => {
    const layout = boardLayout('signpost', POST, ['Khu phố', 'PHỐ VIỆT']);
    expect(layout.lines.map((line) => line.slot)).toEqual(['top', 'name']);
    const [top, name] = layout.lines;
    expect(top.y).toBeLessThan(name.y);
    expect(name.board.height).toBeGreaterThan(top.board.height);
    expect(layout.arrow).not.toBeNull();
    expect(layout.arrow!.y).toBeGreaterThanOrEqual(name.board.y + name.board.height);
  });

  it('keeps every line and the arrow inside the blue board', () => {
    const board = {
      x: POST.x + POST.width * SIGNPOST.board.left,
      y: POST.y + POST.height * SIGNPOST.board.top,
      right: POST.x + POST.width * SIGNPOST.board.right,
      bottom: POST.y + POST.height * SIGNPOST.board.bottom,
    };
    const layout = boardLayout('signpost', POST, ['Nông trại', 'AMBERFALL', '300 m']);
    for (const box of [...layout.lines.map((line) => line.board), layout.arrow!]) {
      expect(box.x).toBeGreaterThanOrEqual(board.x);
      expect(box.y).toBeGreaterThanOrEqual(board.y);
      expect(box.x + box.width).toBeLessThanOrEqual(board.right + 1e-9);
      expect(box.y + box.height).toBeLessThanOrEqual(board.bottom + 1e-9);
    }
  });

  it('puts a one-line road sign in the capitals slot, and gives a shop front no arrow', () => {
    expect(boardLayout('signpost', POST, ['PHỐ VIỆT']).lines.map((line) => line.slot)).toEqual(['name']);
    const shop = boardLayout('shopfront', { x: 0, y: 0, width: 160, height: 128 }, ['CHÈ']);
    expect(shop.arrow).toBeNull();
    expect(shop.lines[0]).toMatchObject(signLayout({ x: 0, y: 0, width: 160, height: 128 }, 'CHÈ'));
  });

  it('puts a cột mốc’s first line on the cap and its second on the stone', () => {
    const layout = boardLayout('milestone', { x: 0, y: 0, width: 32, height: 48 }, ['PV', '0 km']);
    expect(layout.lines.map((line) => line.slot)).toEqual(['cap', 'stone']);
    expect(layout.arrow).toBeNull();
  });
});
