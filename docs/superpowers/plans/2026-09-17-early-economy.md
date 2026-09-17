# Early Economy (spec 17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put both sprinklers behind the mine (bars + depth unlock), and take the two winter crops (`frostcap`, `winterberry`) out of the game with a save migration that refunds them as gold.

**Architecture:** The sprinkler change is two rows in the `RECIPES` table in `crafting.ts`; the `{ by: 'depth' }` unlock already exists from spec 16 and is learned in the morning, on `arrive`, and on `player/join`. The winter removal is data deletion across the crop table, the item table, icons, NPC gift tables and dialogue, plus a `migrateWinterCrops` step (save v11 → v12) in `persistence.ts` that runs on raw JSON before `parseFarm` and uses a hard-coded refund table.

**Tech Stack:** TypeScript, Vitest, React (panels), Phaser (not touched), Node scripts for the art manifest.

**Spec:** `docs/specs/17-early-economy.md` (Vietnamese). Read it before starting any task.

## Global Constraints

- All player-facing text is Vietnamese. Code comments are English, in the existing long-form explanatory style (explain *why*, not *what*).
- Reducer and systems stay pure: no `Date.now()`, no unseeded randomness, no I/O.
- Changing the save format means: bump `SAVE_VERSION`, add a branch in `migrate()`, test that an old-version save still loads. A save that cannot be migrated is refused, never guessed.
- `SAVE_VERSION` becomes exactly `12`. `FarmState`'s shape does not change.
- Sprinkler: `needs: { 'copper-bar': 1, stone: 6, sap: 3 }`, `unlock: { by: 'depth', depth: 5 }`.
- Quality sprinkler: `needs: { 'iron-bar': 1, 'copper-bar': 1, sap: 5 }`, `unlock: { by: 'depth', depth: 15 }`.
- Refund table (gold per item): `frostcap-seeds` 20, `winterberry-seeds` 80, `frostcap` 52, `winterberry` 38, `juice-frostcap` 156, `pickle-frostcap` 114, `wine-winterberry` 114, `jam-winterberry` 84.
- No refund for crops in the ground. A machine job involving a winter item refunds the **input's** price.
- No new intents, events, UI or load-time notice.
- Do not edit anything in `public/assets/lpc/` by running `palette:apply`; delete the specific PNGs by hand (see Task 3).
- Run tests with `npx vitest run <file>`; the full gate is `npm run quality:fast` (lint + all tests + build).
- Work on branch `spec-17-early-economy` (already created; the spec is committed there). Commit after each task. End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Sprinklers behind the mine

**Files:**
- Modify: `src/game/systems/crafting.ts` (the `// --- the field ---` block, currently lines ~655–679)
- Test: `src/game/systems/crafting.test.ts` (inside `describe('unlocks', …)`)
- Test: `src/game/systems/mine.test.ts` (next to `'teaches a joining player the depth recipes the farm already earned (F4)'`)

**Interfaces:**
- Consumes: `RecipeUnlock` `{ by: 'depth'; depth: number }`, `newlyUnlocked(known, context)`, `craft(inventory, known, id, count?)`, `recipeFor(id)` — all existing.
- Produces: nothing new; only table rows change.

- [ ] **Step 1: Write the failing tests in `crafting.test.ts`**

Add inside `describe('unlocks', () => { … })`, after the `'makes a copper sword out of three bars and five planks'` test:

