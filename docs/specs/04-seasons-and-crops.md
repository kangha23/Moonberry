# 04 — Seasons and crops

**Depends on:** [03 — Inventory slots](03-inventory-slots.md)

## Goal

Give the calendar consequences, and give the player something to plan.

## Where it stands

```ts
// src/game/systems/farming.ts — the entire crop catalogue
turnip:     { growDays: 2, sellPrice: 18, seedPrice: 6 },
strawberry: { growDays: 3, sellPrice: 32, seedPrice: 14 },
```

`grep season src/game/systems/farming.ts` returns nothing. Seasons exist in
`time.ts`, are computed correctly, are shown in the HUD, and change absolutely
nothing. Spring and Winter play identically.

Two crops also means there is no choice to make: strawberry earns more per day
than turnip in every case, so the optimal play is "always strawberry" and the
seed selector is decoration.

## Design decisions

**Crops belong to seasons, and die at the boundary.** This is the whole point:
it puts a deadline on every planting and forces a judgement — is there time for
another cycle before the season turns? Without the death, seasons are a label.

**Warn before it happens.** On the last three days of a season, crops that will
not survive show a wilting tint and the day-end summary names them. Stardew does
not warn, and losing a field to a rule you had not internalised is the kind of
harsh that reads as unfair rather than demanding.

**Some crops regrow.** A crop with `regrowDays` produces repeatedly instead of
being consumed by harvest — the reason to commit a plot for a whole season
rather than replanting the fastest thing each time. It is what makes the
planting decision interesting rather than arithmetic.

**Balance around the energy budget, not around gold per day.** Once spec 01
lands, watering is the constraint. A crop that needs daily watering for eight
days costs more than one that needs three, and the prices should reflect it.
Tune after 01, not before, or the numbers will be wrong twice.

**Prices are flat.** Stardew has quality tiers and a fluctuating market; both
are large systems and neither is needed to make seasons matter.

## Data changes

```ts
export interface CropDefinition {
  id: CropId;
  label: string;
  seasons: Season[];        // new — when it may be planted and may live
  growDays: number;
  /** Days to produce again after a harvest; null means one and done. */
  regrowDays: number | null;  // new
  sellPrice: number;
  seedPrice: number;
}
```

Target catalogue: **three to four crops per season**, differing along axes that
make them genuinely different choices rather than strictly better ones —

- fast and cheap versus slow and valuable,
- one-shot versus regrowing,
- one crop per season that is a poor earner but feeds into something later
  (cooking, gifts, animal feed), so it has a reason to exist beyond price.

Winter grows nothing. That is deliberate in Stardew: it is the season for
mining, fishing and the town, and it gives the year a shape. We have none of
those yet, so **either** give Winter two hardy crops as a stopgap, **or** accept
that Winter is currently empty and treat it as the argument for spec 07.

## Reducer changes

`src/game/systems/farming.ts`:

- `plantCrop` refuses a crop whose `seasons` exclude the current one. The season
  must therefore be passed in — the function currently takes only the plot and
  the crop.
- `harvestPlot` on a regrowing crop returns the plot to `mature - regrowDays`
  rather than to `tilled`, keeping the crop in the ground.
- New `killOutOfSeasonCrops(plots, season)`, called from `startNewDay` only when
  the season changed, clearing the plot to `tilled`.

`src/game/state/reducer.ts`:

- `startNewDay` compares the outgoing and incoming season and runs the cull.
- New event `{ kind: 'cropsWithered'; count: number; season: Season }` so the
  summary can report it and the renderer can play something mournful.

## Buying seeds

There is no way to acquire seeds — everyone starts with eight turnip and two
strawberry, and that is the supply forever. A dozen crops with nothing to buy
them with is a catalogue, not an economy.

The market prop already exists with `interact: 'market'` and already handles
selling, so it is the natural home. A minimal shop:

- Acting at the market opens a panel listing seeds for the current season.
- Buying deducts from the shared wallet and pushes stacks into the buyer's
  inventory, refusing when the wallet is short or the inventory full.
- New commands `shop/buy { item, count }` and `shop/close`. The server validates
  that the player is actually within range of a market prop — do not trust that
  the client only sends it when the panel is open.

Seed stock is per season, from the same crop table, so a new crop appears in the
shop automatically.

## Client

- Crop sprites per crop and per stage. The existing four textures
  (`crop-seeded`, `crop-sprout`, `crop-turnip`, `crop-strawberry`) do not
  stretch to a dozen. Either commission or generate per-crop art, or accept a
  tinted shared sprite as a placeholder and say so in the credits.
- Wilting tint in the last three days of a season.
- The shop panel, in React, over the canvas.

## Tests

- Planting out of season is refused and spends no seed.
- A season boundary kills exactly the crops that do not list the new season, and
  leaves the rest untouched.
- A regrowing crop harvested yields produce and stays in the ground with its
  regrow timer set.
- A crop that regrows still dies at the season boundary.
- Buying deducts from the shared wallet, and is refused when short.
- Buying is refused when out of range of the market, regardless of what the
  client sent.
- Every crop in the catalogue lists at least one season, and no crop lists a
  season that does not exist. A table-driven test over `CROP_DEFINITIONS` keeps
  a typo from shipping a crop that can never be planted.

## Out of scope

Greenhouse, crop quality, fertiliser, giant crops, seed makers.
