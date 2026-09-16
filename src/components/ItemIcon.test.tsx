import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The satchel icon, which has two possible sources.
 *
 * Every item used to be rectangles replayed from `itemIcons`. As real art
 * arrives one item at a time, each one has to switch over on its own without
 * anybody editing this component — so the test is that the manifest decides,
 * not a list in here.
 */
vi.mock('../game/assets/lpc.generated', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game/assets/lpc.generated')>()),
  LPC_URL_BY_KEY: { 'item-turnip': '/assets/lpc/item-turnip.png' },
}));

const { default: ItemIcon } = await import('./ItemIcon');

describe('ItemIcon', () => {
  it('draws the PNG when the manifest has one', () => {
    const { container } = render(<ItemIcon item="turnip" size={32} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/assets/lpc/item-turnip.png');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('falls back to the generated rectangles when it does not', () => {
    const { container } = render(<ItemIcon item="wood" size={32} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('honours the requested size either way', () => {
    const png = render(<ItemIcon item="turnip" size={48} />).container.querySelector('img');
    expect(png?.getAttribute('width')).toBe('48');
    const svg = render(<ItemIcon item="wood" size={48} />).container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('48');
  });
});
