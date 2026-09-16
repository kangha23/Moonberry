import { HUD, type Box, type HudLayout } from './hudLayout';

/**
 * The dialogue box's measurements.
 *
 * The same arrangement Stardew settled on, because it works: the words on the
 * left, where the eye starts, and the face on the right looking back at them.
 * The portrait kit draws its faces turned to the left, which is the one piece
 * of luck in this file.
 */
export const DIALOGUE = {
  maxWidth: 820,
  minWidth: 280,
  /** Below this the face is drawn at 1x rather than 2x, and the box is shorter. */
  wideFrom: 560,
  /** The portrait's own pixels, before it is magnified. */
  portrait: 64,
  /** Frame round everything, and the gap between the two boards. */
  pad: 14,
  gap: 8,
  nameHeight: 30,
  /** Characters a second the line is typed out at. */
  typeRate: 45,
} as const;

export interface DialogueLayout {
  /** The board the words are on. */
  text: Box;
  /** The board the face and the name are on. */
  side: Box;
  /** The portrait, top-left corner, and how many times it is magnified. */
  portrait: { x: number; y: number; scale: number; size: number };
  /** The plate the name is written on. */
  name: Box;
}

/**
 * Where the box goes on a canvas this size.
 *
 * Above the hotbar rather than over it. The hotbar is what a player reads to
 * know what is in their hand, and a gift is given from it — covering it at the
 * moment somebody reacts to what you handed them would hide the one thing the
 * reaction is about.
 */
export function dialogueLayout(hud: HudLayout): DialogueLayout {
  const m = HUD.margin;
  const width = Math.max(DIALOGUE.minWidth, Math.min(DIALOGUE.maxWidth, hud.width - m * 2));
  const wide = width >= DIALOGUE.wideFrom;
  const scale = wide ? 2 : 1;
  const size = DIALOGUE.portrait * scale;
  const height = DIALOGUE.pad * 2 + size + DIALOGUE.gap + DIALOGUE.nameHeight;

  const floor = hud.hotbar.y - hud.hotbar.cell / 2 - 12;
  const x = Math.round((hud.width - width) / 2);
  const y = Math.max(m, Math.round(floor - height));

  const sideWidth = size + DIALOGUE.pad * 2;
  const side: Box = { x: x + width - sideWidth, y, width: sideWidth, height };
  const text: Box = { x, y, width: width - sideWidth - DIALOGUE.gap, height };

  return {
    text,
    side,
    portrait: { x: side.x + DIALOGUE.pad, y: y + DIALOGUE.pad, scale, size },
    name: {
      x: side.x + 6,
      y: y + DIALOGUE.pad + size + DIALOGUE.gap,
      width: sideWidth - 12,
      height: DIALOGUE.nameHeight,
    },
  };
}

/**
 * Wrapped lines, grouped into the pages the box shows one at a time.
 *
 * A line that does not fit is paged rather than shrunk. Shrinking is what a
 * web page does; a dialogue box that changes its type size depending on who is
 * talking reads as two different games.
 */
export function paginate(lines: readonly string[], perPage: number): string[] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += size) pages.push(lines.slice(i, i + size).join('\n'));
  return pages.length ? pages : [''];
}

const graphemes = new Intl.Segmenter('vi', { granularity: 'grapheme' });

/**
 * How much of a page has been typed after this long.
 *
 * Counted in characters as a reader sees them — graphemes, not code points —
 * so a letter carrying a tone mark is never drawn with the mark missing for a
 * frame, however the text happens to have been normalised.
 */
export function typedText(page: string, elapsedMs: number, rate: number = DIALOGUE.typeRate): string {
  const chars = Array.from(graphemes.segment(page), (part) => part.segment);
  const shown = Math.max(0, Math.floor((elapsedMs / 1000) * rate));
  return shown >= chars.length ? page : chars.slice(0, shown).join('');
}
