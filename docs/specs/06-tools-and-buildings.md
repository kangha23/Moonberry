# 06 — Tools and buildings

**Depends on:** [03 — Inventory slots](03-inventory-slots.md), and is much better
after [01 — Energy and sleeping](01-energy-and-sleep.md)

## Goal

Make each day end more capable than it began.

## Why

The game has no ratchet. Day 40 plays exactly like day 1: same tools, same
reach, same field, same everything. Money accumulates and buys nothing, which is
the clearest sign that the economy currently has no sink.

Stardew's pull is that progress is always visible and always just out of reach —
the next tool upgrade, the next building, the next unlocked area. Spec 01 gives
the player a budget; this spec gives them a reason to want a bigger one.

## Part A — Tool upgrades

**Tools are items after spec 03**, so an upgrade is a different item, not a
number on the player.

```ts
export interface ToolDef extends ItemDef {
  tool: Tool;
  tier: 'basic' | 'copper' | 'steel' | 'gold';
  /** Tiles affected, as a rectangle centred on the target. */
  areaOfEffect: { width: number; height: number };
  /** Multiplier on the action's energy cost. */
  energyFactor: number;
}
```

Two axes, and both matter:

| Tier | Area | Energy |
| --- | --- | --- |
| Basic | 1×1 | ×1.0 |
| Copper | 1×3 | ×0.9 |
| Steel | 3×3 | ×0.8 |
| Gold | 3×5 | ×0.7 |

Area is the dramatic one — tilling nine tiles in a swing changes how a morning
feels — and energy is what quietly extends the day.

**Upgrading takes days, and takes the tool.** Hand it to the blacksmith with the
money, and it is gone for two days. This is the mechanic that makes an upgrade a
decision rather than a purchase: you give up watering at scale precisely when
you were about to need it.

In multiplayer this needs care: a tool in for repair belongs to one player, so
store pending upgrades against the player, not the farm.

```ts
interface PlayerState {
  // ...
  pendingUpgrade: { item: ItemId; readyOnDay: number } | null;
}
```

**Where.** A blacksmith prop in the village with `interact: 'blacksmith'`. The
village map already exists and adding a prop is a Tiled edit, not a code change.

## Part B — Buildings

Bigger, and worth splitting into its own piece of work if Part A takes longer
than expected.

**Buildings occupy the farm map, so they cannot be Tiled props.** Everything in
`maps/*.json` is static and identical for every world; a building is per-world
state. It therefore has to live in `FarmState` and render on top of the map.

```ts
interface Building {
  id: string;
  kind: 'coop' | 'barn' | 'shed' | 'silo';
  /** Top-left tile on the farm map. */
  x: number;
  y: number;
  /** Null until construction finishes. */
  readyOnDay: number | null;
}

interface FarmState {
  // ...
  buildings: Building[];
}
```

This has a consequence worth stating plainly: **collision is no longer purely a
map property.** `isWalkable` currently reads the tile and the map's props. It
will need the world's buildings too, which means it needs `FarmState` — and it
is called from the reducer, so pass the buildings in rather than reaching for a
module-level store. Keep it pure.

**Placement is validated on the server.** A client proposes a position; the
server checks the footprint is on the farm, is free of water, props, other
buildings and crops, and that the wallet covers it. A client-side check is a
convenience, never the rule.

**Construction takes days**, like upgrades, and shows a scaffold sprite meanwhile.

**Animals are a separate spec.** A coop without chickens is a shed, but chickens
need feeding, happiness, produce, aging and pathfinding — more than everything
in this document combined. Build the buildings first; treat animals as the piece
of work that follows.

## What buildings are for

A building nobody needs is a money sink with no gameplay. In order of usefulness
to this game as it stands:

1. **Silo** — hay for later animals. Only worth it alongside animals.
2. **Shed** — storage, which needs chests, which the game also lacks. Useful the
   moment spec 03's capacity limit starts to bite.
3. **Coop / Barn** — animals. The largest draw and the largest amount of work.

If only one is built, build the **shed**, because it answers a problem the
player will already have.

## Reducer changes

- New intents: `player/upgradeTool { item }`, `player/collectTool`,
  `player/placeBuilding { kind, x, y }`.
- `startNewDay` completes any upgrade or construction whose `readyOnDay` has
  arrived, and emits events for both so the summary can mention them.
- `isWalkable` gains the buildings parameter, and every caller is updated —
  including the server's movement path.

`SAVE_VERSION` increments. `buildings` defaults to `[]` and `pendingUpgrade` to
`null` on migration.

## Client

- Blacksmith panel: what can be upgraded, the cost, the days.
- Build mode: a translucent footprint that follows the cursor, red where
  placement is refused, confirmed with a click.
- Building sprites, and scaffolds for those under construction.
- Buildings sort into the existing depth-by-row scheme, so a player walks behind
  a barn and in front of it correctly.

## Tests

- An upgrade removes the tool, charges the wallet, and returns the better tool
  on the right day and not before.
- A pending upgrade survives a save and a server restart.
- An area-of-effect tool tills every tile in its rectangle, skipping ones that
  are not tillable, and charges energy once per tile actually worked.
- Placement is refused on water, on a prop, on an existing building, on a
  planted crop and off the map — each its own case.
- Placement is refused when the wallet is short.
- A client sending a placement while standing on another map is refused.
- `isWalkable` reports a finished building as solid and a scaffold as solid.

## Out of scope

Animals, farmhouse interiors and upgrades, decorating, moving a building once
placed, mining and the tools that need it.
