/**
 * Putting a herd on the farm without earning one, for looking at it.
 *
 * A chicken costs a silo, a coop, three days and 5100g. That is the right
 * price for a player and the wrong price for somebody who has changed how a
 * cow walks and wants to see a cow walk. This is the shortcut, and it is a
 * URL rather than a console command on purpose: Chrome refuses a first paste
 * into the console until you type `allow pasting` at it, which is a good rule
 * that makes a bad development loop.
 *
 *     http://localhost:5173/?dev=herd      one of each, out on the grass
 *     http://localhost:5173/?dev=noherd    take them away again
 *
 * Only ever called behind `import.meta.env.DEV`, so the whole module drops out
 * of a production build.
 *
 * Everything it writes has a `dev-` id, which is what makes it reversible: the
 * remover is a prefix filter, and nothing a real player bought can match it.
 */
import { capacityOf } from '../systems/animals';
import { buildingDef } from '../systems/buildings';
import { TILE_SIZE, spawnPoints } from '../world/areas';
import type { Animal } from '../systems/animals';
import type { Building } from '../systems/buildings';
import type { FarmState } from '../state/types';

/** The mark on everything this file adds. Also the whole of the undo. */
const DEV_PREFIX = 'dev-';

/** One of each, which is the point — they are here to be compared. */
const HERD = [
  { kind: 'chicken', house: 'coop' },
  { kind: 'duck', house: 'coop' },
  { kind: 'cow', house: 'barn' },
  { kind: 'goat', house: 'barn' },
] as const;

/** Where to put the houses, when there is no player to put them beside. */
function anchor(farm: FarmState): { x: number; y: number } {
  const player = Object.values(farm.players)[0];
  if (player && player.area === 'farm') return { x: player.x, y: player.y };
  const spawn = spawnPoints()[0];
  return spawn ?? { x: 10 * TILE_SIZE, y: 10 * TILE_SIZE };
}

/** Everything without a `dev-` id, which is everything a player owns. */
function withoutDev(farm: FarmState): FarmState {
  return {
    ...farm,
    buildings: farm.buildings.filter((building) => !building.id.startsWith(DEV_PREFIX)),
    animals: farm.animals.filter((animal) => !animal.id.startsWith(DEV_PREFIX)),
  };
}

/**
 * A farm with a coop, a barn and four animals standing outside them.
 *
 * The four conditions `isOutdoorTime` checks are all set here, because getting
 * three of the four right is a farm that looks exactly like a broken one: the
 * herd is indoors, indoors is drawn as absent, and the screen is empty with
 * nothing to say why. So: the houses are finished, their doors are open, the
 * sky is clear and the clock is in the afternoon.
 *
 * Positions are set too. Left null the animals would walk out of their own
 * accord — on the next clock step, 1.2 seconds later, which is long enough to
 * decide the thing did not work and reload.
 */
export function seedHerd(farm: FarmState): FarmState {
  const base = withoutDev(farm);
  const at = anchor(farm);
  const tileX = Math.round(at.x / TILE_SIZE);
  const tileY = Math.round(at.y / TILE_SIZE);

  const houses: Building[] = [
    {
      id: `${DEV_PREFIX}coop`,
      kind: 'coop',
      x: tileX - 5,
      y: tileY - 5,
      // Null is "finished": see the note on `Building.readyOnDay`.
      readyOnDay: null,
      doorOpen: true,
    },
    {
      id: `${DEV_PREFIX}barn`,
      kind: 'barn',
      x: tileX + 2,
      y: tileY - 5,
      readyOnDay: null,
      doorOpen: true,
    },
  ];

  const animals: Animal[] = HERD.map((entry, index) => ({
    id: `${DEV_PREFIX}${entry.kind}`,
    kind: entry.kind,
    name: entry.kind,
    home: `${DEV_PREFIX}${entry.house}`,
    bornOnDay: farm.time.day,
    affection: 500,
    pettedToday: false,
    // Fed, so the hunger marker is not over every one of them in every
    // screenshot taken of the thing being looked at.
    fedToday: true,
    outsideToday: true,
    // Far enough out that nothing is waiting to be collected and the morning
    // summary stays quiet.
    produceOnDay: farm.time.day + 9999,
    position: { x: at.x - 120 + index * 70, y: at.y - 70 },
  }));

  const daytime = farm.time.hour >= 8 && farm.time.hour < 17;
  const time = daytime ? farm.time : { ...farm.time, hour: 11, minute: 0, totalMinutes: 11 * 60 };
  const wet = farm.weather === 'Drizzle' || farm.weather === 'Firefly Shower';

  return {
    ...base,
    revision: base.revision + 1,
    time,
    weather: wet ? 'Sunny' : farm.weather,
    buildings: [...base.buildings, ...houses],
    animals: [...base.animals, ...animals],
  };
}

/**
 * Applies whatever `?dev=` asked for, or hands the farm straight back.
 *
 * `search` is passed in rather than read off `location`, so the decision this
 * makes is testable without a browser — which is the same reason `hudLayout`
 * takes two numbers instead of measuring the canvas.
 */
export function applyDevSeed(farm: FarmState, search: string): FarmState {
  const asked = new URLSearchParams(search).get('dev');
  if (asked === 'herd') return seedHerd(farm);
  if (asked === 'noherd') return withoutDev(farm);
  return farm;
}

/**
 * What to tell the player about it, or null when nothing was done.
 *
 * Shown in the prompt bar, because a farm that silently gained a barn is a
 * farm you have to go and look at to know the flag worked.
 */
export function devSeedMessage(search: string): string | null {
  const asked = new URLSearchParams(search).get('dev');
  if (asked === 'herd') {
    const coop = capacityOf('coop');
    const barn = capacityOf('barn');
    return `Dev: thả ${HERD.length} con ra nông trại, kèm ${buildingDef('coop').label} (${coop} chỗ) và ${buildingDef('barn').label} (${barn} chỗ). Bỏ đi bằng ?dev=noherd.`;
  }
  if (asked === 'noherd') return 'Dev: đã dọn hết chuồng và thú thêm bằng ?dev=herd.';
  return null;
}
