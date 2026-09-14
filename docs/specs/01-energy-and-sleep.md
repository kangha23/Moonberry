# 01 — Energy and sleeping

## Goal

Make a day cost something, and make the player decide when it ends.

## Why this first

Stardew is not compelling because you can till soil. It is compelling because
you cannot till all of it. Energy and daylight are a budget, every swing spends
it, and the game is the daily question of what to spend it on.

Today nothing is scarce. Tilling is free and unlimited, the clock rolls from
23:00 to the next morning on its own, and staying out late costs nothing. There
is no decision anywhere in the loop, so there is no game in it — only a
mechanism that works.

This spec adds the budget. It is the single change that most alters what the
game *is*.

## Design decisions

**Energy is per player, not per farm.** The wallet is shared because money is
the farm's; exhaustion is yours. It lives on `PlayerState` beside the satchel.

**Harvesting is free.** In Stardew, hoe, can, axe and pickaxe cost energy;
picking a ripe crop does not. Keep that: the cost is on preparing and
maintaining, so a day of harvesting is the reward for days of work.

| Action | Cost |
| --- | --- |
| Till | 2 |
| Water | 2 |
| Plant | 0 |
| Harvest | 0 |

Starting maximum: **270**, matching Stardew's first-day stamina, which is tuned
to roughly a field's worth of work. Treat the number as a starting point to
playtest, not a constant to defend.

**Running out does not block acting.** It is tempting to refuse the action at
zero, but that turns a soft budget into a wall and removes the interesting
decision — pushing on when you should stop. Instead:

- At zero energy, movement drops to half speed and the screen desaturates.
- Acting is still allowed and still costs nothing more.
- Staying awake past 02:00 collapses the player (below).

**The day ends when everyone asleep, or at 02:00.** `DAY_END` moves from
`23 * 60` to `26 * 60` — 02:00 the next morning, expressed as hours past
midnight of the current day, because the existing clock is minutes-since-
midnight and a day that wraps would break `advanceTime`'s comparison. The time
formatter must show `26:10` as `2:10 AM`.

**Sleep is a vote, because the world is shared.** One player cannot fast-forward
four people's day. The day rolls over when every *online* member is asleep.
Offline members do not hold the night open — otherwise one person going out for
the evening freezes the farm for everybody else.

**Collapsing costs money, not progress.** Stardew takes up to 10% of your gold,
capped, and wakes you at 6am with reduced energy. Copy it: lose
`min(coins * 0.1, 500)` from the shared wallet, wake with half energy. Never
destroy crops or items for it — punishing the hour with the farm's produce
teaches the wrong lesson and feels unfair in multiplayer, where the person who
stayed up is not the only one paying.

**Waking restores energy in full**, unless the day ended by collapse.

## State changes

```ts
// src/game/state/types.ts
interface PlayerState {
  // ...
  energy: number;      // current
  maxEnergy: number;   // upgradeable later, see spec 06
  asleep: boolean;     // already exists, and is currently dead — this uses it
}
```

`asleep` is already declared and nothing ever sets it. This spec is what it was
added for; if this spec is not built, delete the field.

`SAVE_VERSION` goes to 2. `migrate()` fills `energy: maxEnergy` and
`maxEnergy: 270` for players restored from a version 1 save.

## Reducer changes

`src/game/state/reducer.ts`:

- `createPlayer` seeds `energy` and `maxEnergy`.
- New intent `player/sleep` — a toggle, so a player who changed their mind can
  get up.
- `applyAct` deducts the action's cost after `applyFarmAction` reports
  `changed: true`. A refused action costs nothing.
- `applyTick` checks, after every clock step, whether every online member is
  asleep. If so, roll the day immediately rather than waiting for 02:00.
- `startNewDay` restores energy and clears `asleep`.
- New helper `collapse(state)` for the 02:00 path: charge the wallet, wake
  everyone at half energy.

`src/game/systems/farming.ts`:

- `FarmActionResult` gains `energyCost: number`.
- A table of costs beside `CROP_DEFINITIONS`, so the numbers sit with the rest
  of the tuning rather than in the reducer.

New events:

```ts
| { kind: 'sleepChanged'; playerId: PlayerId; asleep: boolean }
| { kind: 'exhausted'; playerId: PlayerId }
| { kind: 'collapsed'; coinsLost: number }
```

## Where you sleep

Add `interact: 'bed'` to the farmhouse prop in `maps/farm.json`, so walking up
to the house and acting puts you to bed. No new area is needed.

A cottage interior would be nicer and the area machinery already supports it,
but there is no interior art. Treat it as a later, separate change.

## Protocol

```ts
// src/game/net/protocol.ts
export type ClientCommand =
  // ...
  | { type: 'sleep' };
```

`parseClientCommand` accepts it with no fields. The server stamps the player, as
with everything else. There is nothing to validate beyond the type, because the
reducer decides whether the player is actually near a bed.

## Client

**Energy bar**, bottom-left of the canvas beside the toolbar, pinned with
`setScrollFactor(0)`. Colour shifts amber below a third, red below a tenth.

**Exhaustion**: on `exhausted`, tint the camera and halve the predicted movement
speed so it matches what the server is doing.

**Waiting for others**: when the local player is asleep and others are not, show
"Waiting for 2 farmhands to turn in" over a dimmed screen, with the names of who
is still up. Without this the player has no idea why nothing is happening, and
it is the most likely thing to feel broken in multiplayer.

**Day-end summary** on `dayStarted`: a panel showing coins earned, crops
harvested and what grew overnight, dismissed with any key. This is also where a
collapse is explained, because a silent loss of money reads as a bug.

## Multiplayer notes

- Movement speed is predicted client-side, so the exhausted speed must be
  derived from state both sides read, not a local flag.
- The sleep vote counts online members only. Re-check it when a player
  disconnects: the last person awake leaving should end the night, not hang it.
- A player who connects mid-night arrives awake and re-opens the vote. That is
  correct — they get a say in their own farm — but it means the "waiting for"
  list must be live, not computed once.

## Tests

Reducer:

- Tilling deducts energy; a refused till deducts none.
- Harvesting is free.
- Energy never goes below zero.
- The day rolls when the last online member sleeps, and not before.
- An offline member does not hold the night open.
- 02:00 with somebody awake collapses: wallet charged, everyone woken at half
  energy, crops untouched.
- Sleeping twice is idempotent; waking up re-opens the vote.
- New day restores full energy, and half after a collapse.

Persistence:

- A version 1 save loads with full energy and does not throw.
- A version 2 save round-trips energy exactly.

Server:

- A `sleep` command applies to the sender.
- A player disconnecting while others sleep ends the night.

## Out of scope

Food and energy restoration items, energy from sleeping in different beds,
skill-based energy reduction, and passing out from hunger. All of them want
spec 03's slot inventory first.
