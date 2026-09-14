# Moonberry Farmstead

A cozy farming RPG built with React 19, Vite, TypeScript, and Phaser 4.

> **Status: playable persistent multiplayer.** Up to four players share a world
> that survives a server restart, reached by an invite code. Without a server
> configured the game falls back to an offline world saved in the browser.

## What plays today

- Two Tiled-authored areas — a 40x30 farm and a village — joined by a doorway,
  with the camera following the player rather than one fixed screen.
- Complete farming loop: till, plant, water, grow overnight, harvest, sell.
- Deterministic time, day transitions, weather, and seasons.
- Inventory with seeds, crop stacks, water charges, and coins.
- Rowan's first-harvest quest and reward interaction.
- Hand-drawn LPC/CC0 art with procedural pixel-art textures as fallback.
- Autosave to the browser, restored on reload, with a "start a new farm" reset.
- Up to four players in one world: shared clock, plots, quest, and wallet, with
  each player carrying their own satchel. Players are drawn only on the map they
  are standing on.
- Farming on the farm, selling and Rowan's quest in the village.
- Worlds stored in SQLite and reached by a six-character invite code. Your
  satchel and your spot are still there when you come back.

## Controls

| Action | Input |
| --- | --- |
| Move | WASD or arrow keys |
| Select tools | 1 Hoe, 2 Seeds, 3 Watering Can, 4 Harvest Basket, 5 Inspect |
| Change seed | Q |
| Use selected tool / talk | Space or Enter |

## Local development

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal (default `http://localhost:5173`).
That alone gives an offline farm saved in the browser.

To play together, run the game server too, in a second terminal:

```sh
cd server
npm install
npm run dev
```

Then point the client at it by copying `.env.example` to `.env.local`:

```sh
VITE_GAME_SERVER=ws://localhost:2567
```

Opening the client creates a world and puts its invite code in the address bar,
as `?farm=CODE`. Send that link to somebody, or have them enter the code, and
you are farmhands on the same land. With no `VITE_GAME_SERVER`, or when the
server cannot be reached, the client says so and plays offline instead.

The server writes to `server/data/moonberry.sqlite` by default; set
`DATABASE_FILE` to move it.

## Quality gates

```sh
npm run lint
npm run test
npm run build
npm run test:e2e      # requires: npm run test:e2e:install
npm run quality:fast  # lint + test + build
```

`npm install` wires a husky pre-commit hook that runs `lint-staged` (ESLint on
staged JS/TS files).

## Project layout

| Path | Contents |
| --- | --- |
| `src/game/systems/` | Pure, deterministic game rules — farming, time, quest, satchel. Unit-tested, no Phaser or DOM dependency. |
| `maps/` | Tiled map sources. Open these in Tiled to edit the world. |
| `src/game/world/` | The Tiled parser, the parsed areas, collision, and interaction geometry. Pure functions, no Phaser. |
| `src/game/state/` | `FarmState`, the intent/event protocol, the reducer over both, the store, and save/load. |
| `src/game/net/` | The wire protocol and the browser side of the connection. |
| `server/` | The authoritative game server and its database. Its own package, because it deploys separately from the static client. |
| `src/game/scenes/FarmScene.ts` | Phaser scene: rendering and input only. Owns no game state. |
| `src/game/assets/` | Procedurally generated pixel-art textures used when image files are missing. |
| `src/components/`, `src/App.tsx` | React shell and HUD, fed by a `farm-snapshot` window event. |
| `public/assets/lpc/` | Hand-drawn art. **Not MIT** — see `public/assets/lpc/CREDITS.md`. |
| `public/assets/override/` | Optional local art overrides. PNG/JPG here are gitignored on purpose. |

## Architecture notes

All farm state lives in a single serializable `FarmState`, changed only by the
pure reducer in `src/game/state/reducer.ts`. Clients send `Intent`s; the reducer
validates them and returns the next state plus the `GameEvent`s the renderer
reacts to. Nothing in `src/game/state/` or `src/game/world/` imports Phaser,
React, or the DOM, so the same reducer is what will run on the server.

`dispatch` in `src/game/state/store.ts` is the single seam multiplayer replaces:
today it reduces locally, later it sends the intent to the server and applies
the authoritative state that comes back.

The multiplayer model is already encoded in the state shape:

- **Coins are the farm's shared wallet.** Seeds, crops, and water are a
  per-player satchel.
- **Quest progress is farm-wide** — one player can harvest, another can claim.
- **Four player seats**, each with its own spawn point and avatar.
- **The clock is a `world/tick` intent**, so one authority drives time for
  everyone rather than each client counting frames.

### Maps

