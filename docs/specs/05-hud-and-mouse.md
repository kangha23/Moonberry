# 05 — One HUD, and the mouse

**Depends on:** [03 — Inventory slots](03-inventory-slots.md)

## Goal

Fix what is wrong with the interface today, rather than adding to it.

## What is wrong

**The HUD is drawn twice.** The clock, season, weather and quest progress are
rendered inside the Phaser canvas at
[`FarmScene.ts:788`](../../src/game/scenes/FarmScene.ts#L788) *and* in the React
panel at [`App.tsx:51`](../../src/App.tsx#L51). The same numbers, in two
typefaces, updated by two code paths. Nobody designed this; it is what happened
when the canvas grew a HUD and the React shell was never revisited.

**There is no mouse.** `grep -rn "pointer" src/game` returns nothing. The game
is keyboard-only, and the tile you act on is derived from which way your sprite
faces — so acting on the plot beside you means walking to face it. Stardew is
mouse-first and it is the difference between farming and wrestling.

**Feedback is prose.** Acting prints a sentence into a bar. See spec 02; the
prompt should be the fallback, not the channel.

## Design decisions

**In-world information goes in the canvas. Meta information stays in React.**

The dividing line is whether the player is looking at the world or at the
program. Overlapping both in both places is what produced the duplication.

| Canvas | React panel |
| --- | --- |
| Clock, day, season, weather | Invite code and copy link |
| Area name | Connection status, offline notice |
| Hotbar, energy, prompt | Save controls, audio settings |
| Quest tracker | The page's title and framing |

The full inventory screen (spec 03) is the exception: it is document-shaped, and
the DOM does documents better than a canvas does. Draw it in React, over the
canvas, and suppress game input while it is open.

**Mouse targets a tile; the keyboard still works.** Both, always. Hover
highlights the tile under the cursor when it is within reach; clicking acts on
it. With no mouse movement, the cursor falls back to the faced tile, so a
keyboard player sees no change.

**Reach is a rule, not a UI convenience.** The client must grey out tiles out of
range, and the server must refuse actions on them. Range-checking only on the
client hands anyone with devtools the ability to farm the whole map from the
gate.

## Protocol change

`act` gains an optional target:

```ts
| { type: 'act'; target?: { x: number; y: number } }
```

- Absent means "the tile I am facing", preserving the keyboard path exactly.
- Present is validated in `parseClientCommand` as integers in range, then
  validated again in the reducer for distance from the acting player.

```ts
// src/game/world/areas.ts
export const REACH_TILES = 1.5;
export function isWithinReach(from: Point, tileX: number, tileY: number): boolean;
```

`1.5` tiles is Stardew's feel: the eight neighbours plus your own tile, and
nothing across the fence.

## Files

- `src/game/scenes/FarmScene.ts` — pointer handlers, reach-aware cursor, hotbar,
  energy bar, quest tracker, area name. Take the clock and weather text with it
  and delete the React equivalents.
- `src/App.tsx` — reduce to the framing, the connection panel and the settings.
  Remove the satchel grid, the day card and the quest card.
- `src/game/state/reducer.ts` — `applyAct` takes the target, defaulting to the
  faced tile, and refuses anything out of reach.
- `src/game/net/protocol.ts` — the target field and its validation.

## Pointer details worth getting right

- **Convert screen to world coordinates** through the camera
  (`camera.getWorldPoint`), not by adding scroll offsets by hand. The camera
  follows with a lerp and hand arithmetic will drift by a frame.
- **The canvas scales.** `Phaser.Scale.FIT` means the canvas is not its design
  size; the pointer must come from Phaser's input system, which accounts for it,
  rather than from raw DOM event coordinates.
- **Do not act on mouse-down over the HUD.** The hotbar is inside the canvas, so
  a click on it is a click on the world unless the hit test runs first.
- **Click-and-hold repeats** on the tile under the cursor, at the same cadence
  as held keys. Tilling a row by dragging is most of why the mouse is better.

## Accessibility

- Every mouse action keeps a keyboard equivalent. This is the rule, not a
  nicety: the keyboard path already exists and must not regress.
- The inventory screen is real DOM, so it must be focus-trapped, closable with
  `Escape`, and navigable with the keyboard.
- The prompt bar is the game's text channel; mirror it into an ARIA live region
  in the React shell so a screen reader announces what happened.

## Tests

- `act` with no target behaves exactly as today — the faced tile.
- `act` with a target one tile away is applied there.
- `act` with a target across the map is refused and changes nothing, even when
  the payload is well-formed.
- `parseClientCommand` rejects a non-integer, negative or absurd target.
- `isWithinReach` accepts the eight neighbours and the player's own tile, and
  rejects two tiles out.
- The React shell renders no clock, no weather and no satchel — a regression
  test against the duplication returning.

## Out of scope

Controller support, touch controls, remappable keys, full UI theming.
