import { describe, expect, it } from 'vitest';
import {
  BUILDING_AREA,
  BUILDING_DEFS,
  BUILDING_KINDS,
  buildingAt,
  buildingsOn,
  checkPlacement,
  isComplete,
  nextBuildingId,
  solidRects,
  type Building,
  type BuildingKind,
} from './buildings';
import { createPlot, type PlotState } from './farming';
import { TILE_SIZE, areaMap, isWalkable, plotKey, plotTiles, tileAt } from '../world/areas';

const MAP = areaMap(BUILDING_AREA);

/** A fresh set of plots, exactly as the reducer seeds them. */
function emptyPlots(): Record<string, PlotState> {
  const plots: Record<string, PlotState> = {};
  for (const tile of plotTiles(BUILDING_AREA)) {
    plots[plotKey(BUILDING_AREA, tile.x, tile.y)] = createPlot(tile.x, tile.y);
  }
  return plots;
}

/**
 * The first spot on the farm a building of this kind would actually be
 * allowed. Searched rather than written down, so redrawing the farm in Tiled
 * does not silently turn these tests into tests of an empty rectangle.
 */
function clearSpot(kind: BuildingKind, buildings: readonly Building[] = []): { x: number; y: number } {
  const plots = emptyPlots();
  for (let y = 0; y < MAP.height; y += 1) {
    for (let x = 0; x < MAP.width; x += 1) {
      if (checkPlacement(BUILDING_AREA, buildings, plots, kind, x, y).ok) return { x, y };
    }
  }
  throw new Error(`Nowhere on the farm will take a ${kind}.`);
}

function firstTileOfKind(kind: string): { x: number; y: number } {
  for (let y = 0; y < MAP.height; y += 1) {
    for (let x = 0; x < MAP.width; x += 1) {
      if (tileAt(BUILDING_AREA, x, y)?.kind === kind) return { x, y };
    }
  }
  throw new Error(`No "${kind}" tile on the farm.`);
}

/** The middle of a tile, in world pixels, which is where a walker stands. */
function centreOf(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

describe('the building catalogue', () => {
  it('prices and sizes every kind, and leads with the one worth building first', () => {
    for (const kind of BUILDING_KINDS) {
      const def = BUILDING_DEFS[kind];
      expect(def.width).toBeGreaterThan(0);
      expect(def.height).toBeGreaterThan(0);
      expect(def.cost).toBeGreaterThan(0);
      expect(def.days).toBeGreaterThan(0);
    }
    // The shed answers a problem the player already has, so it is the cheapest
    // and it is first in the list the panel draws.
    expect(BUILDING_KINDS[0]).toBe('shed');
  });

  it('hands out a fresh id rather than reusing one', () => {
    expect(nextBuildingId([])).toBe('b1');
    const one: Building = { id: 'b1', kind: 'shed', x: 0, y: 0, readyOnDay: null , doorOpen: false };
    expect(nextBuildingId([one])).toBe('b2');
    // Taken from the highest rather than the count, so a gap cannot collide.
    const three: Building = { id: 'b3', kind: 'silo', x: 0, y: 0, readyOnDay: null , doorOpen: false };
    expect(nextBuildingId([one, three])).toBe('b4');
  });
});

describe('where a building may go', () => {
  it('accepts clear ground on the farm', () => {
    const spot = clearSpot('shed');
    expect(checkPlacement(BUILDING_AREA, [], emptyPlots(), 'shed', spot.x, spot.y)).toEqual({ ok: true });
  });

  it('refuses a footprint that runs off the edge of the map', () => {
    const def = BUILDING_DEFS.shed;
    const spot = clearSpot('shed');
    const result = checkPlacement(BUILDING_AREA, [], emptyPlots(), 'shed', MAP.width - def.width + 1, spot.y);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/rìa nông trại/i);
  });

  it('refuses a footprint that touches the pond', () => {
    const water = firstTileOfKind('water');
    const result = checkPlacement(BUILDING_AREA, [], emptyPlots(), 'shed', water.x, water.y);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/mặt ao/i);
  });

  it('refuses a footprint that overlaps a prop', () => {
    const prop = MAP.props[0];
    const tileX = Math.floor(prop.x / TILE_SIZE);
    const tileY = Math.floor(prop.y / TILE_SIZE);
    const result = checkPlacement(BUILDING_AREA, [], emptyPlots(), 'shed', tileX, tileY);

    expect(result.ok).toBe(false);
    // Either the prop's own rectangle or the ground under it; both are refusals
    // and both name something in the way.
    expect(result.ok === false && result.reason).toMatch(/chắn (ngang|chỗ)/i);
  });

  it('refuses a footprint that overlaps another building', () => {
    const spot = clearSpot('shed');
    const standing: Building[] = [{ id: 'b1', kind: 'shed', x: spot.x, y: spot.y, readyOnDay: null , doorOpen: false }];
    const result = checkPlacement(BUILDING_AREA, standing, emptyPlots(), 'shed', spot.x, spot.y);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/đã có công trình/i);
  });

  it('refuses a footprint over a planted crop, and allows the same spot once it is lifted', () => {
    const tile = plotTiles(BUILDING_AREA)[0];
    const key = plotKey(BUILDING_AREA, tile.x, tile.y);
    const plots = emptyPlots();
    const planted = { ...plots, [key]: { ...plots[key], stage: 'seeded' as const, crop: 'turnip' as const } };

    const refused = checkPlacement(BUILDING_AREA, [], planted, 'shed', tile.x, tile.y);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.reason).toMatch(/đang có cây trồng/i);

    // Bare worked soil is not a crop. Building over a tilled plot is allowed.
    const tilled = { ...plots, [key]: { ...plots[key], stage: 'tilled' as const } };
    expect(checkPlacement(BUILDING_AREA, [], tilled, 'shed', tile.x, tile.y).ok).toBe(true);
  });

  it('refuses any spot at all on a map that is not the farm', () => {
    const spot = clearSpot('shed');
    const result = checkPlacement('village', [], emptyPlots(), 'shed', spot.x, spot.y);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/trên nông trại/i);
  });
});

