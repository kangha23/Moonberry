import { describe, expect, it } from 'vitest';
import {
  EDGE_EAST,
  EDGE_MASKS,
  EDGE_NORTH,
  EDGE_SOUTH,
  EDGE_WEST,
  edgeMask,
  pairKindAt,
  type TileKind,
} from './tiled';

/**
 * A tiny map from a picture of one.
 *
 * `g` grass, `p` path, `w` water, `.` nothing. Written as strings because an
 * autotiling bug is a shape, and a shape is worth being able to see in the
 * test that finds it.
 */
function mapOf(rows: string[]): (x: number, y: number) => TileKind | null {
  const legend: Record<string, TileKind | null> = {
    g: 'grass',
    p: 'path',
    w: 'water',
    o: 'plot',
    '.': null,
  };
  return (x, y) => {
    const row = rows[y];
    if (row === undefined || x < 0 || x >= row.length) return null;
    return legend[row[x]] ?? null;
  };
}

describe('edgeMask', () => {
  it('finds no edge in the middle of one kind of ground', () => {
    const kindAt = mapOf(['ggg', 'ggg', 'ggg']);
    expect(edgeMask(kindAt, 1, 1)).toBe(0);
  });

  it('names each side on its own', () => {
    expect(edgeMask(mapOf(['gpg', 'ggg', 'ggg']), 1, 1)).toBe(EDGE_NORTH);
    expect(edgeMask(mapOf(['ggg', 'ggp', 'ggg']), 1, 1)).toBe(EDGE_EAST);
    expect(edgeMask(mapOf(['ggg', 'ggg', 'gpg']), 1, 1)).toBe(EDGE_SOUTH);
    expect(edgeMask(mapOf(['ggg', 'pgg', 'ggg']), 1, 1)).toBe(EDGE_WEST);
  });

  /**
   * All sixteen, spelled out.
   *
   * The table is the specification: a wrong bit is a fringe drawn down the
   * wrong side of a path, which looks like a rendering glitch rather than
   * like a mistake in an integer.
   */
  it('is right for all sixteen combinations', () => {
    const cases: Array<[number, string[]]> = [
      [0, ['ggg', 'ggg', 'ggg']],
      [EDGE_NORTH, ['gpg', 'ggg', 'ggg']],
      [EDGE_EAST, ['ggg', 'ggp', 'ggg']],
      [EDGE_NORTH | EDGE_EAST, ['gpg', 'ggp', 'ggg']],
      [EDGE_SOUTH, ['ggg', 'ggg', 'gpg']],
      [EDGE_NORTH | EDGE_SOUTH, ['gpg', 'ggg', 'gpg']],
      [EDGE_EAST | EDGE_SOUTH, ['ggg', 'ggp', 'gpg']],
      [EDGE_NORTH | EDGE_EAST | EDGE_SOUTH, ['gpg', 'ggp', 'gpg']],
      [EDGE_WEST, ['ggg', 'pgg', 'ggg']],
      [EDGE_NORTH | EDGE_WEST, ['gpg', 'pgg', 'ggg']],
      [EDGE_EAST | EDGE_WEST, ['ggg', 'pgp', 'ggg']],
      [EDGE_NORTH | EDGE_EAST | EDGE_WEST, ['gpg', 'pgp', 'ggg']],
      [EDGE_SOUTH | EDGE_WEST, ['ggg', 'pgg', 'gpg']],
      [EDGE_NORTH | EDGE_SOUTH | EDGE_WEST, ['gpg', 'pgg', 'gpg']],
      [EDGE_EAST | EDGE_SOUTH | EDGE_WEST, ['ggg', 'pgp', 'gpg']],
      [EDGE_NORTH | EDGE_EAST | EDGE_SOUTH | EDGE_WEST, ['gpg', 'pgp', 'gpg']],
    ];

    expect(cases).toHaveLength(16);
    expect(new Set(cases.map(([mask]) => mask)).size).toBe(16);
    for (const [expected, rows] of cases) {
      expect(edgeMask(mapOf(rows), 1, 1)).toBe(expected);
    }
  });

  it('sets no bit where the neighbour is off the map', () => {
    // The whole map is one grass tile: four null neighbours, and no fringe.
    expect(edgeMask(mapOf(['g']), 0, 0)).toBe(0);
    // A corner of a grass field with a path to the east and south only.
    expect(edgeMask(mapOf(['gp', 'pg']), 0, 0)).toBe(EDGE_EAST | EDGE_SOUTH);
    // A hole punched in the middle counts as no edge, the same as the border.
    expect(edgeMask(mapOf(['g.g', 'ggg', 'ggg']), 1, 1)).toBe(0);
  });

  it('is 0 on a cell with no tile at all', () => {
    expect(edgeMask(mapOf(['ppp', 'p.p', 'ppp']), 1, 1)).toBe(0);
  });

  it('is never outside 0-15', () => {
    const kindAt = mapOf(['gpw', 'pwg', 'wgp']);
    for (let y = -1; y <= 3; y += 1) {
      for (let x = -1; x <= 3; x += 1) {
        const mask = edgeMask(kindAt, x, y);
        expect(mask).toBeGreaterThanOrEqual(0);
        expect(mask).toBeLessThanOrEqual(15);
        expect(Number.isInteger(mask)).toBe(true);
      }
    }
  });

  it('lists fifteen masks worth drawing', () => {
    expect([...EDGE_MASKS]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
});

describe('pairKindAt', () => {
  /**
   * The case the pair projection exists for: one tile touching two different
   * boundaries at once, which a single mask cannot describe.
   */
  it('splits a corner that touches both grass and water', () => {
    const kindAt = mapOf(['gpg', 'wpg', 'gpg']);
    // The path tile in the middle: grass east, water west, path north and south.
    expect(edgeMask(kindAt, 1, 1)).toBe(EDGE_EAST | EDGE_WEST);
    expect(edgeMask(pairKindAt(kindAt, 'path', 'grass'), 1, 1)).toBe(EDGE_EAST);
    expect(edgeMask(pairKindAt(kindAt, 'path', 'water'), 1, 1)).toBe(EDGE_WEST);
  });

  it('keeps holes in the map as holes', () => {
    const kindAt = pairKindAt(mapOf(['g.g', 'ggg', 'ggg']), 'grass', 'water');
    expect(kindAt(1, 0)).toBeNull();
    expect(kindAt(0, 0)).toBe('grass');
  });

  it('flattens every other kind into the one being asked about', () => {
    const kindAt = pairKindAt(mapOf(['gpw', 'ooo', 'www']), 'grass', 'water');
    expect(kindAt(0, 0)).toBe('grass');
    expect(kindAt(1, 0)).toBe('grass');
    expect(kindAt(0, 1)).toBe('grass');
    expect(kindAt(2, 0)).toBe('water');
  });
});
