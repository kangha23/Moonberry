# Metal and the Mine (Spec 16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mine give up ore a player can dig, smelt that ore into bars in a furnace, and make the blacksmith and three new swords need those bars.

**Architecture:** Everything rides on systems that already exist. Ore veins are `ResourceNode`s of a new kind `ore`, woken and forgotten with a floor's first and last player by the same pass that already does it for monsters (`reconcileMonsters` → `reconcileFloors`). The furnace is a row in `MACHINE_DEFS`, after `burns` generalises to a `converts` table plus an optional `fuel`. Bars are a field on the tool tier table that `upgradeFor` and `applyUpgradeTool` read. Swords are item rows plus recipes with a new `{ by: 'depth' }` unlock, and the rusty one is handed over in `arrive`.

**Tech Stack:** TypeScript, React 19, Phaser 4, Vitest. No new dependencies.

**Spec:** [`docs/specs/16-metal-and-the-mine.md`](../../specs/16-metal-and-the-mine.md)

## Global Constraints

- **No `FarmState` shape change and no `SAVE_VERSION` bump.** `SAVE_VERSION` stays `11`; `mine.test.ts` asserts it.
- **The reducer stays pure and deterministic.** No `Math.random`, no `Date`. Ore yield is `yieldOf(node, day, seed)`, the seed being whatever `applyNodeAct` already passes (`state.spawnSeed`).
- **All-or-nothing trades.** A refused furnace load, craft or upgrade leaves the satchel, the wallet and the machine exactly as they were.
- **Palette lock.** Every colour written in code is `PALETTE['…']`. `scripts/palette-lock.test.mjs` fails the build otherwise.
- **Player-facing text is Vietnamese; identifiers and comments are English**, in the voice of the surrounding file.
- **Numbers, verbatim from the spec:** furnace = 25 stone + 10 copper ore, eats 5 ore + 1 coal, 1 day. Bars sell for copper 90g, iron 150g, gold 300g. Upgrades: copper 3 copper bars + 250g, steel 3 iron bars + 1000g, gold 3 gold bars + 2500g. Swords: rusty 10, copper 20 (3 copper bars + 5 wood, depth 10), steel 35 (3 iron bars + 5 hardwood, depth 20), gold 60 (3 gold bars + 5 hardwood, depth 30). Ore node: pickaxe, health 3, energy 3, not solid. Iron ore requires copper, gold ore requires steel, everything else basic. Yield 1–3, gem exactly 1.
- **Baseline before starting:** `npx vitest run` → 44 files, 1020 tests, all passing.
- **Verify each task with** `npx vitest run <files>` plus `npx tsc -b` (the type check `npm run build` runs). The last task runs `npm run quality:fast`.

---

### Task 1: Bars and swords exist as items

**Files:**
- Modify: `src/game/systems/items.ts` (the `MATERIALS` table near line 452, `WEAPON_ROWS` near line 1412)
- Modify: `src/game/assets/itemIcons.ts` (after `ITEM_ICONS['rusty-sword']`, near line 778)
- Test: `src/game/systems/placeables.test.ts` (the icon `describe` that ends with `draws the one metal spec 13 will dig`, near line 349)
- Test: `src/game/systems/mine.test.ts` (`describe('farm seeds and records')`, near line 236)

**Interfaces:**
- Consumes: nothing.
- Produces: item ids `copper-bar` (90g), `iron-bar` (150g), `gold-bar` (300g), `copper-sword` (damage 20), `steel-sword` (35), `gold-sword` (60). All swords have `tool: 'sword'`, `stackSize: 1`, `sellPrice: 0`. No bar has `produce`.

- [ ] **Step 1: Write the failing tests**

In `src/game/systems/placeables.test.ts`, replace the test `draws the one metal spec 13 will dig` with:

```ts
  it('draws every bar and every sword', () => {
    for (const id of ['copper-bar', 'iron-bar', 'gold-bar', 'rusty-sword', 'copper-sword', 'steel-sword', 'gold-sword']) {
      expect(iconFor(id).length, `${id} has no icon`).toBeGreaterThan(0);
    }
  });
```

In `src/game/systems/mine.test.ts`, inside `describe('farm seeds and records')`, after `has a sword that is a sword`, add:

```ts
  it('has a sword for every band, each harder-hitting than the last', () => {
    const swords = ['rusty-sword', 'copper-sword', 'steel-sword', 'gold-sword'];
    const damage = swords.map((id) => ITEMS[id]?.damage ?? 0);
    expect(damage).toEqual([10, 20, 35, 60]);
    for (const id of swords) {
      expect(ITEMS[id].tool).toBe('sword');
      expect(ITEMS[id].sellPrice).toBe(0);
      expect(ITEMS[id].stackSize).toBe(1);
    }
  });

  it('prices the bars above what went into them, and never sweeps them into a sale', () => {
    expect(['copper-bar', 'iron-bar', 'gold-bar'].map((id) => ITEMS[id]?.sellPrice)).toEqual([90, 150, 300]);
    for (const id of ['copper-bar', 'iron-bar', 'gold-bar']) expect(ITEMS[id].produce).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/systems/placeables.test.ts src/game/systems/mine.test.ts`
Expected: FAIL. `iron-bar has no icon`, and `damage` is `[10, 0, 0, 0]`.

- [ ] **Step 3: Add the rows**

In `src/game/systems/items.ts`, replace the `copper-bar` entry at the end of `MATERIALS` with:

```ts
  // Spec 16: what the furnace makes and the anvil wants. Priced a little above
  // five ore and a lump of coal, so smelting to sell is worth a trip and never
  // a mint: 25g of copper ore and 50g of coal come out at 90g.
  {
    id: 'copper-bar',
    label: 'Đồng thỏi',
    price: 90,
    blurb: 'Năm cục quặng đồng và một hòn than, qua một đêm trong lò nấu.',
  },
  { id: 'iron-bar', label: 'Sắt thỏi', price: 150, blurb: 'Nấu từ quặng sắt. Thứ làm nên mọi đồ thép.' },
  { id: 'gold-bar', label: 'Vàng thỏi', price: 300, blurb: 'Nấu từ quặng vàng. Nặng tay hơn vẻ ngoài của nó.' },
```

Replace the doc comment and body of `WEAPON_ROWS` with:

```ts
/**
 * The swords, one for each band of the mine.
 *
 * Not rows in `TOOL_BASES`, because the blacksmith's ladder buys reach and
 * energy and a sword has neither: it hits a fan in front of you and costs
 * nothing to swing (spec 13, the same reason the scythe is free). Better
 * swords are a column of `damage`, not a tier, and they are crafted from bars
 * rather than forged (spec 16).
 */
const WEAPON_ROWS: Record<ItemId, ItemDef> = Object.fromEntries(
  (
    [
      ['rusty-sword', 'Kiếm gỉ', 10, 'Cùn, nhưng vẫn đủ để một con sên nghĩ lại.'],
      ['copper-sword', 'Kiếm đồng', 20, 'Hai nhát cho một con dơi. Thứ làm tầng mười đi được.'],
      ['steel-sword', 'Kiếm thép', 35, 'Đủ nặng để một con ma phải tan sau ba nhát.'],
      ['gold-sword', 'Kiếm vàng', 60, 'Thứ duy nhất đáy mỏ phải nể.'],
    ] as const
  ).map(([id, label, damage, blurb]) => [
    id,
    { id, label, texture: `item-${id}`, stackSize: 1, tool: 'sword', damage, sellPrice: 0, blurb },
  ]),
);
```

- [ ] **Step 4: Draw the icons**

In `src/game/assets/itemIcons.ts`, replace the `ITEM_ICONS['copper-bar'] ??= [...]` block with:

```ts
/** Spec 16's bars: one stubby ingot, in the metal's own colours. */
function barIcon(body: string, light: string, shade: string, shine: string): readonly IconRect[] {
  return [
    [body, 2, 6, 12, 5],
    [light, 3, 6, 10, 2],
    [shade, 2, 10, 12, 2],
    [shine, 4, 7, 3, 1],
  ];
}

ITEM_ICONS['copper-bar'] ??= barIcon(PALETTE['soil.6'], PALETTE['light.5'], PALETTE['soil.4'], PALETTE['light.7']);
ITEM_ICONS['iron-bar'] ??= barIcon(PALETTE['light.2'], PALETTE['light.6'], PALETTE['building.2'], PALETTE['light.7']);
ITEM_ICONS['gold-bar'] ??= barIcon(PALETTE['light.5'], PALETTE['light.7'], PALETTE['soil.5'], PALETTE['light.7']);
```