The world is authored in [Tiled](https://www.mapeditor.org/). `maps/*.json` are
real Tiled maps: open `maps/farm.json` and edit it like any other.

The tileset is an *image collection*, so every tile keeps its own PNG and there
is no atlas to pack or keep in sync with the art.

What the map says, the game does:

| In Tiled | In game |
| --- | --- |
| A `ground` tile layer | The terrain, and which cells are farmable (`kind: plot`) or solid (`kind: water`) |
| An object of type `prop` | A house, tree, stall, or NPC, sized by its rectangle, blocking if `solid` |
| A prop with an `interact` property | Something acting on it does: `rowan` or `market` |
| An object of type `portal` | A doorway, carrying `toArea` and the landing tile |
| An object of type `spawn` | Where a player starts |
| The map's `displayName` property | The name shown in the HUD |

So moving the market stall in Tiled moves where crops can be sold; no code
changes.

After editing, regenerate the runtime data:

```sh
npm run maps:build
```

That writes `src/game/world/maps.generated.ts`. The indirection exists because
the client, the server, and the tests all need identical map data, and a plain
TypeScript module is the only format all three runtimes import the same way —
Node ESM needs import attributes for JSON, Vite does not.

`npm run maps:seed` rewrites the starter maps from scratch. It overwrites
anything you have edited, so it is not part of any build.

### The server

`server/` runs the same `applyIntent` reducer as the client and is the only
authority over the farm. Two things a client is never allowed to state are
absent from the wire protocol by construction rather than by validation:

- **Its player id.** Commands carry no id; the server stamps each one with the
  connection it arrived on, so a client cannot act as somebody else.
- **Its timestep.** Movement is sent as a direction, and the server advances it
  on the server's own clock, so a modified client cannot walk faster by
  claiming a larger delta.

Everything else arriving from a client is validated in
`src/game/net/protocol.ts` and dropped silently if it does not parse.

Traffic is split by how often it changes: positions go out every tick, a
compact clock frame when only the time moved, and the whole farm only when
something else changed. Because the reducer is immutable, "did the world
change?" is an object-identity check rather than a guess.

Colyseus was the original plan and was dropped after trying it: its value is
`@colyseus/schema` delta sync, which a pure plain-JSON reducer cannot use
without giving up the purity that lets the same code run on both sides — and
its current server line has no matching published JavaScript client. The server
now uses `ws` directly.

### Worlds, and who owns a place in one

A world is stored in SQLite through Node's built-in driver: no service to run,
no native module to build. `server/src/db.ts` is deliberately small so moving to
Postgres later means writing one more class, not rewriting the server.

A world lives in memory only while somebody is in it. It is read on the first
arrival and written as it changes, so a restart costs seconds rather than the
farm. Because SQLite runs with write-ahead logging, even an abrupt kill leaves
the last write recoverable.

Membership outlives a session. Leaving marks a player away rather than deleting
them: their satchel, their spot, and their place in the four stay theirs, and a
returning member gets in even when the world is full. Only newcomers can be
turned away.

A save the validator rejects is refused rather than replaced. Serving a fresh
farm under an existing invite code would quietly destroy whatever went wrong,
so the row is left on disk to be looked at.

### What the player token is, and is not

Each browser holds a long random token the server issues once and recognises
afterwards. That is what makes your farm yours when you come back.

**It is not authentication.** There is no password and nothing to verify the
token against, so:

- Anyone who obtains the token *is* that player.
- Clearing site data loses the identity, with no recovery.
- One token means one browser; there is no way to sign in elsewhere.

The database stores a SHA-256 hash rather than the token, so a leaked dump does
not hand out working identities — but that is the limit of the protection.
Real accounts (passwords, sessions, recovery, rate limiting) are a separate
piece of work, and pretending the token is one would be worse than saying
plainly that it is not.

### Saves

`src/game/state/persistence.ts` serializes `FarmState` behind a `SaveStorage`
adapter (localStorage today, a database later) with a schema version and a
migration hook. A save is treated as untrusted input: every field is validated
on load, and anything unexpected discards the save and starts a fresh farm
rather than booting a half-valid one. Storage is allowed to fail — a blocked or
full store degrades to "no save" instead of throwing into the render loop.

## Roadmap

1. ~~**State extraction** — move game state out of `FarmScene` into a serializable store.~~ Done.
2. ~~**Save/load** — persist that store.~~ Done.
3. ~~**Authoritative server** — shared clock, server-arbitrated actions, player sync.~~ Done.
4. ~~**Real maps** — Tiled tilemaps, camera follow, collision, multiple areas.~~ Done.
5. ~~**Persistence and invites** — database-backed worlds surviving a restart, invite codes.~~ Done.

Next, roughly in order of what the game needs most:

6. **Real accounts** — passwords or a third-party sign-in, so an identity is not
   tied to one browser. See the note on the player token above.
7. **More to do** — more crops, tools, buildings, NPCs, and seasons that matter.
8. **Movement that holds up over the internet** — the local player is predicted
   and corrected past a drift threshold, which is fine on a LAN and visibly
   rubbery on a slow link.

## Assets

```sh
npm run generate:assets
```

Recreates the deterministic SVG support assets in `public/assets/pixel/`.

## Deployment

Production is deployed on Vercel from `vercel.json` (Vite static output):

https://stardew-valley-clone-five.vercel.app

## License

Code is MIT (see `LICENSE`). Artwork under `public/assets/lpc/` keeps its own
licenses — read `public/assets/lpc/CREDITS.md` before redistributing.
