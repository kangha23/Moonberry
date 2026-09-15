import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../state/intents';
import { ACTION_ENERGY_COST, type FarmAction } from '../systems/farming';
import { createTimeState } from '../systems/time';
import { AREA_IDS, AREAS, type AreaId } from '../world/areas';
import {
  DEFAULT_MUSIC,
  EVENT_SOUNDS,
  NIGHT_FROM_HOUR,
  NIGHT_MUSIC,
  PLOT_ACTION_SOUNDS,
  RAIN_MUSIC,
  SILENT_EVENTS,
  SOUND_IDS,
  allMusic,
  areaMusic,
  footstepFor,
  isLocalOnly,
  musicFor,
  musicUrls,
  soundForEvent,
  soundUrls,
  type SoundId,
} from './soundtrack';

/**
 * Every event kind, written out.
 *
 * The assertion below makes TypeScript check this list against the union, so
 * adding a `GameEvent` that nobody listed is a compile error here before it
 * is a missing sound in the game.
 */
const EVENT_KINDS = [
  'message',
  'plotChanged',
  'harvested',
  'sold',
  'questRewarded',
  'dayStarted',
  'cropsWithered',
  'npcSpoke',
  'giftGiven',
  'panelChanged',
  'upgradeOrdered',
  'upgradeReady',
  'upgradeCollected',
  'buildingPlaced',
  'buildingFinished',
  'bought',
  'sleepChanged',
  'exhausted',
  'collapsed',
  'playerJoined',
  'playerLeft',
  'areaChanged',
  'farmReplaced',
  'animalPetted',
  'produceCollected',
  'animalBought',
  'animalSold',
  'animalFed',
  'hayBought',
  'doorToggled',
  'animalsHungry',
  'nodeHit',
  'nodeCleared',
  'toolTooWeak',
  'nodesGrew',
  'crafted',
  'itemPlaced',
  'itemPickedUp',
  'machineLoaded',
  'machineReady',
  'machineCollected',
  'recipeLearned',
  'sprinklersRan',
  'cast',
  'bite',
  'fishCaught',
  'fishEscaped',
] as const satisfies readonly GameEvent['kind'][];