After the `ITEM_ICONS['rusty-sword'] ??= [...]` block, add:

```ts
/** The same blade, in the metal of the band it was made for. */
function swordIcon(metal: MetalPalette): readonly IconRect[] {
  return [
    [metal.mid, 9, 2, 3, 3],
    [metal.mid, 7, 4, 3, 3],
    [metal.mid, 5, 6, 3, 3],
    [metal.light, 10, 2, 1, 1],
    [metal.dark, 3, 9, 5, 2],
    [PALETTE['soil.0'], 2, 11, 3, 3],
  ];
}

ITEM_ICONS['copper-sword'] ??= swordIcon(TOOL_METALS.copper);
ITEM_ICONS['steel-sword'] ??= swordIcon(TOOL_METALS.steel);
ITEM_ICONS['gold-sword'] ??= swordIcon(TOOL_METALS.gold);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/game/systems/placeables.test.ts src/game/systems/mine.test.ts src/game/assets/itemIcons.test.ts && npx tsc -b`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/game/systems/items.ts src/game/assets/itemIcons.ts src/game/systems/placeables.test.ts src/game/systems/mine.test.ts
git commit -m "feat(items): iron and gold bars, and a sword for every band of the mine"
```

---

### Task 2: The furnace

**Files:**
- Modify: `src/game/systems/items.ts` (`MachineKind` near line 1127, `PLACEABLE_ROWS`, `MACHINE_LABELS` near line 1334, `artisanProduct` near line 1323)
- Modify: `src/game/systems/placeables.ts` (`DEFS`, `MachineDef` near line 280, `MACHINE_DEFS`, `outputFor`, `MachineLoad`, `loadMachine`)
- Modify: `src/game/state/rules/placeables.ts` (`applyMachineLoad`, near line 331)
- Modify: `src/game/systems/crafting.ts` (the machines group of `RECIPES`)
- Modify: `src/game/assets/itemIcons.ts` (`PLACEABLE_ICONS`)
- Test: `src/game/systems/placeables.test.ts`, `src/game/state/reducer.test.ts` (`describe('machines')`)

**Interfaces:**
- Consumes: `copper-bar`, `iron-bar`, `gold-bar` from Task 1.
- Produces:
  - `MachineKind` gains `'furnace'`.
  - `MachineDef.converts?: Partial<Record<ItemId, ItemId>>` and `MachineDef.fuel?: { item: ItemId; count: number }`. `burns` is removed.
  - `MachineLoad` success gains `fuel: { item: ItemId; count: number } | null`.
  - Recipe `furnace`, unlocked from the start.

- [ ] **Step 1: Write the failing unit tests**

In `src/game/systems/placeables.test.ts`, after the test `eats ten planks a batch in the kiln, which is the one that eats more than one`, add:

```ts
  it('smelts five ore of a kind into its bar overnight, and asks for a coal to do it', () => {
    for (const [ore, bar] of [
      ['copper-ore', 'copper-bar'],
      ['iron-ore', 'iron-bar'],
      ['gold-ore', 'gold-bar'],
    ] as const) {
      const load = loadMachine(machine('furnace'), ore, 4);
      expect(load.ok, ore).toBe(true);
      if (!load.ok) return;
      expect(load.takes).toBe(5);
      expect(load.fuel).toEqual({ item: 'coal', count: 1 });
      expect(load.job).toEqual({ input: ore, output: bar, readyOnDay: 5 });
    }
  });

  it('turns down anything that is not a smeltable ore, and burns no fuel in the kiln', () => {
    expect(loadMachine(machine('furnace'), 'wood', 1).ok).toBe(false);
    expect(loadMachine(machine('furnace'), 'stone', 1).ok).toBe(false);
    expect(loadMachine(machine('furnace'), 'gem', 1).ok).toBe(false);
    const kiln = loadMachine(machine('kiln'), 'wood', 1);
    expect(kiln.ok && kiln.fuel).toBeNull();
  });