describe('buildings and collision', () => {
  it('reports a finished building as solid, and a scaffold exactly as solid', () => {
    const spot = clearSpot('shed');
    const finished: Building = { id: 'b1', kind: 'shed', x: spot.x, y: spot.y, readyOnDay: null , doorOpen: false };
    const scaffold: Building = { ...finished, id: 'b2', readyOnDay: 9 };

    const middle = centreOf(spot.x + 1, spot.y + 1);

    // The map on its own still says this is walkable: it is grass, and nothing
    // in `maps/*.json` knows a shed went up here.
    expect(isWalkable(BUILDING_AREA, middle.x, middle.y)).toBe(true);

    expect(isWalkable(BUILDING_AREA, middle.x, middle.y, { buildings: solidRects([finished]), nodes: [], placeables: [] })).toBe(false);
    expect(isWalkable(BUILDING_AREA, middle.x, middle.y, { buildings: solidRects([scaffold]), nodes: [], placeables: [] })).toBe(false);
    expect(isComplete(finished)).toBe(true);
    expect(isComplete(scaffold)).toBe(false);
  });

  it('leaves the tile past the footprint walkable', () => {
    const spot = clearSpot('shed');
    const def = BUILDING_DEFS.shed;
    const building: Building = { id: 'b1', kind: 'shed', x: spot.x, y: spot.y, readyOnDay: null , doorOpen: false };
    const beyond = centreOf(spot.x + def.width, spot.y);

    expect(isWalkable(BUILDING_AREA, beyond.x, beyond.y, { buildings: solidRects([building]), nodes: [], placeables: [] })).toBe(
      isWalkable(BUILDING_AREA, beyond.x, beyond.y),
    );
  });

  it('finds the building standing on a tile, and nothing on a tile past it', () => {
    const spot = clearSpot('shed');
    const def = BUILDING_DEFS.shed;
    const building: Building = { id: 'b1', kind: 'shed', x: spot.x, y: spot.y, readyOnDay: null , doorOpen: false };

    expect(buildingAt([building], spot.x, spot.y)).toBe(building);
    expect(buildingAt([building], spot.x + def.width - 1, spot.y + def.height - 1)).toBe(building);
    expect(buildingAt([building], spot.x + def.width, spot.y)).toBeNull();
  });

  it('puts no buildings on any map but the farm', () => {
    const building: Building = { id: 'b1', kind: 'shed', x: 0, y: 0, readyOnDay: null , doorOpen: false };

    expect(buildingsOn([building], BUILDING_AREA)).toHaveLength(1);
    expect(buildingsOn([building], 'village')).toHaveLength(0);
    // The same array every time, so a caller comparing by identity — the scene
    // does, every frame — is not handed a new one to redraw.
    expect(buildingsOn([building], 'village')).toBe(buildingsOn([], 'village'));
  });
});