/** True only when the two unions have exactly the same members. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const EVERY_KIND_LISTED: Exact<(typeof EVENT_KINDS)[number], GameEvent['kind']> = true;

describe('the event-to-sound table', () => {
  it('lists every event kind the reducer can emit', () => {
    // Reading the constant is what makes the compile-time check above load.
    expect(EVERY_KIND_LISTED).toBe(true);
    expect(new Set(EVENT_KINDS).size).toBe(EVENT_KINDS.length);
  });

  it('gives every event kind either a sound or a written reason to be silent', () => {
    for (const kind of EVENT_KINDS) {
      const heard = EVENT_SOUNDS[kind] !== undefined || kind === 'plotChanged';
      const silent = SILENT_EVENTS[kind] !== undefined;
      expect(
        heard || silent,
        `"${kind}" has no sound and no entry in SILENT_EVENTS saying why not`,
      ).toBe(true);
      // Both would mean the table disagrees with itself about the same event.
      expect(heard && silent, `"${kind}" is listed as both audible and silent`).toBe(false);
    }
  });

  it('only names sounds that exist', () => {
    const known = new Set<string>(SOUND_IDS);
    for (const id of Object.values(EVENT_SOUNDS)) expect(known).toContain(id);
    for (const id of Object.values(PLOT_ACTION_SOUNDS)) expect(known).toContain(id);
  });

  it('gives every sound id somewhere to load from', () => {
    for (const id of SOUND_IDS) {
      const urls = soundUrls(id);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect(url.startsWith('/assets/audio/')).toBe(true);
    }
    expect(new Set(SOUND_IDS).size).toBe(SOUND_IDS.length);
  });
});

describe('plotChanged, which is four different actions wearing one event', () => {
  it('picks the sound off the action rather than off the acting player', () => {
    const actions = Object.keys(ACTION_ENERGY_COST) as FarmAction[];
    for (const action of actions) {
      expect(soundForEvent({ kind: 'plotChanged', key: 'farm:3,4', action })).toBe(
        PLOT_ACTION_SOUNDS[action],
      );
    }
  });

  it('distinguishes the three acting verbs, so they do not all thunk alike', () => {
    const heard = new Set<SoundId>([
      PLOT_ACTION_SOUNDS.till,
      PLOT_ACTION_SOUNDS.plant,
      PLOT_ACTION_SOUNDS.water,
    ]);
    expect(heard.size).toBe(3);
  });

  it('stays silent for the overnight roll-over, which nobody swung at', () => {
    // Every plot in the world emits one of these in a single frame at 6am.
    expect(soundForEvent({ kind: 'plotChanged', key: 'farm:3,4' })).toBeNull();
  });
});

describe('which events are heard, and by whom', () => {
  it('maps the events the spec names', () => {
    expect(soundForEvent({ kind: 'harvested', playerId: 'a', crop: 'turnip' })).toBe('crop-pop');
    expect(soundForEvent({ kind: 'sold', playerId: 'a', coins: 30, count: 2 })).toBe('coins');
    expect(soundForEvent({ kind: 'questRewarded', playerId: 'a', coins: 80 })).toBe('fanfare');
    expect(soundForEvent({ kind: 'dayStarted', day: 2, grown: 3 })).toBe('rooster');
    expect(soundForEvent({ kind: 'playerJoined', playerId: 'a' })).toBe('chime');
    expect(soundForEvent({ kind: 'areaChanged', playerId: 'a', area: 'village' })).toBe('footstep-path');
  });

  it('says nothing for the kinds deliberately left silent', () => {
    expect(soundForEvent({ kind: 'message', playerId: 'a', text: 'hello' })).toBeNull();
    expect(soundForEvent({ kind: 'playerLeft', playerId: 'a' })).toBeNull();
    expect(soundForEvent({ kind: 'farmReplaced' })).toBeNull();
  });

  it('keeps somebody else’s doorway and exhaustion out of your ears', () => {
    expect(isLocalOnly({ kind: 'areaChanged', playerId: 'a', area: 'village' })).toBe(true);
    expect(isLocalOnly({ kind: 'exhausted', playerId: 'a' })).toBe(true);
    expect(isLocalOnly({ kind: 'harvested', playerId: 'a', crop: 'turnip' })).toBe(true);
  });

  it('still lets the shared farm be heard by everyone on it', () => {
    // Coins are the farm's wallet and a new arrival is the point of a shared
    // farm; filtering these to the local player would make the world lonely.
    expect(isLocalOnly({ kind: 'sold', playerId: 'a', coins: 30, count: 2 })).toBe(false);
    expect(isLocalOnly({ kind: 'playerJoined', playerId: 'a' })).toBe(false);
    expect(isLocalOnly({ kind: 'dayStarted', day: 2, grown: 1 })).toBe(false);
  });
});

describe('which bed plays', () => {
  const noon = createTimeState(1, 12 * 60);
  const evening = createTimeState(1, NIGHT_FROM_HOUR * 60 + 30);
  const smallHours = createTimeState(1, 25 * 60);

  it('takes the area track from the map, the way displayName already works', () => {
    expect(musicFor({ area: 'farm', weather: 'Sunny', time: noon })).toBe('day-farm-loop');
    expect(musicFor({ area: 'village', weather: 'Sunny', time: noon })).toBe('day-village-loop');
    expect(AREAS.farm.music).toBe('day-farm-loop');
  });

  it('falls back when a map names no track of its own', () => {
    const unnamed = { ...AREAS.farm, music: null };
    const original = AREAS.farm;
    try {
      (AREAS as Record<AreaId, typeof unnamed>).farm = unnamed;
      expect(areaMusic('farm')).toBe(DEFAULT_MUSIC);
    } finally {
      (AREAS as Record<AreaId, typeof original>).farm = original;
    }
  });

  it('goes quiet after 20:00 and stays there past midnight', () => {
    expect(musicFor({ area: 'farm', weather: 'Sunny', time: evening })).toBe(NIGHT_MUSIC);
    expect(musicFor({ area: 'farm', weather: 'Sunny', time: smallHours })).toBe(NIGHT_MUSIC);
    // 26:00 is stored as a running total but reads as 2am, and 2am is night.
    expect(smallHours.hour).toBe(1);
  });

  it('lets the rain win, because that is what you are standing in', () => {
    expect(musicFor({ area: 'farm', weather: 'Drizzle', time: noon })).toBe(RAIN_MUSIC);
    expect(musicFor({ area: 'village', weather: 'Drizzle', time: evening })).toBe(RAIN_MUSIC);
    // Not every unusual sky is wet: a firefly shower is, a breeze is not.
    expect(musicFor({ area: 'farm', weather: 'Breezy', time: noon })).toBe('day-farm-loop');
    expect(musicFor({ area: 'farm', weather: 'Firefly Shower', time: noon })).toBe(RAIN_MUSIC);
  });

  it('can name every bed it might ever ask for, so they can all be preloaded', () => {
    const beds = allMusic(AREA_IDS);
    expect(beds).toContain(RAIN_MUSIC);
    expect(beds).toContain(NIGHT_MUSIC);
    for (const area of AREA_IDS) expect(beds).toContain(areaMusic(area));
    expect(new Set(beds).size).toBe(beds.length);
    for (const bed of beds) expect(musicUrls(bed)[0]).toBe(`/assets/audio/music/${bed}.wav`);
  });
});

describe('footsteps', () => {
  it('sounds different on a path than on grass', () => {
    expect(footstepFor('grass')).toBe('footstep-grass');
    expect(footstepFor('path')).toBe('footstep-path');
    expect(footstepFor('grass')).not.toBe(footstepFor('path'));
  });

  it('treats worked soil as the ground it was made from', () => {
    expect(footstepFor('plot')).toBe('footstep-grass');
  });

  it('has nothing to say about water or about no tile at all', () => {
    expect(footstepFor('water')).toBeNull();
    expect(footstepFor(undefined)).toBeNull();
  });
});