```

- [ ] **Step 2: Write the failing reducer tests**

In `src/game/state/reducer.test.ts`, inside `describe('machines')`, after `eats ten planks a batch in the kiln, and refuses on nine`, add:

```ts
  it('eats five ore and one coal in the furnace, and gives a bar the next morning', () => {
    let farm = withMachine('furnace');
    farm = give(hold(farm, 'a', 'copper-ore', 5), 'a', 'coal', 1);

    const loaded = applyIntent(farm, { type: 'machine/load', playerId: 'a', machineId: 'p1' }).state;
    expect((thing(loaded, 'p1') as Machine).job?.output).toBe('copper-bar');
    expect(countItem(loaded.players.a.inventory, 'copper-ore')).toBe(0);
    expect(countItem(loaded.players.a.inventory, 'coal')).toBe(0);

    const morning = standBeside(sleepThrough(loaded).state, 'a', spot.x, spot.y);
    const collected = applyIntent(morning, { type: 'machine/collect', playerId: 'a', machineId: 'p1' });
    expect(countItem(collected.state.players.a.inventory, 'copper-bar')).toBe(1);
  });

  it('refuses the furnace without coal, and keeps every ore', () => {
    let farm = withMachine('furnace');
    farm = hold(farm, 'a', 'copper-ore', 5);

    const result = applyIntent(farm, { type: 'machine/load', playerId: 'a', machineId: 'p1' });
    expect((thing(result.state, 'p1') as Machine).job).toBeNull();
    expect(countItem(result.state.players.a.inventory, 'copper-ore')).toBe(5);
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: 'Lò nấu cần thêm 1 than làm nhiên liệu.',
    });
  });

  it('knows how to build a furnace from the first morning', () => {
    const farm = give(give(craftingFarm(), 'a', 'stone', 25), 'a', 'copper-ore', 10);
    const made = applyIntent(farm, { type: 'player/craft', playerId: 'a', recipe: 'furnace', count: 1 });
    expect(countItem(made.state.players.a.inventory, 'furnace')).toBe(1);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/game/systems/placeables.test.ts src/game/state/reducer.test.ts -t "furnace|smelts|smeltable"`
Expected: FAIL. TypeScript rejects `'furnace'` as a `Machine['kind']`, or the loads come back `ok: false`.

- [ ] **Step 4: Add the furnace to the item table**

In `src/game/systems/items.ts`:

```ts
/** The five machines. A kind here is a row in `MACHINE_DEFS` over there. */
export type MachineKind = 'keg' | 'jar' | 'churn' | 'kiln' | 'furnace';
```

In `PLACEABLE_ROWS`, after the `kiln` row:

```ts
  {
    id: 'furnace',
    label: 'Lò nấu',
    blurb: 'Năm cục quặng và một hòn than, qua một đêm thành một thỏi.',
  },
```

In `MACHINE_LABELS`, add `furnace: 'Lò nấu',`.

In `artisanProduct`, replace the kiln early return with a rule that covers both material machines. Keep the churn line where it is:

```ts
function artisanProduct(input: ItemId, machine: MachineKind): ArtisanProduct | null {
  if (machine === 'churn') return isMilk(input) ? CHURN_PRODUCT : null;
  // The kiln and the furnace make materials that already exist — coal, bars —
  // so there is no artisan row for either of them to generate.
  if (machine !== 'keg' && machine !== 'jar') return null;
  const crop = CROP_ORDER.find((id) => (id as ItemId) === input);
  return crop ? (ARTISAN_PRODUCTS[machine][CROP_CLASS[crop]] ?? null) : null;
}
```

Do **not** add `furnace` to `ARTISAN_MACHINES`.

- [ ] **Step 5: Generalise `burns` and add the machine**

In `src/game/systems/placeables.ts`, in `DEFS`, after the `kiln` row:

```ts
  { kind: 'furnace', family: 'machine', solid: true, clearsGround: true },
```

In `MachineDef`, replace the `burns` field and its doc comment with:

```ts
  /**
   * A machine whose output is a plain material rather than an artisan good:
   * which input becomes which output. The kiln has one row, the furnace three
   * (spec 16). Everything else derives its output from its input through
   * `artisanOutputFor`.
   */
  converts?: Partial<Record<ItemId, ItemId>>;
  /** Consumed alongside `intake` of the input, or absent for a machine that needs none. */
  fuel?: { item: ItemId; count: number };
```

In `MACHINE_DEFS`, change the kiln's `burns: { input: 'wood', output: 'coal' },` to `converts: { wood: 'coal' },` and add after it:

```ts
  furnace: {
    kind: 'furnace',
    label: 'Lò nấu',
    days: 1,
    intake: 5,
    converts: { 'copper-ore': 'copper-bar', 'iron-ore': 'iron-bar', 'gold-ore': 'gold-bar' },
    fuel: { item: 'coal', count: 1 },
    refusal: 'Lò nấu cần 5 quặng cùng loại và 1 than.',
  },
```

Replace `outputFor`, `MachineLoad` and the success return of `loadMachine`:

```ts
/** What a machine would turn an input into, or null when it will not take it. */
export function outputFor(kind: MachineKind, input: ItemId): ItemId | null {
  const def = MACHINE_DEFS[kind];
  if (def.converts) return def.converts[input] ?? null;
  return artisanOutputFor(input, kind);
}

export type MachineLoad =
  | { ok: true; job: MachineJob; takes: number; fuel: { item: ItemId; count: number } | null }
  | { ok: false; reason: string };
```

```ts
  return {
    ok: true,
    takes: def.intake,
    fuel: def.fuel ?? null,
    job: { input, output, readyOnDay: day + def.days },
  };
```

- [ ] **Step 6: Take the fuel in the reducer**

In `src/game/state/rules/placeables.ts`, in `applyMachineLoad`, replace everything from `const inventory = removeItem(player.inventory, held.item, load.takes);` down to the start of the `return {` with:

```ts
  const label = machineDef(machine.kind).label;
  const fed = removeItem(player.inventory, held.item, load.takes);
  if (!fed) {
    return {
      state,
      events: [say(playerId, `${label} cần ${load.takes} ${itemDef(held.item).label.toLowerCase()} một mẻ.`)],
    };
  }
  // Fuel second, out of what is left, so a refusal on either leaves the
  // satchel exactly as it was: neither removal has been written anywhere yet.
  const inventory = load.fuel ? removeItem(fed, load.fuel.item, load.fuel.count) : fed;
  if (!inventory) {
    return {
      state,
      events: [
        say(
          playerId,
          `${label} cần thêm ${load.fuel!.count} ${itemDef(load.fuel!.item).label.toLowerCase()} làm nhiên liệu.`,
        ),
      ],
    };
  }
```

The `return` below it already writes `inventory` back and needs no change.

- [ ] **Step 7: The recipe and the icon**

In `src/game/systems/crafting.ts`, in the machines group, after the `kiln` row:

```ts
  // Spec 16. Known from the start because copper ore is its own gate: nobody
  // has ten of it without having been down the mine.
  { id: 'furnace', needs: { stone: 25, 'copper-ore': 10 }, yields: 1, unlock: { by: 'start' } },
```

In `src/game/assets/itemIcons.ts`, in `PLACEABLE_ICONS`, after `kiln`:

```ts
  furnace: [
    // A tall brick stack with a glowing mouth, taller and hotter than the kiln.
    [PALETTE['building.2'], 3, 2, 10, 12],
    [PALETTE['building.0'], 3, 2, 10, 2],
    [PALETTE['soil.2'], 2, 13, 12, 1],
    [PALETTE['shadow.3'], 5, 8, 6, 4],
    [PALETTE['light.5'], 6, 9, 4, 2],
    [PALETTE['light.7'], 7, 9, 2, 1],
  ],
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/game/systems/placeables.test.ts src/game/state/reducer.test.ts src/game/systems/crafting.test.ts src/game/assets && npx tsc -b`
Expected: PASS, including the kiln tests that already existed.

- [ ] **Step 9: Commit**

```bash
git add src/game/systems/items.ts src/game/systems/placeables.ts src/game/state/rules/placeables.ts src/game/systems/crafting.ts src/game/assets/itemIcons.ts src/game/systems/placeables.test.ts src/game/state/reducer.test.ts
git commit -m "feat(crafting): a furnace that smelts five ore and a coal into a bar"
```

---

### Task 3: The blacksmith takes bars

**Files:**
- Modify: `src/game/systems/items.ts` (`ItemDef` near line 94, `TierDef`/`TIERS` near line 240, `toolRows`, `upgradeFor` near line 1855)
- Modify: `src/game/state/rules/counters.ts` (`applyUpgradeTool`)
- Modify: `src/game/state/selectors.ts` (`UpgradeOffer`, `upgradeOffers`)
- Modify: `src/components/WorkshopPanel.tsx` (`ToolsTab`)
- Test: `src/game/state/reducer.test.ts` (`describe('the blacksmith')`, near line 1262), `src/game/state/selectors.test.ts`, `server/src/FarmRoom.test.ts` (near line 552)

**Interfaces:**
- Consumes: bar item ids from Task 1.
- Produces:
  - `ItemDef.upgradeBars?: { item: ItemId; count: number }`
  - `upgradeFor(id): { item: ItemId; cost: number; bars: { item: ItemId; count: number } | null } | null`
  - `UpgradeOffer.bars: { item: ItemId; label: string; needs: number; has: number } | null`

- [ ] **Step 1: Update the existing blacksmith tests so they bring bars**

In `src/game/state/reducer.test.ts`, above `describe('the blacksmith')`, add:

```ts
/** The three bars a copper upgrade asks for, in the player's satchel. */
function withCopperBars(state: FarmState, id: PlayerId, count = 3): FarmState {
  return give(state, id, 'copper-bar', count);
}
```

Then, in `describe('the blacksmith')`:
- `takes the tool and the money…`: after `state = standAtForge(state, 'a');` add `state = withCopperBars(state, 'a');`. After the `expect(ordered.state.coins)…` line add `expect(countItem(ordered.state.players.a.inventory, 'copper-bar')).toBe(0);`.
- `hands the better tool over on the right morning…`: after `state = standAtForge(state, 'a');` add `state = withCopperBars(state, 'a');`.
- `refuses a second job while the anvil is busy`: after `state = standAtForge(state, 'a');` add `state = withCopperBars(state, 'a', 6);`.
- `refuses work the farm cannot pay for, and keeps the tool`: after `state = standAtForge(state, 'a');` add `state = withCopperBars(state, 'a');`, and at the end add `expect(countItem(result.state.players.a.inventory, 'copper-bar')).toBe(3);`.

Add a new test at the end of the `describe`:

```ts
  it('refuses the work without the bars, and keeps the tool, the bars and the money', () => {
    let state = funded(join(createFarmState(), 'a'), 10_000);
    state = withCopperBars(standAtForge(state, 'a'), 'a', 1);

    const result = applyIntent(state, { type: 'player/upgradeTool', playerId: 'a', item: 'hoe' });

    expect(result.state.players.a.pendingUpgrade).toBeNull();
    expect(countItem(result.state.players.a.inventory, 'hoe')).toBe(1);
    expect(countItem(result.state.players.a.inventory, 'copper-bar')).toBe(1);
    expect(result.state.coins).toBe(10_000);
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: 'Cuốc đồng cần 3 đồng thỏi, bạn mới có 1.',
    });
  });

  it('asks for the bar of the rung being reached, and less gold than before', () => {
    expect(upgradeFor('hoe')).toEqual({ item: 'copper-hoe', cost: 250, bars: { item: 'copper-bar', count: 3 } });
    expect(upgradeFor('copper-hoe')).toEqual({ item: 'steel-hoe', cost: 1000, bars: { item: 'iron-bar', count: 3 } });
    expect(upgradeFor('steel-hoe')).toEqual({ item: 'gold-hoe', cost: 2500, bars: { item: 'gold-bar', count: 3 } });
    expect(upgradeFor('fishing-rod')?.bars).toEqual({ item: 'copper-bar', count: 3 });
  });
```

Add `upgradeFor` to the `../systems/items` import at the top of the file.

- [ ] **Step 2: Write the failing selector test**

In `src/game/state/selectors.test.ts`, add `upgradeOffers` to the `./selectors` import and `addItem` to the `../systems/inventory` import. Then add at the end of the file:

```ts
describe('upgrade offers', () => {
  it('says how many bars each offer needs and how many the satchel holds', () => {
    let farm = farmWith('a');
    const inventory = addItem(farm.players.a.inventory, 'copper-bar', 2)!;
    farm = { ...farm, players: { ...farm.players, a: { ...farm.players.a, inventory } } };

    const hoe = upgradeOffers(farm.players.a).find((offer) => offer.item === 'hoe');

    expect(hoe?.cost).toBe(250);
    expect(hoe?.bars).toEqual({ item: 'copper-bar', label: 'Đồng thỏi', needs: 3, has: 2 });
  });
});
```

- [ ] **Step 3: Update the server tests**

In `server/src/FarmRoom.test.ts`, change the import on line 4 to `import { addItem, countItem } from '../../src/game/systems/inventory';`. In `takes a tool in for work and charges the farm for it`, after `room.state.coins = 5000;` add:

```ts
    room.state.players.alice.inventory = addItem(room.state.players.alice.inventory, 'copper-bar', 3)!;
```

In `keeps a tool that is in for work across a restart`, after `seeded.state.coins = 5000;` add:

```ts
    seeded.state.players.alice.inventory = addItem(seeded.state.players.alice.inventory, 'copper-bar', 3)!;
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/game/state/reducer.test.ts src/game/state/selectors.test.ts server/src/FarmRoom.test.ts -t "blacksmith|upgrade|tool in for work"`
Expected: FAIL. `upgradeFor` has no `bars`, the refusal test gets a pending upgrade, and the selector has no `bars`.

- [ ] **Step 5: Put the bars on the tier table**

In `src/game/systems/items.ts`, in `ItemDef`, under `upgradeCost?: number;`:

```ts
  /** The bars the blacksmith also wants for that work (spec 16). */
  upgradeBars?: { item: ItemId; count: number };
```

In `TierDef`, under `cost: number;`:

```ts
  /**
   * The bars reaching this tier costs, on top of `cost` (spec 16). Three
   * rather than Stardew's five because tools are per player: six implements
   * a rung is eighteen bars each, and five would make a co-op of four grind.
   */
  bars: { item: ItemId; count: number } | null;
```

Replace `TIERS` with:

```ts
const TIERS: Record<ToolTier, TierDef> = {
  basic: { label: '', areaOfEffect: { width: 1, height: 1 }, energyFactor: 1, cost: 0, bars: null, charges: WATERING_CAN_CHARGES, barWidth: 0.2 },
  copper: { label: 'Đồng', areaOfEffect: { width: 1, height: 3 }, energyFactor: 0.9, cost: 250, bars: { item: 'copper-bar', count: 3 }, charges: 36, barWidth: 0.26 },
  steel: { label: 'Thép', areaOfEffect: { width: 3, height: 3 }, energyFactor: 0.8, cost: 1000, bars: { item: 'iron-bar', count: 3 }, charges: 72, barWidth: 0.32 },
  gold: { label: 'Vàng', areaOfEffect: { width: 3, height: 5 }, energyFactor: 0.7, cost: 2500, bars: { item: 'gold-bar', count: 3 }, charges: 120, barWidth: 0.4 },
};
```

In `toolRows`, in the `if (next && base.forged !== false)` block, after `def.upgradeCost = TIERS[next].cost;`:

```ts
        const bars = TIERS[next].bars;
        if (bars) def.upgradeBars = bars;
```

Replace `upgradeFor`:

```ts
export function upgradeFor(
  id: ItemId,
): { item: ItemId; cost: number; bars: { item: ItemId; count: number } | null } | null {
  const def = ITEMS[id];
  if (!def?.upgradesTo || def.upgradeCost === undefined) return null;
  return { item: def.upgradesTo, cost: def.upgradeCost, bars: def.upgradeBars ?? null };
}
```

- [ ] **Step 6: Take the bars at the anvil**

In `src/game/state/rules/counters.ts`, change the inventory import to `import { addItem, countItem, removeItem } from '../../systems/inventory';`. In `applyUpgradeTool`, between the `if (!inventory) {…}` block (the tool) and `if (upgrade.cost > state.coins) {`, insert:

```ts
  // Bars before gold, and out of what is left once the tool is off the
  // satchel: both are refusals, and neither removal is written until the end.
  const barred = upgrade.bars ? removeItem(inventory, upgrade.bars.item, upgrade.bars.count) : inventory;
  if (!barred) {
    const bars = upgrade.bars!;
    const have = countItem(player.inventory, bars.item);
    return {
      state,
      events: [
        say(
          playerId,
          `${itemDef(upgrade.item).label} cần ${bars.count} ${itemDef(bars.item).label.toLowerCase()}, bạn mới có ${have}.`,
        ),
      ],
    };
  }
```

Then change `const next: PlayerState = { ...player, inventory, pendingUpgrade: … }` to use `inventory: barred`.

- [ ] **Step 7: Show the bars in the selector and the panel**

In `src/game/state/selectors.ts`, add `countItem` to the inventory import if it is not there. Add to `UpgradeOffer`:

```ts
  /** What the anvil also wants, and how much of it this satchel holds. */
  bars: { item: ItemId; label: string; needs: number; has: number } | null;
```

In `upgradeOffers`, in the `found.push({…})`, add:

```ts
      bars: upgrade.bars
        ? {
            item: upgrade.bars.item,
            label: ITEMS[upgrade.bars.item].label,
            needs: upgrade.bars.count,
            has: countItem(player.inventory, upgrade.bars.item),
          }
        : null,
```

In `src/components/WorkshopPanel.tsx`, in `ToolsTab`'s `offers.map`, replace the `tooDear` line, the price `<span>` and the button's `disabled`:

```tsx
          const tooDear = offer.cost > coins;
          const shortOfBars = offer.bars !== null && offer.bars.has < offer.bars.needs;
```

```tsx
              <span className="shop-price">
                {offer.bars && (
                  <span className={shortOfBars ? 'shop-warning' : undefined}>
                    {offer.bars.needs} {offer.bars.label.toLowerCase()} ·{' '}
                  </span>
                )}
                {offer.cost}g
              </span>
```

```tsx
                  disabled={tooDear || shortOfBars}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/game/state/reducer.test.ts src/game/state/selectors.test.ts server/src/FarmRoom.test.ts && npx tsc -b && npm run typecheck:server`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/game/systems/items.ts src/game/state/rules/counters.ts src/game/state/selectors.ts src/components/WorkshopPanel.tsx src/game/state/reducer.test.ts src/game/state/selectors.test.ts server/src/FarmRoom.test.ts
git commit -m "feat(blacksmith): each rung costs three bars and half the gold"
```

---

### Task 4: Ore veins are resource nodes

**Files:**
- Modify: `src/game/systems/resources.ts` (`NodeKind`, `ResourceNode.item` doc, `NODE_DEFS`, `createNode`, `yieldOf`, `checkTool`, `startNodeDay`)
- Modify: `src/game/state/persistence.ts` (`parseNode` near line 360, `parseNodes` near line 378)
- Modify: `src/game/scenes/farm/ground.ts` (`nodeTexture` near line 44, `CHIP_TINTS` near line 159)
- Modify: `src/game/assets/createPixelArtTextures.ts` (after `drawRock` near line 1195, `createResourceTextures` near line 1274)
- Modify: `docs/specs/16-metal-and-the-mine.md` (one line about the seed)
- Test: `src/game/systems/resources.test.ts`, `src/game/systems/mine.test.ts` (`describe('the day and the save')`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `NodeKind` gains `'ore'`. An ore node's `item` is one of `MINED_ITEMS`.
  - `export function oreRequires(item: ItemId): ToolTier` returns `'copper'` for `iron-ore`, `'steel'` for `gold-ore`, and `'basic'` otherwise.
  - `createNode(id, kind, area, x, y, extra)` where `extra` gains `requires?: ToolTier`.
  - Texture keys `node-ore-${item}`.

- [ ] **Step 1: Write the failing resource tests**

In `src/game/systems/resources.test.ts`, add `oreRequires` and `yieldOf` to the `./resources` import, and add `mineArea` to the existing `../world/areas` import (it currently imports `AREA_IDS, TILE_SIZE, areaMap, isWalkable, plotKey, plotTiles, type AreaId`). Then add at the end of the file:

```ts
describe('ore veins', () => {
  const FLOOR = mineArea(12);

  function vein(item: ItemId, id = 'mine:12:ore:0'): ResourceNode {
    return createNode(id, 'ore', FLOOR, 3, 3, { item, requires: oreRequires(item) });
  }

  it('wants a better pick for the deeper metals', () => {
    expect(oreRequires('copper-ore')).toBe('basic');
    expect(oreRequires('coal')).toBe('basic');
    expect(oreRequires('gem')).toBe('basic');
    expect(oreRequires('iron-ore')).toBe('copper');
    expect(oreRequires('gold-ore')).toBe('steel');

    expect(checkTool(vein('iron-ore'), 'pickaxe')).toMatchObject({ ok: false, tooWeak: 'copper' });
    expect(checkTool(vein('iron-ore'), 'copper-pickaxe')).toEqual({ ok: true });
    expect(checkTool(vein('gold-ore'), 'copper-pickaxe')).toMatchObject({ ok: false, tooWeak: 'steel' });
    expect(checkTool(vein('copper-ore'), 'axe')).toMatchObject({ ok: false, tooWeak: null });
  });

  it('names the ore, not the vein, when it refuses', () => {
    const check = checkTool(vein('iron-ore'), 'pickaxe');
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason.startsWith('Quặng sắt')).toBe(true);
  });

  it('gives one to three of its ore, and exactly one gem', () => {
    for (let day = 1; day <= 30; day += 1) {
      const drops = yieldOf(vein('copper-ore', `mine:12:ore:${day}`), day, SEED).drops;
      expect(drops).toHaveLength(1);
      expect(drops[0].item).toBe('copper-ore');
      expect(drops[0].count).toBeGreaterThanOrEqual(1);
      expect(drops[0].count).toBeLessThanOrEqual(3);
      expect(yieldOf(vein('gem'), day, SEED).drops).toEqual([{ item: 'gem', count: 1 }]);
    }
  });

  it('is three swings of a pick at three energy each, and does not block the tunnel', () => {
    expect(NODE_DEFS.ore).toMatchObject({ tool: 'pickaxe', health: 3, energy: 3, solid: false });
    expect(vein('coal').health).toBe(3);
  });

  it('is gone by the morning, because nobody sleeps in the mine', () => {
    const after = startNodeDay([vein('coal')], world(), 'Spring', 2, SEED);
    expect(after.nodes.filter((node) => node.area === FLOOR)).toEqual([]);
  });
});
```

Add `type ItemId` to the `./items` import in that file if it is not there.

- [ ] **Step 2: Write the failing save test**

In `src/game/systems/mine.test.ts`, add `import { createNode, oreRequires } from './resources';`. Inside `describe('the day and the save')`, add:

```ts
  it('never saves a vein of ore, which is rebuilt from the seed on the next visit', () => {
    let state = farmWith('p1');
    const ore = createNode('mine:7:ore:0', 'ore', mineArea(7), 3, 3, { item: 'iron-ore', requires: oreRequires('iron-ore') });
    state = { ...state, nodes: [...state.nodes, ore] };
    const loaded = decodeSave(encodeSave(state));
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes.some((node) => node.area === mineArea(7))).toBe(false);
    expect(loaded!.nodes).toHaveLength(state.nodes.length - 1);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/game/systems/resources.test.ts src/game/systems/mine.test.ts`
Expected: FAIL. `oreRequires` is not exported and `'ore'` is not a `NodeKind`.

- [ ] **Step 4: Add the node kind**

In `src/game/systems/resources.ts`, import `isMineArea` from `'../world/areas'` (add it to the existing import list). Extend `NodeKind`:

```ts
  /** Something worth picking up, which is different in each season. */
  | 'forage'
  /**
   * A vein in a mine floor (spec 16). One kind for every ore: which ore is
   * `item`, and how hard it is is `requires`, exactly as the doc on
   * `ResourceNode.requires` always meant.
   */
  | 'ore';
```

Change the doc on `ResourceNode.item` to `/** For \`forage\` and \`ore\`: which item it is. Null for everything else. */`.

In `NODE_DEFS`, after `forage`:

```ts
  ore: {
    kind: 'ore',
    label: 'Mạch quặng',
    tool: 'pickaxe',
    health: 3,
    requires: 'basic',
    energy: 3,
    // Not solid. Mine tunnels are two tiles wide and nothing in the floor
    // generator promises a vein never sits across the only way to the ladder.
    solid: false,
    blurb: 'Đá trong mỏ, có khi lẫn kim loại. Loại sâu hơn cần cuốc chim tốt hơn.',
  },
```

After `isNodeKind`, add:

```ts
/**
 * How good a pick an ore wants.
 *
 * The ladder that makes the mine a ladder: copper from the shallow floors buys
 * the copper pick that opens iron, and the steel pick that iron buys opens gold.
 */
const ORE_REQUIRES: Partial<Record<ItemId, ToolTier>> = { 'iron-ore': 'copper', 'gold-ore': 'steel' };

export function oreRequires(item: ItemId): ToolTier {
  return ORE_REQUIRES[item] ?? 'basic';
}
```

In `createNode`, widen `extra` and use it:

```ts
  extra: { stage?: number | null; item?: ItemId | null; requires?: ToolTier } = {},
```

```ts
    requires: extra.requires ?? NODE_DEFS[kind].requires,
```

In `yieldOf`, add a case after `forage`:

```ts
    case 'ore': {
      if (!node.item) return NOTHING;
      const count = node.item === 'gem' ? 1 : between(1, 3, draw, 'ore');
      return { drops: [{ item: node.item, count }], hay: 0 };
    }
```

In `checkTool`, add after `const def = NODE_DEFS[node.kind];`:

```ts
  // A vein says what it is, so the refusal sends a player to the right anvil:
  // "quặng sắt", not "mạch quặng".
  const label = node.kind === 'ore' && node.item ? itemDef(node.item).label : def.label;
```

In both refusal strings, replace `${def.label}` with `${label}`.

In `startNodeDay`, change `let kept: ResourceNode[] = [...nodes];` to:

```ts
  // A mine floor's veins belong to whoever is standing on it, and nobody is
  // standing in the mine at dawn. The floor rebuilds them on the next visit.
  let kept: ResourceNode[] = nodes.filter((node) => !isMineArea(node.area));
```

- [ ] **Step 5: Accept ore in saves, and drop it**

In `src/game/state/persistence.ts`, in `parseNode`, change `if (value.kind === 'forage') {` to `if (value.kind === 'forage' || value.kind === 'ore') {`. In `parseNodes`, make the first line of the `for (const raw of value)` loop:

```ts
    // A vein of ore is a mine floor's, rebuilt from the seed when somebody next
    // stands there (spec 16) — and a save never has anybody standing there.
    if (isObject(raw) && typeof raw.area === 'string' && isMineArea(raw.area)) continue;
```

Confirm `isMineArea` and `isObject` are both imported or defined in the file; `isMineArea` is already used in `parsePlayer`.

- [ ] **Step 6: Draw the veins**

In `src/game/scenes/farm/ground.ts`, in `nodeTexture`, after the forage line:

```ts
  if (node.kind === 'ore') return `node-ore-${node.item}`;
```

In `CHIP_TINTS`, add `ore: tint('light.6'),`.

In `src/game/assets/createPixelArtTextures.ts`, add `import { MINED_ITEMS } from '../systems/mine';` beside the other system imports. After `drawRock`, add:

```ts
/** What flecks each vein, as a body colour and a glint. Plain stone has none. */
const ORE_FLECKS: Record<string, readonly [string, string] | null> = {
  stone: null,
  coal: [PALETTE['shadow.3'], PALETTE['building.0']],
  'copper-ore': [PALETTE['soil.6'], PALETTE['light.5']],
  'iron-ore': [PALETTE['foliage.4'], PALETTE['light.7']],
  'gold-ore': [PALETTE['light.5'], PALETTE['light.7']],
  gem: [PALETTE['water.3'], PALETTE['light.7']],
};

/**
 * A vein: the small rock, with the metal showing through it.
 *
 * Borrowed from the rock rather than drawn again, so a vein reads as a rock
 * that is worth more than a rock — which is all a player needs to know from
 * across a mine floor.
 */
function drawOre(ctx: CanvasRenderingContext2D, item: string) {
  drawRock(ctx, false);
  const fleck = ORE_FLECKS[item];
  if (!fleck) return;
  const [body, shine] = fleck;
  const centreX = NODE.width / 2;
  const bottom = NODE.height - 6;
  rect(ctx, body, Math.round(centreX - 6), bottom - 11, 4, 3);
  rect(ctx, body, Math.round(centreX + 2), bottom - 8, 3, 3);
  rect(ctx, body, Math.round(centreX - 2), bottom - 5, 3, 2);
  rect(ctx, shine, Math.round(centreX - 6), bottom - 11, 1, 1);
}
```

In `createResourceTextures`, after the forage loop:

```ts
  for (const item of MINED_ITEMS) {
    withTexture(scene, `node-ore-${item}`, NODE.width, NODE.height, (ctx) => drawOre(ctx, item));
  }
```

- [ ] **Step 7: Correct the spec's seed line**

In `docs/specs/16-metal-and-the-mine.md`, change `qua \`yieldOf(node, day, mineSeed)\` như mọi node khác.` to `qua \`yieldOf(node, day, seed)\` như mọi node khác (seed là \`spawnSeed\` mà \`applyNodeAct\` đã truyền).`

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/game/systems/resources.test.ts src/game/systems/mine.test.ts src/game/state/persistence.test.ts && npx tsc -b && node --test scripts/palette-lock.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/game/systems/resources.ts src/game/state/persistence.ts src/game/scenes/farm/ground.ts src/game/assets/createPixelArtTextures.ts src/game/systems/resources.test.ts src/game/systems/mine.test.ts docs/specs/16-metal-and-the-mine.md
git commit -m "feat(mine): ore veins are resource nodes a pick can work"
```

---

### Task 5: A floor wakes its veins with its monsters

**Files:**
- Modify: `src/game/state/rules/mine.ts` (`reconcileMonsters` near line 363 → `reconcileFloors`)
- Modify: `src/game/state/reducer.ts` (import and call near lines 69 and 177, and the doc comment above `applyIntent`)
- Test: `src/game/systems/mine.test.ts` (`describe('ladders, elevators and floors')`)

**Interfaces:**
- Consumes: `createNode`, `oreRequires` (Task 4). `floorFor(seed, depth).ores: { x; y; ore }[]` already exists.
- Produces: `export function reconcileFloors(before: FarmState, result: ApplyResult): ApplyResult`. Vein node ids are `mine:${depth}:ore:${index}`, where `index` is the position in `floor.ores`.

- [ ] **Step 1: Write the failing tests**

In `src/game/systems/mine.test.ts`, add to the helper section, after `onLadder`:

```ts
function veinsOn(state: FarmState, depth: number) {
  return state.nodes.filter((node) => node.area === mineArea(depth));
}
```

Inside `describe('ladders, elevators and floors')`, add:

```ts
  it('arriving on a floor lays out its veins, each as hard as its ore', () => {
    const state = onLadder(farmWith('p1'), 'p1', 1);
    const result = applyIntent(state, { type: 'player/descend', playerId: 'p1' });
    const floor = generateFloor(state.mineSeed, 2);

    const veins = veinsOn(result.state, 2);
    expect(veins).toHaveLength(floor.ores.length);
    floor.ores.forEach((ore, i) => {
      expect(veins).toContainEqual(
        expect.objectContaining({
          id: `mine:2:ore:${i}`,
          kind: 'ore',
          x: ore.x,
          y: ore.y,
          item: ore.ore,
          requires: oreRequires(ore.ore),
        }),
      );
    });
  });

  it('forgets the veins when the last player leaves, and a second player keeps them', () => {
    let state = onLadder(onLadder(farmWith('p1', 'p2'), 'p1', 1), 'p2', 1);
    state = applyIntent(state, { type: 'player/descend', playerId: 'p1' }).state;
    state = applyIntent(state, { type: 'player/descend', playerId: 'p2' }).state;
    const veins = veinsOn(state, 2);
    expect(veins.length).toBeGreaterThan(0);

    const oneLeft = applyIntent(state, { type: 'player/exitMine', playerId: 'p1' }).state;
    expect(veinsOn(oneLeft, 2)).toEqual(veins);

    const bothLeft = applyIntent(oneLeft, { type: 'player/exitMine', playerId: 'p2' }).state;
    expect(veinsOn(bothLeft, 2)).toEqual([]);

    const back = applyIntent(onLadder(bothLeft, 'p1', 1), { type: 'player/descend', playerId: 'p1' }).state;
    expect(veinsOn(back, 2)).toEqual(veins);
  });

  it('leaves the surface nodes alone whatever happens below', () => {
    const state = onLadder(farmWith('p1'), 'p1', 1);
    const surface = state.nodes;
    const down = applyIntent(state, { type: 'player/descend', playerId: 'p1' }).state;
    expect(down.nodes.filter((node) => !node.area.startsWith('mine:'))).toEqual(surface);
  });

  it('a pick in hand works a vein; a weak one is told which pick it needs', () => {
    let state = inMine(farmWith('p1'), 'p1', 12);
    const at = generateFloor(state.mineSeed, 12).entrance;
    const iron = createNode('t-iron', 'ore', mineArea(12), at.x, at.y, { item: 'iron-ore', requires: 'copper' });
    state = { ...state, nodes: [...state.nodes, iron] };
    expect(state.players.p1.inventory[4]?.item).toBe('pickaxe');
    state = patch(state, 'p1', { selectedSlot: 4 });

    const weak = applyIntent(state, { type: 'player/act', playerId: 'p1', target: at });
    expect(ofKind(weak.events, 'toolTooWeak')).toEqual([
      { kind: 'toolTooWeak', playerId: 'p1', node: 'ore', requires: 'copper' },
    ]);
    expect(veinsOn(weak.state, 12)).toEqual([iron]);

    const inventory = [...state.players.p1.inventory];
    inventory[4] = newStack('copper-pickaxe');
    let strong = patch(state, 'p1', { inventory });
    for (let swing = 0; swing < 3; swing += 1) {
      strong = applyIntent(strong, { type: 'player/act', playerId: 'p1', target: at }).state;
    }
    expect(veinsOn(strong, 12)).toEqual([]);
    expect(countItem(strong.players.p1.inventory, 'iron-ore')).toBeGreaterThanOrEqual(1);
    expect(strong.players.p1.energy).toBeLessThan(state.players.p1.energy);
  });
```

Also add `startNewDay` coverage to the existing test `a new day brings everyone out of the mine rested…`: before `const next = startNewDay(state).state;` add

```ts
    const vein = createNode('mine:3:ore:0', 'ore', mineArea(3), 4, 4, { item: 'coal' });
    state = { ...state, nodes: [...state.nodes, vein] };
```

and after `expect(next.monsters).toEqual([]);` add `expect(veinsOn(next, 3)).toEqual([]);`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/systems/mine.test.ts`
Expected: FAIL for `arriving on a floor lays out its veins…`, `forgets the veins when the last player leaves…` and the new `veinsOn(next, 3)` assertion is already satisfied by Task 4's `startNodeDay` filter, so that one passes. The pick test (`a pick in hand works a vein…`) is expected to **pass already**: it adds its vein by hand, and it exists to prove that `applyAct`'s existing order reaches `applyNodeAct` underground. If it fails, stop and investigate `applyAct` before changing `reconcileFloors`.

- [ ] **Step 3: Rename and extend the reconcile pass**

In `src/game/state/rules/mine.ts`, add `import { createNode, oreRequires } from '../../systems/resources';`. Replace the doc comment and body of `reconcileMonsters` with:

```ts
/**
 * Wakes a floor that has just gained its first player, and forgets one that
 * has just lost its last: its monsters, and since spec 16 its veins of ore.
 *
 * Run after every intent, comparing the farm before it with the farm after,
 * which is why no "live floors" list has to be stored: the transition is the
 * list. A floor woken twice in a day is rebuilt from the same seed, so it
 * comes back exactly as it was first found — ore and all, which is why the
 * elevator only goes to floors already opened. Monsters and veins share this
 * one pass because they share one lifetime: a floor with fresh monsters and
 * yesterday's ore is a floor no seed ever made.
 */
export function reconcileFloors(before: FarmState, result: ApplyResult): ApplyResult {
  const after = result.state;
  if (after === before) return result;

  const was = occupiedFloors(before);
  const is = occupiedFloors(after);
  const woken = [...is].filter((depth) => !was.has(depth)).sort((a, b) => a - b);
  const keep = (area: string) => {
    const depth = mineDepth(area);
    return depth === null || (is.has(depth) && !woken.includes(depth));
  };
  const staleMonsters = after.monsters.some((monster) => mineDepth(monster.area) === null || !keep(monster.area));
  const staleNodes = after.nodes.some((node) => !keep(node.area));
  if (!staleMonsters && !staleNodes && woken.length === 0) return result;

  const monsters = after.monsters.filter((monster) => mineDepth(monster.area) !== null && keep(monster.area));
  const nodes = after.nodes.filter((node) => keep(node.area));
  for (const depth of woken) {
    const floor = floorFor(after.mineSeed, depth);
    for (const spawn of floor.monsters) {
      monsters.push({
        id: spawn.id,
        kind: spawn.kind,
        area: mineArea(depth),
        ...tileCentre(spawn),
        health: spawn.health,
        nextAttackAt: 0,
        invulnerableUntil: 0,
      });
    }
    floor.ores.forEach((ore, index) => {
      nodes.push(
        createNode(`mine:${depth}:ore:${index}`, 'ore', mineArea(depth), ore.x, ore.y, {
          item: ore.ore,
          requires: oreRequires(ore.ore),
        }),
      );
    });
  }
  return { state: { ...after, monsters, nodes }, events: result.events };
}
```

Check before moving on that `staleMonsters` treats a monster exactly as the old code did. The old stale test was `depth === null || !is.has(depth) || woken.includes(depth)`, and `mineDepth(area) === null || !keep(area)` is the same condition.

- [ ] **Step 4: Point the reducer at the new name**

In `src/game/state/reducer.ts`, change the import `reconcileMonsters,` to `reconcileFloors,`, the call to `return reconcileFloors(state, dispatch(state, intent));`, and in the doc comment above `applyIntent` change `` `reconcileMonsters` `` to `` `reconcileFloors` `` and "a floor's monsters wake and sleep" to "a floor's monsters and veins wake and sleep".

Run: `npx tsc -b`
Expected: no reference to `reconcileMonsters` remains. Confirm with a search: `grep -rn reconcileMonsters src server/src` prints nothing.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/game/systems/mine.test.ts src/game/state/reducer.test.ts src/game/state/selectors.test.ts`
Expected: PASS, including every monster test that already existed.

- [ ] **Step 6: Commit**

```bash
git add src/game/state/rules/mine.ts src/game/state/reducer.ts src/game/systems/mine.test.ts
git commit -m "feat(mine): a floor lays out its veins with its monsters, and forgets both"
```

---

### Task 6: A rusty sword at the mouth, and better ones by depth

**Files:**
- Modify: `src/game/systems/crafting.ts` (`RecipeUnlock`, `UnlockContext`, `unlockMet`, `RECIPES`)
- Modify: `src/game/state/rules/placeables.ts` (`learnRecipes`)
- Modify: `src/game/state/rules/day.ts` (line 118)
- Modify: `src/game/state/rules/village.ts` (line 176)
- Modify: `src/game/state/rules/mine.ts` (`arrive`)
- Test: `src/game/systems/crafting.test.ts` (`describe('unlocks')`), `src/game/systems/mine.test.ts`

**Interfaces:**
- Consumes: sword and bar ids (Task 1).
- Produces:
  - `RecipeUnlock` gains `{ by: 'depth'; depth: number }`.
  - `UnlockContext.deepestFloor?: number`, treated as 0 when absent.
  - `learnRecipes(player: PlayerState, day: number, deepestFloor: number)`.
  - Recipes `copper-sword`, `steel-sword`, `gold-sword`.

- [ ] **Step 1: Write the failing crafting tests**

In `src/game/systems/crafting.test.ts`, inside `describe('unlocks')`, add:

```ts
  it('opens a sword when the farm has been deep enough, and not a floor before', () => {
    const swords: Array<[ItemId, number]> = [
      ['copper-sword', 10],
      ['steel-sword', 20],
      ['gold-sword', 30],
    ];
    for (const [id, depth] of swords) {
      const recipe = recipeFor(id)!;
      expect(recipe.unlock).toEqual({ by: 'depth', depth });
      expect(unlockMet(recipe.unlock, { day: 1, heartsFor: () => 0, deepestFloor: depth - 1 })).toBe(false);
      expect(unlockMet(recipe.unlock, { day: 1, heartsFor: () => 0, deepestFloor: depth })).toBe(true);
      expect(unlockMet(recipe.unlock, NO_HEARTS)).toBe(false);
    }
  });

  it('makes a copper sword out of three bars and five planks', () => {
    const result = craft(bag({ 'copper-bar': 3, wood: 5 }), ['copper-sword'], 'copper-sword', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countItem(result.inventory, 'copper-sword')).toBe(1);
    expect(countItem(result.inventory, 'copper-bar')).toBe(0);

    const short = craft(bag({ 'copper-bar': 2, wood: 5 }), ['copper-sword'], 'copper-sword', 1);
    expect(short.ok).toBe(false);
  });
```

- [ ] **Step 2: Write the failing mine tests**

In `src/game/systems/mine.test.ts`, add `mineMouth` to the `../world/areas` import. Add a new `describe` at the end of the file:

```ts
describe('swords (spec 16)', () => {
  function atTheMouth(state: FarmState, id: PlayerId): FarmState {
    return patch(state, id, mineMouth()!);
  }

  it('hands a rusty sword to somebody going down without one', () => {
    const state = atTheMouth(farmWith('p1'), 'p1');
    expect(countItem(state.players.p1.inventory, SWORD)).toBe(0);

    const result = applyIntent(state, { type: 'player/descend', playerId: 'p1' });

    expect(result.state.players.p1.area).toBe(mineArea(1));
    expect(countItem(result.state.players.p1.inventory, SWORD)).toBe(1);
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'p1',
      text: 'Có người để lại một thanh kiếm gỉ ở cửa mỏ.',
    });
  });

  it('hands nothing over to somebody already carrying any sword', () => {
    let state = atTheMouth(farmWith('p1'), 'p1');
    state = patch(state, 'p1', { inventory: addItem(state.players.p1.inventory, 'copper-sword')! });

    const result = applyIntent(state, { type: 'player/descend', playerId: 'p1' });

    expect(countItem(result.state.players.p1.inventory, SWORD)).toBe(0);
    expect(countItem(result.state.players.p1.inventory, 'copper-sword')).toBe(1);
  });

  it('still lets a full satchel down, and says the sword was left behind', () => {
    let state = atTheMouth(farmWith('p1'), 'p1');
    state = patch(state, 'p1', {
      inventory: state.players.p1.inventory.map((slot) => slot ?? newStack('stone', 99)),
    });

    const result = applyIntent(state, { type: 'player/descend', playerId: 'p1' });

    expect(result.state.players.p1.area).toBe(mineArea(1));
    expect(countItem(result.state.players.p1.inventory, SWORD)).toBe(0);
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'p1',
      text: 'Có một thanh kiếm gỉ ở cửa mỏ, mà túi bạn hết chỗ.',
    });
  });

  it('teaches the whole farm the copper sword the moment anybody reaches floor ten', () => {
    let state = { ...farmWith('p1', 'p2'), deepestFloor: 9 };
    state = onLadder(state, 'p1', 9);
    expect(state.players.p2.knownRecipes).not.toContain('copper-sword');

    const result = applyIntent(state, { type: 'player/descend', playerId: 'p1' });

    expect(result.state.deepestFloor).toBe(10);
    expect(result.state.players.p1.knownRecipes).toContain('copper-sword');
    expect(result.state.players.p2.knownRecipes).toContain('copper-sword');
    expect(ofKind(result.events, 'recipeLearned').map((event) => event.playerId).sort()).toEqual(['p1', 'p2']);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/game/systems/crafting.test.ts src/game/systems/mine.test.ts`
Expected: FAIL. `recipeFor('copper-sword')` is `null`, and no sword is handed over.

- [ ] **Step 4: The unlock and the recipes**

In `src/game/systems/crafting.ts`, add to `RecipeUnlock`:

```ts
  | { by: 'day'; day: number }
  /**
   * Spec 16: the farm's deepest floor. The farm's rather than the player's,
   * unlike hearts: "somebody has been down there" is news for the whole group.
   */
  | { by: 'depth'; depth: number };
```

Add to `UnlockContext`:

```ts
  /** The farm's record depth. Absent reads as never having gone down. */
  deepestFloor?: number;
```

Add a case to `unlockMet`:

```ts
    case 'depth':
      return (context.deepestFloor ?? 0) >= unlock.depth;
```

In `RECIPES`, after the phố group, add:

```ts
  // --- the mine --------------------------------------------------------------
  //
  // Spec 16. A sword for each band, opened by reaching the band rather than
  // bought: the copper one is what makes floors ten to nineteen comfortable,
  // and it arrives the moment somebody first stands on floor ten. Wood for the
  // hilt of the first and hardwood for the two that have to take a real hit.
  { id: 'copper-sword', needs: { 'copper-bar': 3, wood: 5 }, yields: 1, unlock: { by: 'depth', depth: 10 } },
  { id: 'steel-sword', needs: { 'iron-bar': 3, hardwood: 5 }, yields: 1, unlock: { by: 'depth', depth: 20 } },
  { id: 'gold-sword', needs: { 'gold-bar': 3, hardwood: 5 }, yields: 1, unlock: { by: 'depth', depth: 30 } },
```

- [ ] **Step 5: Pass the depth to every learning site**

In `src/game/state/rules/placeables.ts`, change `learnRecipes`:

```ts
export function learnRecipes(
  player: PlayerState,
  day: number,
  deepestFloor: number,
): { player: PlayerState; events: GameEvent[] } {
  const learned = newlyUnlocked(player.knownRecipes, {
    day,
    heartsFor: (npc) => heartsWith(player.relationships, npc),
    deepestFloor,
  });
```

In `src/game/state/rules/day.ts` line 118: `const taught = learnRecipes(woken, time.day, state.deepestFloor);`

In `src/game/state/rules/village.ts` line 176: `const taught = learnRecipes(next, state.time.day, state.deepestFloor);`

- [ ] **Step 6: The sword and the lesson in `arrive`**

In `src/game/state/rules/mine.ts`, add `import { learnRecipes } from './placeables';`. Replace `arrive` with:

```ts
/** What is left at the mouth of the mine for anybody going down unarmed (spec 16). */
const RUSTY_SWORD: ItemId = 'rusty-sword';

/**
 * Puts one player at the top of a floor. Only them: in a shared world the
 * ladder is not a party decision, and the group splitting up is acceptable.
 *
 * Two things ride along since spec 16. A player going down with no sword at
 * all is handed the rusty one — here rather than in the starting kit, because
 * a sword with nothing to hit is a seventh icon nobody reads, and because an
 * old save gets one the same way. And a new record teaches the whole farm
 * whatever that depth opens, on the spot rather than at dawn.
 */
function arrive(state: FarmState, playerId: PlayerId, depth: number): ApplyResult {
  const player = state.players[playerId];
  const floor = floorFor(state.mineSeed, depth);
  const area = mineArea(depth);
  let moved: PlayerState = { ...leaveWhereYouAre(player), area, ...tileCentre(floor.entrance) };
  const events: GameEvent[] = [
    { kind: 'areaChanged', playerId, area },
    { kind: 'descended', playerId, depth },
    say(playerId, `Tầng ${depth}.`),
  ];

  const armed = moved.inventory.some((stack) => stack && ITEMS[stack.item]?.tool === 'sword');
  if (!armed) {
    const given = addItem(moved.inventory, RUSTY_SWORD, 1);
    if (given) {
      moved = { ...moved, inventory: given };
      events.push(say(playerId, 'Có người để lại một thanh kiếm gỉ ở cửa mỏ.'));
    } else {
      events.push(say(playerId, 'Có một thanh kiếm gỉ ở cửa mỏ, mà túi bạn hết chỗ.'));
    }
  }

  let next = withPlayer(state, moved);
  if (depth > state.deepestFloor) {
    next = { ...next, deepestFloor: depth };
    events.push({ kind: 'newDepthRecord', depth });
    const players = { ...next.players };
    for (const [id, member] of Object.entries(players)) {
      const taught = learnRecipes(member, next.time.day, depth);
      players[id] = taught.player;
      events.push(...taught.events);
    }
    next = { ...next, players };
  }
  return { state: next, events };
}
```

Adjust the `Object.entries` loop's key type if `tsc` complains (`players[id as PlayerId]`).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/game/systems/crafting.test.ts src/game/systems/mine.test.ts src/game/state/reducer.test.ts src/game/state/selectors.test.ts && npx tsc -b`
Expected: PASS. If an existing mine test compares `events` exactly with `toEqual`, it filters by kind with `ofKind` first; a test that does not must now expect the sword message too.

- [ ] **Step 8: Commit**

```bash
git add src/game/systems/crafting.ts src/game/state/rules/placeables.ts src/game/state/rules/day.ts src/game/state/rules/village.ts src/game/state/rules/mine.ts src/game/systems/crafting.test.ts src/game/systems/mine.test.ts
git commit -m "feat(mine): a rusty sword at the mouth, and better swords as the farm goes deeper"
```

---

### Task 7: Close the spec out

**Files:**
- Modify: `docs/specs/README.md` (the spec 16 row, and the prose under "Phần còn lại")
- Modify: `README.md` (the fishing/blacksmith bullets in "Hiện tại chơi được gì", and the roadmap tables)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new in code.

- [ ] **Step 1: Run the full gate**

Run: `npm run quality:fast`
Expected: lint clean, every Vitest suite passing (1020 baseline plus the new tests), `test:scripts` and `art-sync --check` passing, and `tsc -b && vite build` succeeding. Run `npm run typecheck:server` too. If anything fails, fix it inside the task that introduced it and amend nothing: add a fix commit.

- [ ] **Step 2: Play it once**

Use the `run` skill to start `npm run dev` and, in the browser, walk to the mine in Hollowpine Wood and go down. Confirm the rusty-sword message, that veins are drawn on floor 1, that three swings of the starting pickaxe take one and the satchel gains ore, and that a copper-ore vein on a later floor refuses with the Vietnamese message naming the ore. Then craft a furnace (use the devtools console or a dev seed only if one exists; otherwise note the check as not done), and open the blacksmith panel to see "3 đồng thỏi · 250g" in red when you have none. Report each check as seen or not seen.

- [ ] **Step 3: Update the docs**

In `docs/specs/README.md`, move the spec 16 row out of "Phần còn lại" into the done table with the struck-through style used there, and add a short "### Spec 16 để lại gì" section listing: the `ore` node kind and `oreRequires`; `reconcileFloors` owning both monsters and veins; `MachineDef.converts`/`fuel`; `TierDef.bars`/`upgradeFor().bars`; `{ by: 'depth' }` unlocks and `learnRecipes(player, day, deepestFloor)`.

In `README.md`, rewrite the blacksmith bullet so it says tools cost bars and gold and the bars come from a furnace fed with mine ore, and add a bullet for the mine: forty generated floors, veins that want better picks, a rusty sword at the mouth, swords opened by depth.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/README.md README.md
git commit -m "docs: spec 16 is in — the mine gives metal and the anvil wants it"
```

---

## Self-review notes

- **Spec coverage:** Veins as nodes, the hardness table, yield, non-solid, lifecycle, `startNodeDay` and the save → Tasks 4 and 5. Digging in the mine → Task 5, whose pick test proves `applyAct`'s existing order (sword → ladder → node) reaches `applyNodeAct` underground with no code change. Furnace, `converts`/`fuel`, all-or-nothing loading and the recipe → Task 2. Bar prices → Task 1. Blacksmith bars, order of checks, refusal text, panel and selector → Task 3. Swords, rusty sword in `arrive`, depth unlock for the whole farm → Tasks 1 and 6. Placeholder art → Tasks 1, 2 and 4. `seedNodes` skipping `mine:*` needs no change, because it already iterates only `AREA_IDS`.
- **Deliberate deviation from the spec:** the seed passed to `yieldOf` is `spawnSeed`, not `mineSeed`, because that is what `applyNodeAct` already passes. Task 4 Step 7 corrects the spec line.
- **Known follow-up, not in scope:** `quality-sprinkler` becomes craftable once a copper bar exists; no change is needed for that.
