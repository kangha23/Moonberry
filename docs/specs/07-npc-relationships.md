# 07 — NPCs worth visiting

**Depends on:** [03 — Inventory slots](03-inventory-slots.md) for gifts

## Goal

Give the village people, and give the player a reason to walk there that is not
the market stall.

## Why it is last, and why it matters most

It is last because it is the largest, and because it is mostly content rather
than architecture — writing dialogue and schedules, not solving problems.

It matters most because it is the answer to "why keep playing once the farm runs
itself". Crops are the engine; the town is the reason. A farming game with a
perfect economy and nobody in it is a spreadsheet with weather.

Rowan today is a sprite that does not move, holds one quest, and repeats a
single line forever once it is done.

## Design decisions

**NPCs are data.** A definition file per character; the engine reads it. Adding
a villager should not mean touching the reducer.

```ts
// src/game/npcs/definitions.ts
export interface NpcDef {
  id: NpcId;
  name: string;
  texture: string;
  birthday: { season: Season; day: number };
  /** Item reactions. Anything unlisted falls to `defaultGiftReaction`. */
  gifts: Partial<Record<ItemId, GiftReaction>>;
  defaultGiftReaction: GiftReaction;
  /** Where they are, by season, weather and hour. */
  schedule: ScheduleEntry[];
  dialogue: DialogueEntry[];
}

export type GiftReaction = 'loved' | 'liked' | 'neutral' | 'disliked' | 'hated';
```

**Relationships are farm-wide or per player? Per player.** This is the one place
where the shared-world model should not apply: a friendship is between two
people. Stardew does it per player and the alternative is strange — one
farmhand's gifts making everyone Rowan's friend.

That means relationship state hangs off `PlayerState`, not `FarmState`, and the
save grows per player rather than per world.

```ts
interface PlayerState {
  // ...
  relationships: Record<NpcId, { points: number; giftsThisWeek: number; giftedToday: boolean }>;
}
```

Hearts are `Math.floor(points / 250)`, capped at ten, as a display of points
rather than a second number to keep in step.

**Gift limits exist to stop grinding.** Two gifts per week per NPC, one per day.
Without the cap, the optimal play is to stand still handing over turnips, which
is neither interesting nor what friendship is.

**Birthdays multiply.** A gift on the day counts eight times. It is the single
best reason to look at the calendar, which is otherwise just a number in the
corner.

**Schedules are the difference between a village and a set.** An NPC who stands
on one tile forever is scenery. One who is at the market in the morning and
home by evening makes the world feel like it exists when you are not looking.

Start simple: a list of `(season?, weather?, fromHour, toHour, area, x, y)` and
walk between them. Pathfinding can be a straight line for now — the village is
open ground — but leave the seam for A* later, because the first indoor area
will need it.

**Dialogue is a table with conditions, not a tree.** Conditions on hearts,
season, weather, day, and whether an event has fired. Pick the highest-priority
matching line. A tree is more work and this game does not need branching
conversation to feel alive; it needs the right line at the right moment.

## Multiplayer

The hard question: **NPCs are shared, but relationships are not.** Two players
can talk to Rowan at once and should each get their own dialogue and their own
points.

- NPC positions are world state, simulated once by the server.
- Dialogue and gifts resolve per player.
- A gift is an `act` on an NPC with a selected item, so it goes through the same
  reach validation as everything else (spec 05).

Cutscenes are worse: Stardew pauses the world, which cannot work when three
other people are playing. Either scope cutscenes out entirely, or make them
personal — the triggering player sees the scene, others see the two of them
standing and talking. **Recommend scoping them out** for now and reconsidering
once the rest is in.

## New state

`FarmState` gains NPC positions, which the server advances. Keep it small: an
id, an area, a position, and which schedule entry is active.

`SAVE_VERSION` increments. Relationships default to empty, which reads as zero
hearts — correct for a returning player who has never met anybody.

## Reducer changes

- `applyAct` on a prop with `interact: 'npc:<id>'` resolves to talk or gift,
  depending on whether the selected slot holds a giftable item.
- New `world/npcTick`, folded into the existing tick, advancing NPCs along their
  schedules.
- `startNewDay` clears `giftedToday`, and `giftsThisWeek` on the first day of
  each week.
- Events: `{ kind: 'npcSpoke'; npc; playerId; line }`,
  `{ kind: 'giftGiven'; npc; playerId; reaction; heartsNow }`.

## Content, which is the actual work

Four to six villagers is the minimum for a village to feel populated. Each needs
a name and a personality that is legible in three lines, a sprite sheet with a
walk cycle, a daily schedule, twenty to forty dialogue lines across hearts and
seasons, and a gift table.

The art is the constraint: LPC has a character generator that can produce
consistent villagers, which is the practical path and keeps the licensing
consistent with what is already in `public/assets/lpc/CREDITS.md`.

Budget this honestly. The code here is perhaps a fifth of the work.

## Tests

- Gift points follow the reaction table, and the birthday multiplier applies
  only on the birthday.
- The second gift in a day is refused; the third in a week is refused.
- Two players gifting the same NPC accrue separate points.
- An NPC is at the position its schedule says for a given hour, season and
  weather.
- Dialogue selection picks the highest-priority line whose conditions hold, and
  always returns something — a villager with nothing to say is a bug, not an
  empty string.
- Relationships survive a save, a restart and a rejoin.

## Out of scope

Marriage, children, festivals, cutscenes, the community centre, and anything
that pauses the world for everybody.
