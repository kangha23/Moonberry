import { cropsForSeason } from './farming';
import { addItem, countItem, type Inventory } from './inventory';
import { ITEMS, itemDef, type ItemId } from './items';
import { seasonLabel, type Season } from './time';

/**
 * The market stall's other half.
 *
 * Selling already worked; there was no way to buy, so a dozen crops would have
 * been a catalogue rather than an economy — everyone starts with eight turnip
 * seeds and two strawberry, and that was the supply forever.
 *
 * Stock is derived from the crop table and the season, never listed here, so a
 * crop added in `farming.ts` appears on the stall the next time its season
 * comes round without anybody remembering to add it.
 */
export interface ShopEntry {
  item: ItemId;
  label: string;
  price: number;
  blurb: string;
  /**
   * Which half of the stall this is.
   *
   * The counter sells two different sorts of thing now, and the panel has to
   * draw them differently: a seed row wants growing days and a season, and the
   * golden scythe wants neither. One field rather than two lists, because the
   * purchase rules are identical and splitting them would mean writing the
   * wallet check twice.
   */
  kind: 'seed' | 'tool';
}

/**
 * The two things on the stall that are not seeds.
 *
 * The scythe is here rather than at the blacksmith because it is not forged: a
 * scythe tier buys no energy saving (cutting grass costs none), so the anvil
 * has nothing to sell. What the golden one buys is a field in four passes
 * instead of forty, priced at a good autumn — see the note in `items.ts`.
 *
 * The rod is here for a different reason, and it is the only item in the game
 * that is sold *and* forged. Fishing has to be taken up before it can be got
 * better at: handing a rod over on the first morning would make it a seventh
 * icon in a bar nobody has read yet, and 500g is about a fortnight, which is
 * roughly when an evening with nothing left to do first turns up. From there
 * it goes up the ordinary ladder at the ordinary anvil.
 */
const TOOL_STOCK: readonly ItemId[] = ['gold-scythe', 'fishing-rod'];

/** What the stall is selling today. Empty for a season that grows nothing. */
export function shopStock(season: Season): ShopEntry[] {
  const seeds: ShopEntry[] = cropsForSeason(season).map((crop) => {
    const def = itemDef(crop.seed);
    return {
      item: def.id,
      label: def.label,
      // Every stocked seed has a buy price; a row without one is a table bug,
      // and pricing it at zero would hand out free seeds rather than say so.
      price: def.buyPrice ?? Number.POSITIVE_INFINITY,
      blurb: def.blurb,
      kind: 'seed',
    };
  });

  // Tools last, and stocked all year: a scythe is not a season's crop, and
  // somebody who has saved up for one should not have to wait for spring.
  const tools: ShopEntry[] = TOOL_STOCK.map((id) => {
    const def = itemDef(id);
    return {
      item: def.id,
      label: def.label,
      price: def.buyPrice ?? Number.POSITIVE_INFINITY,
      blurb: def.blurb,
      kind: 'tool',
    };
  });

  return [...seeds, ...tools];
}

/** Whether the stall would sell this item at all, this season. */
export function stocks(season: Season, item: ItemId): boolean {
  return shopStock(season).some((entry) => entry.item === item);
}

export interface BuyResult {
  inventory: Inventory;
  /** What to take off the farm's shared wallet. Zero for a refused purchase. */
  spent: number;
  changed: boolean;
  message: string;
}

/** The most of one thing a single purchase may be for. */
export const MAX_BUY = 99;

/**
 * Buys something over the counter, or explains why not.
 *
 * All or nothing in both directions: a wallet that is short buys none rather
 * than as many as it can afford, and a satchel with room for four of the five
 * asked for takes none. Partial purchases are the kind of thing a player
 * notices only after the coins are gone.
 *
 * Nothing here checks where the player is standing. That is the reducer's job,
 * because it is the thing a client must not be trusted about.
 */
export function buyFromStall(
  inventory: Inventory,
  coins: number,
  season: Season,
  item: ItemId,
  count: number,
): BuyResult {
  const refuse = (message: string): BuyResult => ({ inventory, spent: 0, changed: false, message });

  if (!Number.isInteger(count) || count < 1 || count > MAX_BUY) {
    return refuse('Bà chủ sạp đếm lại một lượt rồi lắc đầu.');
  }

  const entry = shopStock(season).find((stocked) => stocked.item === item);
  if (!entry) {
    return refuse(`Mùa ${seasonLabel(season)} sạp không bán thứ đó.`);
  }

  // A tool is a tool: one to a farmhand, and never a stack of them. Refused
  // here rather than left to `addItem`, which would happily fill a second slot
  // with a 4000g scythe nobody meant to buy twice.
  if (ITEMS[item].stackSize === 1) {
    if (count > 1) return refuse(`Bạn chỉ cần một cái ${entry.label.toLowerCase()} thôi.`);
    if (countItem(inventory, item) > 0) {
      return refuse(`Bạn đã có một cái ${entry.label.toLowerCase()} rồi.`);
    }
  }

  const spent = entry.price * count;
  if (spent > coins) {
    return refuse(`${count} ${entry.label} giá ${spent}g, mà nông trại chỉ có ${coins}g.`);
  }

  const next = addItem(inventory, item, count);
  if (!next) {
    return refuse(`Túi của bạn không còn chỗ cho ${count} ${entry.label}.`);
  }

  return {
    inventory: next,
    spent,
    changed: true,
    message: `Đã mua ${count} ${entry.label} với giá ${spent}g.`,
  };
}