```ts
  it('puts both sprinklers behind the mine, spec 17', () => {
    expect(recipeFor('sprinkler')!.needs).toEqual({ 'copper-bar': 1, stone: 6, sap: 3 });
    expect(recipeFor('sprinkler')!.unlock).toEqual({ by: 'depth', depth: 5 });
    expect(recipeFor('quality-sprinkler')!.needs).toEqual({ 'iron-bar': 1, 'copper-bar': 1, sap: 5 });
    expect(recipeFor('quality-sprinkler')!.unlock).toEqual({ by: 'depth', depth: 15 });
  });

  it('teaches no sprinkler on day four to a farm that has never been down, however friendly', () => {
    const learned = newlyUnlocked([...STARTING_RECIPES], {
      day: 4,
      heartsFor: () => 10,
      deepestFloor: 0,
    }).map((entry) => entry.recipe);
    expect(learned).not.toContain('sprinkler');
    expect(learned).not.toContain('quality-sprinkler');
  });

  it('opens the sprinkler at floor five and the quality one at fifteen, not a floor before', () => {
    const at = (deepestFloor: number) =>
      newlyUnlocked([...STARTING_RECIPES], { day: 1, heartsFor: () => 0, deepestFloor }).map(
        (entry) => entry.recipe,
      );
    expect(at(4)).not.toContain('sprinkler');
    expect(at(5)).toContain('sprinkler');
    expect(at(14)).not.toContain('quality-sprinkler');
    expect(at(15)).toContain('quality-sprinkler');
  });

  it('makes a quality sprinkler out of bars and sap, without eating an ordinary one', () => {
    const made = craft(bag({ 'iron-bar': 1, 'copper-bar': 1, sap: 5 }), ['quality-sprinkler'], 'quality-sprinkler');
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(countItem(made.inventory, 'quality-sprinkler')).toBe(1);
    expect(countItem(made.inventory, 'iron-bar')).toBe(0);
    expect(countItem(made.inventory, 'copper-bar')).toBe(0);

    // The old stone-fibre-sap sprinkler is no longer a sprinkler.
    const noBar = craft(bag({ stone: 6, fiber: 8, sap: 3 }), ['sprinkler'], 'sprinkler');
    expect(noBar.ok).toBe(false);
  });
```

- [ ] **Step 2: Write the failing test in `mine.test.ts`**

Add directly after the `'teaches a joining player the depth recipes the farm already earned (F4)'` test (same `describe`):

```ts
  it('teaches the whole farm the sprinkler the moment anybody reaches floor five (spec 17)', () => {
    let state = { ...farmWith('p1', 'p2'), deepestFloor: 4 };
    state = onLadder(state, 'p1', 4);
    expect(state.players.p2.knownRecipes).not.toContain('sprinkler');

    const result = applyIntent(state, { type: 'player/descend', playerId: 'p1' });

    expect(result.state.deepestFloor).toBe(5);
    expect(result.state.players.p1.knownRecipes).toContain('sprinkler');
    expect(result.state.players.p2.knownRecipes).toContain('sprinkler');
    expect(result.state.players.p2.knownRecipes).not.toContain('quality-sprinkler');
  });

  it('teaches a joining player the sprinkler once the farm has been to floor five (spec 17)', () => {
    const state = { ...farmWith('p1'), deepestFloor: 5 };

    const result = applyIntent(state, { type: 'player/join', playerId: 'p2', name: 'p2' });

    expect(result.state.players.p2.knownRecipes).toContain('sprinkler');
    expect(result.state.players.p2.knownRecipes).not.toContain('quality-sprinkler');
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/game/systems/crafting.test.ts src/game/systems/mine.test.ts`
Expected: the new tests FAIL — `sprinkler` is still a `{ by: 'day', day: 4 }` unlock made of stone, fibre and sap, so the depth tests never see it and the old recipe still crafts. Existing tests pass.

- [ ] **Step 4: Replace the field block in `crafting.ts`**

Replace everything from the `// --- the field ---` comment through the closing `},` of the `quality-sprinkler` row with:

```ts
  // --- the field ------------------------------------------------------------
  //
  // Both sprinklers are behind the mine, and that is spec 17 rather than spec
  // 11. Spec 11 shipped the ordinary one as stone, fibre and sap on day four,
  // because copper was not dug yet and a copper-barred sprinkler would have
  // shipped uncraftable. Spec 16 dug it — and a sprinkler on day four had been
  // deleting the energy budget in the first week, since watering is what a day
  // is actually spent on. So each one now costs a bar from the band of the
  // mine that opens it: the four-tile one at floor five, where copper is, and
  // the eight-tile one at fifteen, once iron is coming up. The quality
  // sprinkler no longer eats an ordinary one: it already asks for two bands'
  // bars, and crafting the small one first would be a click, not a choice.
  {
    id: 'sprinkler',
    needs: { 'copper-bar': 1, stone: 6, sap: 3 },
    yields: 1,
    unlock: { by: 'depth', depth: 5 },
  },
  {
    id: 'quality-sprinkler',
    needs: { 'iron-bar': 1, 'copper-bar': 1, sap: 5 },
    yields: 1,
    unlock: { by: 'depth', depth: 15 },
  },
```

