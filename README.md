# Moonberry Farmstead

A cozy farming RPG built with React 19, Vite, TypeScript, and Phaser 4.

> **Status: single-player vertical slice.** One screen, one farm, no save/load.
> Multiplayer is the goal — see [Roadmap](#roadmap).

## What plays today

- Top-down farm exploration on a single 30x20 tile screen (WASD/arrow keys).
- Complete farming loop: till, plant, water, grow overnight, harvest, sell.
- Deterministic time, day transitions, weather, and seasons.
- Inventory with seeds, crop stacks, water charges, and coins.
- Rowan's first-harvest quest and reward interaction.
- Hand-drawn LPC/CC0 art with procedural pixel-art textures as fallback.

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
| `src/game/systems/` | Pure, deterministic game rules — farming, time, quest, inventory. Unit-tested, no Phaser or DOM dependency. |
| `src/game/scenes/FarmScene.ts` | Phaser scene: rendering, input, and (currently) all mutable game state. |
| `src/game/assets/` | Procedurally generated pixel-art textures used when image files are missing. |
| `src/components/`, `src/App.tsx` | React shell and HUD, fed by a `farm-snapshot` window event. |
| `public/assets/lpc/` | Hand-drawn art. **Not MIT** — see `public/assets/lpc/CREDITS.md`. |
| `public/assets/override/` | Optional local art overrides. PNG/JPG here are gitignored on purpose. |

## Architecture notes

`src/game/systems/` is deliberately free of Phaser and DOM references so the
same rules can later run on an authoritative server.

`FarmScene` currently owns all mutable state as private fields. Extracting that
into a serializable store is the prerequisite for both save/load and
multiplayer.

## Roadmap

1. **State extraction** — move game state out of `FarmScene` into a serializable store.
2. **Save/load** — persist that store.
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
