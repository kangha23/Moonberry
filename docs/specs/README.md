# Specs

Seven pieces of work that take Moonberry from a farming machine that runs to a
game worth playing. Each spec is self-contained: goal, the decisions that are
not obvious, what changes where, and how to know it works.

## Why this order

The game today has a complete farming loop and no reason to care about it.
Nothing is scarce, so nothing is a decision; nothing accumulates, so no day
matters more than the last. Spec 01 fixes the first and Spec 06 the second.
Everything else is depth on top of those two.

| # | Spec | Depends on | Why it is here |
| --- | --- | --- | --- |
| 01 | [Energy and sleeping](01-energy-and-sleep.md) | — | Turns the loop into a game. Highest impact for the effort. |
| 02 | [Sound](02-sound.md) | — | Cheapest feel per hour spent. Independent of everything. |
| 03 | [Inventory slots](03-inventory-slots.md) | — | Structural. Blocks 04, 06, 07. |
| 04 | [Seasons and crops](04-seasons-and-crops.md) | 03 | Gives the calendar meaning and planning a horizon. |
| 05 | [One HUD, and the mouse](05-hud-and-mouse.md) | 03 | Fixes what is wrong today, not only what is missing. |
| 06 | [Tools and buildings](06-tools-and-buildings.md) | 03 | The ratchet: each day ends more capable than it began. |
| 07 | [NPCs worth visiting](07-npc-relationships.md) | 03 | The reason to stay once the farm runs itself. |

01 and 02 can be done in either order, in parallel, and before anything else.
03 should come before 04–07 or each of them will build a different workaround
for the same missing thing.

## Rules that apply to every spec

**Changing `FarmState` means changing the save format.** Bump `SAVE_VERSION` in
`src/game/state/persistence.ts`, add a branch to `migrate()` that upgrades the
previous version, extend `parseFarm` to validate the new fields, and add a test
that a save written by the old version still loads. A save that cannot be
migrated is refused, never guessed at.

**The reducer stays pure.** No `Date.now()`, no randomness that is not derived
from state, no I/O, no Phaser, no DOM. If a rule needs the time, it arrives as
part of an intent. This is what lets the same code run on the server and in an
offline browser, and what makes all of it testable.

**The client proposes, the server decides.** Anything new a client can ask for
goes through `ClientCommand` in `src/game/net/protocol.ts` and is validated in
`parseClientCommand`. Two things a client must never be able to state: which
player it is, and how much time has passed. Anything that is checked on the
client for responsiveness must be checked again on the server for truth.

**Presentation reacts to events.** The reducer emits `GameEvent`s; sprites,
sounds and messages are the renderer's business. Do not reach into the store
from the scene to detect that something happened — emit an event for it.

**Feel is shown, not narrated.** Prefer an animation, a sound, or a particle
over a line of prose in the prompt bar. The prompt is a fallback, not the
channel.