Also check the doc comment on `RecipeUnlock` (`hearts` paragraph) and the catalogue comment above `RECIPES`: if either still says the sprinkler arrives by day or that Maeve gives a sprinkler, reword that clause to match. (As of writing, the `RecipeUnlock` comment mentions Maeve's **keg** at four hearts and Juniper's jar, which remain true — leave those.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/game/systems/crafting.test.ts src/game/systems/mine.test.ts src/game/state/reducer.test.ts src/game/systems/placeables.test.ts`
Expected: all PASS. (The existing `'opens a dated recipe…'` and `HEARTED` tests read the first `day`/`hearts` row off the table, which is now `big-chest`/`jar`; they should still pass. If one fails, fix the test's assumption, not the table.)

- [ ] **Step 6: Commit**

```bash
git add src/game/systems/crafting.ts src/game/systems/crafting.test.ts src/game/systems/mine.test.ts
git commit -m "feat(crafting): both sprinklers cost a bar and open with the mine, not the calendar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Save v12 refunds winter's crops as gold

This task lands **before** the items are removed (Task 3), so the migration and its test exist while the ids are still legal; the test builds the v11 save as raw JSON, so it keeps passing after Task 3.

**Files:**
- Modify: `src/game/state/persistence.ts` (`SAVE_VERSION`, `migrate()`, new `WINTER_CROP_REFUNDS` + `migrateWinterCrops` placed after `migrateMine`)
- Modify: `src/game/systems/mine.test.ts:566` (`expect(SAVE_VERSION).toBe(11)` → `12`)
- Test: `src/game/state/persistence.test.ts` (new `describe` at the end of the file)

**Interfaces:**
- Consumes: private helpers already in `persistence.ts`: `isObject`, `isCount`, `upgradePlayers(farm, (player) => Unknown | null)`, type `Unknown = Record<string, unknown>`.
- Produces: `SAVE_VERSION === 12`. No exported function.

- [ ] **Step 1: Write the failing tests**

Append to `src/game/state/persistence.test.ts` (all imports used here — `applyIntent`, `createPlaceable`, `Chest`, `Machine`, `newStack`, `areaMap`, `plotKey`, `START_AREA`, `countItem`, `encodeSave`, `decodeSave` — are already imported at the top of the file):

```ts
describe('version 11 saves, from when winter still grew two crops', () => {
  /** Puts a stack in the first empty slot of a serialised satchel or chest. */
  function stash(slots: unknown[], stack: { item: string; count: number }) {
    const empty = slots.indexOf(null);
    if (empty < 0) throw new Error('no empty slot to stash into');
    slots[empty] = stack;
  }

  /**
   * A save as version 11 wrote it, with winter's two crops in every place one
   * could be: a satchel, the satchel of somebody else on the farm, a chest, a
   * keg, and the ground. Written into the JSON by hand, because once spec 17
   * is in, this build's types have no name for any of it.
   *
   * Worth, by the refund table: 2 jam (168) + 5 frostcap (260) + 3 winterberry
   * seeds (240) + 4 winterberry in the chest (152) + the winterberry in the keg
   * (38) = 858g.
   */
  function version11Envelope() {
    let farm = playedFarm();
    farm = applyIntent(farm, { type: 'player/join', playerId: 'b', name: 'B' }).state;

    const chest = createPlaceable('p1', 'chest', START_AREA, 20, 12) as Chest;
    chest.contents[0] = newStack('wood', 40);
    const winterKeg = createPlaceable('p2', 'keg', START_AREA, 21, 12) as Machine;
    const melonKeg = createPlaceable('p3', 'keg', START_AREA, 22, 12) as Machine;
    melonKeg.job = { input: 'melon', output: 'wine-melon', readyOnDay: farm.time.day + 7 };

    const cells = areaMap(START_AREA).plotTiles.slice(0, 3);
    const keys = cells.map((cell) => plotKey(START_AREA, cell.x, cell.y));
    farm = {
      ...farm,
      coins: 100,
      placeables: [chest, winterKeg, melonKeg],
      plots: {
        ...farm.plots,
        [keys[2]]: { ...cells[2], stage: 'sprout', crop: 'strawberry', daysWatered: 2, wateredToday: false },
      },
    };

    const envelope = JSON.parse(encodeSave(farm));
    envelope.version = 11;
    stash(envelope.farm.players.a.inventory, { item: 'jam-winterberry', count: 2 });
    stash(envelope.farm.players.b.inventory, { item: 'frostcap', count: 5 });
    stash(envelope.farm.players.b.inventory, { item: 'winterberry-seeds', count: 3 });
    envelope.farm.placeables[0].contents[3] = { item: 'winterberry', count: 4 };
    envelope.farm.placeables[1].job = { input: 'winterberry', output: 'wine-winterberry', readyOnDay: 9 };
    for (const i of [0, 1]) {
      envelope.farm.plots[keys[i]] = { ...cells[i], stage: 'sprout', crop: 'frostcap', daysWatered: 2, wateredToday: true };
    }
    return { envelope, keys };
  }

  const WINTER_IDS = [
    'frostcap-seeds',
    'winterberry-seeds',
    'frostcap',
    'winterberry',
    'juice-frostcap',
    'pickle-frostcap',
    'wine-winterberry',
    'jam-winterberry',
  ];

  it('loads, and pays for every winter item it held into the shared wallet', () => {
    const restored = decodeSave(JSON.stringify(version11Envelope().envelope));
    expect(restored).not.toBeNull();
    expect(restored!.coins).toBe(100 + 858);
  });

  it('leaves no winter item in any satchel or chest, and everything else where it was', () => {
    const restored = decodeSave(JSON.stringify(version11Envelope().envelope))!;
    const chest = restored.placeables.find((placeable) => placeable.id === 'p1') as Chest;
    for (const id of WINTER_IDS) {
      expect(countItem(restored.players.a.inventory, id)).toBe(0);
      expect(countItem(restored.players.b.inventory, id)).toBe(0);
      expect(countItem(chest.contents, id)).toBe(0);
    }
    expect(countItem(restored.players.a.inventory, 'turnip-seeds')).toBe(8);
    expect(chest.contents[0]).toEqual({ item: 'wood', count: 40 });
    expect(chest.contents[3]).toBeNull();
  });

  it('empties a machine that was working on a winter crop, and leaves any other job alone', () => {
    const restored = decodeSave(JSON.stringify(version11Envelope().envelope))!;
    const winterKeg = restored.placeables.find((placeable) => placeable.id === 'p2') as Machine;
    const melonKeg = restored.placeables.find((placeable) => placeable.id === 'p3') as Machine;
    expect(winterKeg.job).toBeNull();
    expect(melonKeg.job?.input).toBe('melon');
  });

  it('turns winter crops in the ground back into bare tilled soil, and leaves other crops growing', () => {
    const { envelope, keys } = version11Envelope();
    const restored = decodeSave(JSON.stringify(envelope))!;
    for (const key of keys.slice(0, 2)) {
      expect(restored.plots[key]).toMatchObject({ stage: 'tilled', crop: null, daysWatered: 0, wateredToday: false });
    }
    expect(restored.plots[keys[2]]).toMatchObject({ stage: 'sprout', crop: 'strawberry', daysWatered: 2 });
  });

  it('leaves the wallet alone for a version 11 save that never grew anything in winter', () => {
    const farm = { ...playedFarm(), coins: 321 };
    const envelope = JSON.parse(encodeSave(farm));
    envelope.version = 11;
    expect(decodeSave(JSON.stringify(envelope))?.coins).toBe(321);
  });

  it('round-trips an upgraded version 11 save through the current format', () => {
    const upgraded = decodeSave(JSON.stringify(version11Envelope().envelope));
    expect(upgraded).not.toBeNull();
    expect(decodeSave(encodeSave(upgraded!))).toEqual(upgraded);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/state/persistence.test.ts`
Expected: the new wallet/satchel/machine/plot tests FAIL (coins stay 100, winter items still present). The "never grew anything" and round-trip tests may already pass — that is fine.

- [ ] **Step 3: Implement the migration**

In `src/game/state/persistence.ts`:

1. Change `export const SAVE_VERSION = 11;` to `export const SAVE_VERSION = 12;`.
2. In `migrate()`, after `if (version <= 10) current = migrateMine(current);` add:

```ts
  if (version <= 11) current = migrateWinterCrops(current);
```

3. Directly after the `migrateMine` function, add:

```ts
/**
 * What spec 17 paid for each winter item when it took winter's two crops out.
 *
 * Written out rather than read from `ITEMS`, because by the time this runs the
 * item table no longer has these rows — which is the whole reason the
 * migration exists. Seeds at what they cost, everything else at what it sold
 * for, the machine goods at the price their factor gave them.
 */
const WINTER_CROP_REFUNDS: Readonly<Record<string, number>> = {
  'frostcap-seeds': 20,
  'winterberry-seeds': 80,
  frostcap: 52,
  winterberry: 38,
  'juice-frostcap': 156,
  'pickle-frostcap': 114,
  'wine-winterberry': 114,
  'jam-winterberry': 84,
};

const WINTER_CROPS: readonly string[] = ['frostcap', 'winterberry'];

function isWinterItem(value: unknown): value is string {
  return typeof value === 'string' && Object.hasOwn(WINTER_CROP_REFUNDS, value);
}

/**
 * Version 11 could still grow frostcap and winterberry, and spec 17 took them
 * out. Left alone, a save holding either would be refused outright (a satchel
 * with an unknown id fails `parseInventory`) or would quietly lose it (a chest
 * slot with an unknown id becomes an empty slot). Neither is acceptable, so
 * Tobias buys it all back: every winter item in a satchel, a chest or a
 * machine becomes gold in the shared wallet.
 *
 * A crop in the ground goes back to tilled soil and is not paid for. The seed
 * was spent the day it was planted; the plot is what the player gets back.
 */
function migrateWinterCrops(farm: unknown): unknown {
  let refund = 0;

  const clearSlots = (slots: unknown): unknown => {
    if (!Array.isArray(slots)) return slots;
    return slots.map((slot) => {
      if (!isObject(slot) || !isWinterItem(slot.item)) return slot;
      refund += WINTER_CROP_REFUNDS[slot.item] * (isCount(slot.count) ? slot.count : 0);
      return null;
    });
  };

  const withPlayers = upgradePlayers(farm, (player) => ({
    ...player,
    inventory: clearSlots(player.inventory),
  }));
  if (!isObject(withPlayers)) return null;

  const placeables = Array.isArray(withPlayers.placeables)
    ? withPlayers.placeables.map((placeable) => {
        if (!isObject(placeable)) return placeable;
        let next: Unknown = placeable;
        if (Array.isArray(placeable.contents)) {
          next = { ...next, contents: clearSlots(placeable.contents) };
        }
        const job = placeable.job;
        if (isObject(job) && (isWinterItem(job.input) || isWinterItem(job.output))) {
          if (isWinterItem(job.input)) refund += WINTER_CROP_REFUNDS[job.input];
          next = { ...next, job: null };
        }
        return next;
      })
    : withPlayers.placeables;

  const plots = isObject(withPlayers.plots)
    ? Object.fromEntries(
        Object.entries(withPlayers.plots).map(([key, plot]) => {
          if (!isObject(plot) || typeof plot.crop !== 'string' || !WINTER_CROPS.includes(plot.crop)) {
            return [key, plot];
          }
          return [key, { ...plot, stage: 'tilled', crop: null, daysWatered: 0, wateredToday: false }];
        }),
      )
    : withPlayers.plots;

  const coins = isCount(withPlayers.coins) ? withPlayers.coins + refund : withPlayers.coins;
  return { ...withPlayers, placeables, plots, coins };
}
```

Note the refund is accumulated while `upgradePlayers` and the placeable map run, and read only at the end — keep `coins` computed last.

4. In `src/game/systems/mine.test.ts`, change `expect(SAVE_VERSION).toBe(11);` to `expect(SAVE_VERSION).toBe(12);`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/state/persistence.test.ts src/game/systems/mine.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/state/persistence.ts src/game/state/persistence.test.ts src/game/systems/mine.test.ts
git commit -m "feat(save): version 12 buys back every winter crop a save still holds

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Winter grows nothing

**Files:**
- Modify: `src/game/systems/farming.ts:86-96` (the winter block in `CROPS`)
- Modify: `src/game/systems/items.ts` — `CropId` union (lines ~27–42), `CROP_ORDER` (~1111), `CROP_CLASS` (~1290), the four item rows `frostcap-seeds`/`frostcap`/`winterberry-seeds`/`winterberry` (~1669–1705), and any comment that counts crops (search for "Thirteen crops")
- Modify: `src/game/assets/itemIcons.ts:311-312`
- Modify: `src/game/npcs/villagers/ash.ts`, `bram.ts`, `juniper.ts`, `rowan.ts`, `tobias.ts` (gift rows and dialogue)
- Test: `src/game/systems/farming.test.ts` (~line 280, `'stocks every season the calendar can produce'`)
- Test: `src/game/systems/shop.test.ts` (new test)
- Test: `src/components/ShopPanel.test.tsx` (~line 83, `'restocks itself when the season turns'`)
- Delete: `crop-frostcap.png`, `crop-winterberry.png`, `item-frostcap-seeds.png`, `item-winterberry-seeds.png` in both `public/assets/lpc/` and `art/raw/lpc/`
- Modify: `art/sources.json`, `art/raw/lpc/CREDITS.md`, `public/assets/lpc/CREDITS.md`
- Regenerate: `src/game/assets/lpc.generated.ts` via `npm run lpc:manifest` (it types `LPC_CROPS` as `CropId[]` and currently lists both winter crops, so the type check cannot pass until it is regenerated — which is why the art is in this task)

**Interfaces:**
- Consumes: `cropsForSeason`, `shopStock`, `isItemId` (exported from `items.ts`), `ShopPanel` test helpers `show`, `atTheStall`.
- Produces: `CropId` without `'frostcap' | 'winterberry'`.

- [ ] **Step 1: Rewrite the tests that encode winter crops**

In `src/game/systems/farming.test.ts`, replace the `'stocks every season the calendar can produce'` test with:

```ts
  it('stocks every growing season, and leaves winter fallow on purpose', () => {
    for (const season of ['Spring', 'Summer', 'Autumn'] as const) {
      expect(cropsForSeason(season).length).toBeGreaterThanOrEqual(3);
    }
    // Spec 17: winter is the mine's, the river's and the phố's. See the note
    // in the catalogue.
    expect(cropsForSeason('Winter')).toEqual([]);
  });
```

In `src/game/systems/shop.test.ts`, inside `describe('what the stall stocks', …)`, add (import `isItemId` from `./items` if it is not already imported):

```ts
  it('sells only tools in winter, because nothing grows in it (spec 17)', () => {
    expect(shopStock('Winter').every((entry) => entry.kind === 'tool')).toBe(true);
    expect(isItemId('frostcap')).toBe(false);
    expect(isItemId('winterberry-seeds')).toBe(false);
  });
```

In `src/components/ShopPanel.test.tsx`, replace the body of `'restocks itself when the season turns'` with:

```ts
    show({ ...atTheStall(), season: 'Winter' });

    // Nothing grows in winter, so the stall says so and keeps only its tools.
    expect(screen.getByText(/gieo gì cũng không sống đến ngày thu hoạch/)).toBeDefined();
    expect(screen.queryByText('Hạt củ cải')).toBeNull();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/systems/farming.test.ts src/game/systems/shop.test.ts src/components/ShopPanel.test.tsx`
Expected: the three changed/added tests FAIL (winter still has two crops).

- [ ] **Step 3: Remove the crops from `farming.ts`**

Replace the whole winter block (from `// Winter, and a stopgap rather than a design.` through the `winterberry` row) with:

```ts
  // Winter grows nothing, and that is the design rather than a gap in it.
  // Spec 17 took out the two stopgap crops that kept an empty winter playable
  // before there was anywhere else to be: the mine, the river, the animals, the
  // winter forage and the phố are what the season is for now, and a fallow
  // month is what gives the farming year its rhythm.
```

Also update the catalogue doc comment above `CROPS` if it still says "three or four crops a season" without qualification — make it "three or four crops in each growing season".

- [ ] **Step 4: Remove the crops from `items.ts`**

- Delete `| 'frostcap'` and `| 'winterberry'` from `export type CropId`.
- Delete `'frostcap',` and `'winterberry',` from `CROP_ORDER`. Update that list's doc comment: removing entries is safe **only** because no migration older than v12 ever packed a winter crop into slots (the v2 satchel migration predates both); say so in one sentence.
- Delete `frostcap: 'vegetable',` and `winterberry: 'fruit',` from `CROP_CLASS`.
- Delete the four item rows `'frostcap-seeds'`, `frostcap`, `'winterberry-seeds'`, `winterberry`.
- Search `items.ts` for `Thirteen crops` (or any other count of crops) and correct the number to match `CROP_ORDER.length` (13 after removal: turnip, clover, strawberry, rhubarb, wheat, sunflower, tomato, melon, barley, cranberry, pumpkin, nep, dau-xanh).

- [ ] **Step 5: Remove icons, gifts and dialogue**

- `src/game/assets/itemIcons.ts`: delete the `frostcap:` and `winterberry:` rows.
- `ash.ts`, `bram.ts`, `tobias.ts`: delete the `frostcap: 'hated',` row.
- `rowan.ts`: delete `winterberry: 'loved',`.
- `juniper.ts`: delete `frostcap: 'loved',` and `winterberry: 'loved',`. Replace the two dialogue lines (keep `priority` and `when` unchanged):
  - `when: { season: 'Winter' }` → `line: '"Rễ đông với cải tuyết nằm ngay dưới lớp tuyết. Phải biết chỗ mà bới."'`
  - `when: { minHearts: 6 }` → `line: '"Có một bãi rễ đông tôi mới chỉ cho đúng một người. Ông ấy mất rồi, nên con số quay về một."'`
- `tobias.ts`: replace the `when: { season: 'Winter' }` line with `line: '"Mùa đông quầy chỉ còn nông cụ. Đất nghỉ thì bác lên mỏ hay ra sông, tôi ngồi đếm tiền mùa thu."'`

- [ ] **Step 6: Delete the winter crops' PNGs**

```bash
git rm public/assets/lpc/crop-frostcap.png public/assets/lpc/crop-winterberry.png public/assets/lpc/item-frostcap-seeds.png public/assets/lpc/item-winterberry-seeds.png
git rm art/raw/lpc/crop-frostcap.png art/raw/lpc/crop-winterberry.png art/raw/lpc/item-frostcap-seeds.png art/raw/lpc/item-winterberry-seeds.png
```

- [ ] **Step 7: Remove the four `art/sources.json` entries**

Each is one object in an array, shaped like `{ "target": "crop-frostcap", "pack": …, "file": …, "grid": 32, "cell": [..] }` (possibly with a `recolor` map). Delete the whole object and fix the surrounding commas so the file stays valid JSON. Verify: `node -e "JSON.parse(require('fs').readFileSync('art/sources.json','utf8'))"` prints nothing and exits 0.

- [ ] **Step 8: Edit both `CREDITS.md` files identically**

- In the `## [LPC] Crops` section: remove `` `crop-winterberry` `` from the "Applies to" list (fix the trailing comma/period so the list ends `` `crop-cranberry`. ``), and change the stand-ins paragraph to talk only about the cranberry: "One of these is a stand-in rather than a name match, and should be replaced if the right drawing turns up: `crop-cranberry` is the pack's raspberry bush. It is the right shape and the right colour temperature, which is most of what a crop sprite has to do."
- In the `## [LPC] Flowers / Plants / Fungi / Wood` section: remove `` `crop-frostcap.png` (column 5, row 22 — the pack's ice-blue mushroom), `` from the "Applies to" line.
- If either file's Emberfield (or other) section lists `item-frostcap-seeds` / `item-winterberry-seeds`, remove them there too (`grep -n "frostcap\|winterberry" art/raw/lpc/CREDITS.md public/assets/lpc/CREDITS.md` must print nothing afterwards).

- [ ] **Step 9: Regenerate the art manifest**

Run: `npm run lpc:manifest`
Expected: `src/game/assets/lpc.generated.ts` (which reads both the PNG folder and `CROP_ORDER` in `items.ts`) no longer contains `frostcap` or `winterberry`. Check with `git grep -n -i "frostcap\|winterberry" -- src/game/assets`.

- [ ] **Step 10: Type-check, run everything, and sweep**

Run: `npm run quality:fast`
Expected: PASS (lint, all Vitest tests, `test:scripts`, `tsc -b` and the Vite build). If any other test mentions `frostcap`/`winterberry`, update it to a crop that still exists, or delete the assertion if it only existed to cover winter crops.

Then run: `git grep -n -i "frostcap\|winterberry\|sương giá\|dâu đông" -- src server tests public art scripts`
Expected: matches **only** in `src/game/state/persistence.ts` and `src/game/state/persistence.test.ts`. Anything else: remove it (or, for a historical note in a script comment, reword it).

- [ ] **Step 11: Commit**

```bash
git add -A src art public
git commit -m "feat(farming): winter grows nothing, and its crops leave the stall, the gift tables, the dialogue and the art

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The spec index knows spec 17 is in

**Files:**
- Modify: `docs/specs/README.md`
- Modify: `docs/specs/17-early-economy.md` only if implementation deviated from it (record what actually shipped)

- [ ] **Step 1: Update `docs/specs/README.md`**

- First paragraph: "Mười sáu phần việc" → "Mười bảy phần việc".
- Add a row to the table after row 16:

```markdown
| 17 | [Cân lại kinh tế đầu game](17-early-economy.md) | 16, 11, 04 | Ống tưới ngày 4 xoá giới hạn sức lực ngay tuần đầu, và mùa Đông còn hai cây tạm. Ống tưới giờ cần thỏi và mở theo tầng mỏ; mùa Đông để đất nghỉ. |
```

- Add a section above `### Spec 16 để lại gì`:

```markdown
### Spec 17 để lại gì

- **Ống tưới là phần thưởng của mỏ.** Cả hai công thức mở bằng `{ by: 'depth' }`
  (tầng 5 và 15) và đòi thỏi. Spec 18 mở rộng ruộng bằng cách mua ô đất: đất
  tiêu vàng, ống tưới tiêu quặng, nên không phải cân lại bảng này.
- **Mùa Đông không có cây nào.** `cropsForSeason('Winter')` rỗng, và sạp chợ mùa
  Đông chỉ còn công cụ. Thêm một cây mùa Đông là một quyết định thiết kế, không
  phải một chỗ trống cần lấp.
- **Bản lưu v12.** `migrateWinterCrops` đổi mọi đồ mùa Đông ra vàng theo một bảng
  giá viết cứng. Mẫu này dùng lại được cho lần sau gỡ một vật phẩm khỏi bảng:
  bảng giá nằm trong migration, không đọc từ `ITEMS`.
- **Món Việt vẫn chưa cân.** Bánh chưng và chè đậu lời hơn thùng ủ; xem mục
  "Ngoài phạm vi" của spec 17.
```

- [ ] **Step 2: Reconcile the spec with what shipped**

Re-read `docs/specs/17-early-economy.md` against the diff (`git diff main --stat` and the code). If anything differs (e.g. an extra test had to change, a comment count differed), edit the spec so it describes what shipped.

- [ ] **Step 3: Full gate and commit**

Run: `npm run quality:fast`
Expected: PASS.

```bash
git add docs/specs
git commit -m "docs: spec 17 is in

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
