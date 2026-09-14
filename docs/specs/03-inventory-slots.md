# 03 — Inventory slots

## Goal

Replace the fixed-field satchel with a grid of slots holding stacks of items.

## Why it blocks the others

```ts
// src/game/systems/satchel.ts, today
interface Satchel {
  seeds: Record<CropId, number>;
  crops: Record<CropId, number>;
  water: number;
  wood: number;
}
```

Every item the game will ever have is a named field. Twelve crops (spec 04)
means twelve more fields and twelve more HUD rows. Tools as upgradeable objects
(spec 06) do not fit at all. Gifts (spec 07) have nowhere to live. A shop cannot
show a stock list.

It is also the difference between a status readout and an inventory: capacity is
what makes a trip home a decision, and there is no capacity in a record of
counts.

Do this before 04, 06 and 07, or each of them invents a different way around it.

## Design decisions

**Items are data, not types.** One registry, keyed by id, describing everything
the game can hold. Crops, seeds, tools and materials are all items; what differs
is their fields.

```ts
// src/game/systems/items.ts
export type ItemId = string;

export interface ItemDef {
  id: ItemId;
  label: string;
  /** Sprite key. */
  texture: string;
  /** How many fit in one slot. Tools are 1. */
  stackSize: number;
  /** What acting with it does, if anything. */
  tool?: Tool;
  /** What planting it grows, if anything. */
  plants?: CropId;
  sellPrice: number;
}
```

Adding a crop becomes adding two rows to a table — seed and produce — rather
than editing a type, four call sites and the HUD.

**Slots are a fixed-length array with holes.** Not a list that compacts: a
player who puts turnips in slot 3 expects them in slot 3 after picking
something up. `null` means empty.

```ts
export interface ItemStack {
  item: ItemId;
  count: number;
}

export type Inventory = Array<ItemStack | null>;
```

Start at **24 slots**, twelve of them the hotbar. Capacity is upgradeable later
(spec 06); do not hard-code the number in more than one place.

**The first twelve slots are the hotbar.** Not a separate array — a window onto
the same one, so moving something into the hotbar is moving it between slots and
needs no special case.

**Tools become items.** `PlayerState.tool` disappears; the equipped tool is
whichever hotbar slot is selected, and a slot holding a hoe acts as a hoe. This
is what makes upgrades possible in spec 06 and removes the current oddity where
tools are an enum but seeds are a count.

**Water stays off the grid.** It is a property of the watering can, not a stack
of items — `ItemStack` gains an optional `charges` for that, which tool
durability can reuse later.

**Overflow is refused, not dropped.** Harvesting into a full inventory fails
with a message and leaves the crop in the ground. Dropping it on the floor needs
world items, pickup and despawn rules; losing it silently is worse than either.

## State changes

```ts
interface PlayerState {
  // ...
  inventory: Inventory;      // replaces satchel
  selectedSlot: number;      // replaces tool and seed
}
```

`Satchel`, `spendSeed`, `spendWater`, `addCrop`, `countCrops` and `refillWater`
all move to inventory operations. `src/game/systems/satchel.ts` becomes
`src/game/systems/inventory.ts` — it is the third name for this file, and this
time it describes what it is.

`SAVE_VERSION` goes to 3 (or 2 if spec 01 is not built first). The migration is
real work rather than a default: turn the old named counts into stacks, in a
stable slot order, and put the starting tools in the hotbar.

## Reducer changes

- `applyFarmAction` takes the acting stack instead of `(satchel, action, crop)`,
  and derives the action from the item's `tool` field.
- `player/selectTool` becomes `player/selectSlot` with an index.
- `player/cycleSeed` disappears — selecting a seed is selecting its slot.
- New intents: `player/moveStack` (from slot, to slot) for rearranging, and
  `player/splitStack` if half-stack pickup is wanted. Both must validate the
  indices: a client sending slot `-1` or `999` must change nothing.

## Protocol

```ts
export type ClientCommand =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'selectSlot'; slot: number }       // was selectTool
  | { type: 'moveStack'; from: number; to: number }
  | { type: 'act' }
  // | { type: 'cycleSeed' }  — removed
```

`parseClientCommand` must bounds-check every slot index against the inventory
size, not merely that it is a number. This is the most likely place for a
malformed client to reach past an array.

## Client

**Hotbar** across the bottom of the canvas: twelve slots, item sprite, stack
count, the selected one highlighted. Number keys 1–9 select; `Q`/`E` or the
scroll wheel cycle.

**Inventory screen** on `Tab` or `I`: the full grid, drag to rearrange, hover
for a tooltip with name and sell price. This is React, drawn over the canvas,
because it is a document-shaped UI and the DOM is better at those than Phaser
is — but it must pause keyboard input reaching the game while open.

**Retire the satchel panel** in `App.tsx`. It exists because there was no
in-game inventory; once there is one, two views of the same thing is the problem
spec 05 is about.

## Tests

- A stack fills to `stackSize` then spills into the next free slot.
- Picking up with no free slot and no partial stack is refused, and the world is
  unchanged.
- `moveStack` merges same-item stacks, swaps different ones, and ignores
  out-of-range indices without throwing.
- Acting with an empty selected slot does nothing.
- Acting with a non-tool item does nothing.
- Migration: a version-1 save with 8 turnip seeds and 3 turnips produces the
  right stacks in stable slots, and the result round-trips.

## Out of scope

Chests and shared storage, crafting, item quality tiers, dropping items into the
world.
