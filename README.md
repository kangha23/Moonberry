# Moonberry Farmstead

A cozy farming RPG built with React 19, Vite, TypeScript, and Phaser 4.

> **Status: single-player vertical slice.** One screen, one farm.
> Multiplayer is the goal — see [Roadmap](#roadmap).

## What plays today

- Top-down farm exploration on a single 30x20 tile screen (WASD/arrow keys).
- Complete farming loop: till, plant, water, grow overnight, harvest, sell.
- Deterministic time, day transitions, weather, and seasons.
- Inventory with seeds, crop stacks, water charges, and coins.
- Rowan's first-harvest quest and reward interaction.
- Hand-drawn LPC/CC0 art with procedural pixel-art textures as fallback.
- Autosave to the browser, restored on reload, with a "start a new farm" reset.

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
| `src/game/world/` | Map generation, collision, and interaction geometry. Pure functions, no Phaser. |
| `src/game/state/` | `FarmState`, the intent/event protocol, the reducer over both, the store, and save/load. |
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
3. **Real maps** — Tiled tilemaps, camera follow, collision, multiple areas.
4. **Authoritative server** — shared clock, server-arbitrated actions, player sync.
5. **Accounts and persistence** — database-backed farms, invite codes.

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
