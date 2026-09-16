import { describe, expect, it } from 'vitest';
import { DIALOGUE, dialogueLayout, paginate, typedText } from './dialogueLayout';
import { hudLayout } from './hudLayout';

function inside(outer: { width: number; height: number }, box: { x: number; y: number; width: number; height: number }) {
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= outer.width && box.y + box.height <= outer.height;
}

describe('where the dialogue box goes', () => {
  it.each([
    [1366, 768],
    [1920, 1080],
    [800, 600],
    [360, 640],
  ])('fits on a %ix%i canvas, above the hotbar', (width, height) => {
    const hud = hudLayout(width, height);
    const layout = dialogueLayout(hud);

    expect(inside(hud, layout.text)).toBe(true);
    expect(inside(hud, layout.side)).toBe(true);
    expect(layout.text.y + layout.text.height).toBeLessThanOrEqual(hud.hotbar.y - hud.hotbar.cell / 2);
  });

  it('keeps the words left of the face, and the face inside its own board', () => {
    const layout = dialogueLayout(hudLayout(1366, 768));

    expect(layout.text.x + layout.text.width).toBeLessThan(layout.side.x);
    expect(layout.portrait.x).toBeGreaterThanOrEqual(layout.side.x);
    expect(layout.portrait.x + layout.portrait.size).toBeLessThanOrEqual(layout.side.x + layout.side.width);
    expect(layout.name.y).toBeGreaterThanOrEqual(layout.portrait.y + layout.portrait.size);
  });

  it('draws the face at whole-pixel scale: 2x when there is room, 1x when there is not', () => {
    expect(dialogueLayout(hudLayout(1366, 768)).portrait).toMatchObject({ scale: 2, size: DIALOGUE.portrait * 2 });
    expect(dialogueLayout(hudLayout(360, 640)).portrait).toMatchObject({ scale: 1, size: DIALOGUE.portrait });
  });
});

describe('paging a long line', () => {
  it('groups wrapped lines into pages', () => {
    expect(paginate(['a', 'b', 'c', 'd', 'e'], 2)).toEqual(['a\nb', 'c\nd', 'e']);
  });

  it('always has a page, even for nothing', () => {
    expect(paginate([], 3)).toEqual(['']);
  });
});

describe('typing a page out', () => {
  it('shows nothing at first and everything in the end', () => {
    expect(typedText('Chào cháu.', 0)).toBe('');
    expect(typedText('Chào cháu.', 10_000)).toBe('Chào cháu.');
  });

  it('counts a letter with its tone mark as one character', () => {
    // "ệ" written as e + two combining marks is three code points; a slice by
    // code point would draw the bare e and leave its marks for later frames.
    const decomposed = 'ện';
    expect(typedText(decomposed, 1000 / DIALOGUE.typeRate)).toBe('ệ');
  });
});
