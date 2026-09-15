import type { AreaId } from '../world/areas';

/**
 * The spots in the village a schedule can send somebody, named once.
 *
 * Schedules read far better as `WELL` than as `{ x: 12, y: 10 }`, and naming
 * them means moving the well in Tiled is one edit here rather than a hunt
 * through six villagers. Every one of these is a walkable tile, and
 * `definitions.test.ts` checks that it still is.
 */
export interface Place {
  area: AreaId;
  x: number;
  y: number;
}

const village = (x: number, y: number): Place => ({ area: 'village', x, y });

/** The well in the middle of the village, and the two sides people stand on. */
export const WELL = village(12, 10);
export const WELL_SIDE = village(11, 9);
export const WELL_SOUTH = village(13, 11);

/** The market stall: the lane in front, the end of the counter, and behind it. */
export const MARKET_FRONT = village(13, 6);
export const MARKET_SIDE = village(15, 6);
export const MARKET_BACK = village(13, 4);

/** The forge yard, south of the anvil so the counter itself stays reachable. */
export const FORGE = village(14, 16);
export const FORGE_LANE = village(17, 13);

/** The lane tree, the green, and the shore of the pond. */
export const LANE_TREE = village(21, 11);
export const GREEN = village(6, 17);
export const POND = village(21, 18);

/**
 * The stock pen, and the spot the rancher works from.
 *
 * At the opposite end of the village from the market on purpose: buying a cow
 * and selling a crop should be two errands rather than two ends of one aisle.
 * The pen is not solid — it is a rail fence and a trough — so the counter can
 * be walked up to from any side.
 */
export const RANCH = village(11, 22);

/** The doorstep of each cottage, which is where "home" means. */
export const ROWAN_DOOR = village(3, 11);
export const TOBIAS_DOOR = village(4, 4);
export const JUNIPER_DOOR = village(24, 4);
export const MAEVE_DOOR = village(24, 16);
export const BRAM_DOOR = village(6, 22);
