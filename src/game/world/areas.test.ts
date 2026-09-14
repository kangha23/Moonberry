import { describe, expect, it } from 'vitest';
import {
  AREAS,
  START_AREA,
  TILE_SIZE,
  areaMap,
  interactableAt,
  isAreaId,
  isWalkable,
  plotKey,
  plotTiles,
  portalAt,
  propCentre,
  resolveMove,
  spawnPoints,
  targetTile,
  tileAt,
  type AreaId,
} from './areas';
import { parseTiledMap, type TiledMap, type TiledTileset } from './tiled';

const AREA_LIST = Object.keys(AREAS) as AreaId[];

describe('the shipped maps', () => {
  it('parses every area', () => {
    expect(AREA_LIST.length).toBeGreaterThan(1);
    for (const area of AREA_LIST) {
      const map = areaMap(area);
      expect(map.tiles).toHaveLength(map.width * map.height);
      expect(map.pixelWidth).toBe(map.width * TILE_SIZE);
      expect(map.name.length).toBeGreaterThan(0);
    }
  });

  it('gives the starting area room to scroll past one screen', () => {
    const map = areaMap(START_AREA);

    // The viewport is 960x640; a camera with nowhere to travel is not a camera.
    expect(map.pixelWidth).toBeGreaterThan(960);
    expect(map.pixelHeight).toBeGreaterThan(640);
  });

  it('puts farmable soil on the starting area and none in the village', () => {
    expect(plotTiles(START_AREA).length).toBeGreaterThan(0);
    expect(plotTiles('village')).toHaveLength(0);
  });

  it('spawns every player somewhere they can stand', () => {
    const spawns = spawnPoints();

    expect(spawns.length).toBeGreaterThanOrEqual(4);
    for (const spawn of spawns) {
      expect(isWalkable(START_AREA, spawn.x, spawn.y)).toBe(true);
    }
  });

  it('recognises only areas that exist', () => {
    expect(isAreaId(START_AREA)).toBe(true);
    expect(isAreaId('atlantis')).toBe(false);
    expect(isAreaId(7)).toBe(false);
  });
});

describe('portals', () => {
  it('links every portal to an area that exists', () => {
    for (const area of AREA_LIST) {
      for (const portal of areaMap(area).portals) {
        expect(isAreaId(portal.toArea)).toBe(true);
      }
    }
  });

  it('lands players somewhere walkable, and not straight back in a portal', () => {
    for (const area of AREA_LIST) {
      for (const portal of areaMap(area).portals) {
        const target = portal.toArea as AreaId;
        const landing = { x: portal.toX, y: portal.toY };

        expect(isWalkable(target, landing.x, landing.y)).toBe(true);
        // Landing inside the return portal would bounce the player forever.
        expect(portalAt(target, landing)).toBeNull();
      }
    }
  });

  it('reports a portal only where one actually is', () => {
    const map = areaMap(START_AREA);
    const portal = map.portals[0];

    expect(portalAt(START_AREA, { x: portal.x + 1, y: portal.y + 1 })).not.toBeNull();
    expect(portalAt(START_AREA, { x: portal.x - 200, y: portal.y })).toBeNull();
  });

  it('connects the farm and the village both ways', () => {
    const out = areaMap('farm').portals.find((portal) => portal.toArea === 'village');
    const back = areaMap('village').portals.find((portal) => portal.toArea === 'farm');

    expect(out).toBeDefined();
    expect(back).toBeDefined();
  });
});

describe('collision', () => {
  it('keeps players out of water', () => {
    const map = areaMap(START_AREA);
    let found = false;
    for (let y = 0; y < map.height && !found; y += 1) {
      for (let x = 0; x < map.width && !found; x += 1) {
        if (tileAt(START_AREA, x, y)?.kind !== 'water') continue;
        found = true;
        expect(isWalkable(START_AREA, x * TILE_SIZE + 16, y * TILE_SIZE + 16)).toBe(false);
      }
    }
    expect(found).toBe(true);
  });

  it('keeps players out of solid props', () => {
    for (const area of AREA_LIST) {
      for (const prop of areaMap(area).props) {
        if (!prop.solid) continue;
        const centre = propCentre(prop);
        expect(isWalkable(area, centre.x, centre.y)).toBe(false);
      }
    }
  });

  it('refuses positions outside the map', () => {
    const map = areaMap(START_AREA);

    expect(isWalkable(START_AREA, -1, 10)).toBe(false);
    expect(isWalkable(START_AREA, map.pixelWidth + 1, 10)).toBe(false);
  });

  it('slides along an obstacle instead of stopping dead', () => {
    // Stand just west of a solid prop, somewhere legal, and push east into it.
    // The blocked axis should hold while the free axis keeps moving.
    const spot = AREA_LIST.flatMap((area) =>
      areaMap(area).props
        .filter((prop) => prop.solid)
        .map((prop) => ({ area, x: prop.x - 2, y: prop.y + prop.height / 2 })),
    ).find((candidate) => isWalkable(candidate.area, candidate.x, candidate.y));

    // Asserted rather than skipped: a no-op test would quietly cover nothing.
    expect(spot, 'no walkable tile beside any solid prop').toBeDefined();

    const from = { x: spot!.x, y: spot!.y };
    const moved = resolveMove(spot!.area, from, 1, 1, 100);

    expect(moved.x).toBe(from.x);
    expect(moved.y).toBeGreaterThan(from.y);
  });

  it('never walks a player off the edge of the map', () => {
    const map = areaMap(START_AREA);
    const atEdge = { x: map.pixelWidth - 4, y: map.pixelHeight / 2 };

    const moved = resolveMove(START_AREA, atEdge, 1, 0, 1000);

    expect(moved.x).toBeLessThanOrEqual(map.pixelWidth);
  });

  it('stands still when there is no input', () => {
    const from = spawnPoints()[0];

    expect(resolveMove(START_AREA, from, 0, 0, 100)).toBe(from);
  });
});

describe('targeting', () => {
  it('picks the tile the player faces', () => {
    const point = { x: 10 * TILE_SIZE + 16, y: 10 * TILE_SIZE + 16 };

    expect(targetTile(START_AREA, point, 'up')).toEqual({ x: 10, y: 9 });
    expect(targetTile(START_AREA, point, 'down')).toEqual({ x: 10, y: 11 });
    expect(targetTile(START_AREA, point, 'left')).toEqual({ x: 9, y: 10 });
    expect(targetTile(START_AREA, point, 'right')).toEqual({ x: 11, y: 10 });
  });

  it('clamps at the edge rather than pointing off the map', () => {
    const corner = { x: 8, y: 8 };

    expect(targetTile(START_AREA, corner, 'up')).toEqual({ x: 0, y: 0 });
    expect(targetTile(START_AREA, corner, 'left')).toEqual({ x: 0, y: 0 });
  });
});

describe('interactive props', () => {
  it('finds Rowan and the market in the village, not on the farm', () => {
    const village = areaMap('village');
    const rowan = village.props.find((prop) => prop.interact === 'rowan');
    const market = village.props.find((prop) => prop.interact === 'market');

    expect(rowan).toBeDefined();
    expect(market).toBeDefined();
    expect(areaMap('farm').props.some((prop) => prop.interact)).toBe(false);
  });

  it('only reports a prop when the player is standing close to it', () => {
    const rowan = areaMap('village').props.find((prop) => prop.interact === 'rowan')!;
    const centre = propCentre(rowan);

    expect(interactableAt('village', { x: centre.x, y: centre.y + 20 })?.interact).toBe('rowan');
    expect(interactableAt('village', { x: centre.x + 400, y: centre.y })).toBeNull();
  });

  it('does not reach across areas', () => {
    const rowan = propCentre(areaMap('village').props.find((prop) => prop.interact === 'rowan')!);

    expect(interactableAt('farm', rowan)).toBeNull();
  });
});

describe('plot keys', () => {
  it('keeps identical coordinates in different areas apart', () => {
    expect(plotKey('farm', 9, 7)).not.toBe(plotKey('village', 9, 7));
  });
});

// --- the parser itself ------------------------------------------------------

const TINY_TILESET: TiledTileset = {
  tilecount: 2,
  tilewidth: 32,
  tileheight: 32,
  tiles: [
    {
      id: 0,
      image: 'grass.png',
      imagewidth: 32,
      imageheight: 32,
      properties: [
        { name: 'texture', type: 'string', value: 'g' },
        { name: 'kind', type: 'string', value: 'grass' },
        { name: 'solid', type: 'bool', value: false },
      ],
    },
    {
      id: 1,
      image: 'rock.png',
      imagewidth: 32,
      imageheight: 32,
      properties: [
        { name: 'texture', type: 'string', value: 'r' },
        { name: 'kind', type: 'string', value: 'water' },
        { name: 'solid', type: 'bool', value: true },
      ],
    },
  ],
};

function tinyMap(data: number[], width = 2, height = 2): TiledMap {
  return {
    width,
    height,
    tilewidth: 32,
    tileheight: 32,
    layers: [{ type: 'tilelayer', name: 'ground', width, height, data }],
  };
}

describe('parseTiledMap', () => {
  it('maps gids to tile definitions, with 0 meaning empty', () => {
    const map = parseTiledMap('tiny', tinyMap([1, 2, 0, 1]), TINY_TILESET);

    expect(map.tiles[0]?.texture).toBe('g');
    expect(map.tiles[1]?.solid).toBe(true);
    expect(map.tiles[2]).toBeNull();
  });

  it('refuses a map with no ground layer', () => {
    const broken: TiledMap = { width: 2, height: 2, tilewidth: 32, tileheight: 32, layers: [] };

    expect(() => parseTiledMap('broken', broken, TINY_TILESET)).toThrow(/ground/);
  });

  it('refuses a ground layer of the wrong size', () => {
    // A short data array would otherwise leave silent holes in the world.
    expect(() => parseTiledMap('short', tinyMap([1, 2, 3]), TINY_TILESET)).toThrow(/expected 4/);
  });

  it('falls back to the id when a map does not name itself', () => {
    expect(parseTiledMap('unnamed', tinyMap([1, 1, 1, 1]), TINY_TILESET).name).toBe('unnamed');
  });

  it('converts portal landing tiles into pixel centres', () => {
    const map: TiledMap = {
      ...tinyMap([1, 1, 1, 1]),
      layers: [
        ...tinyMap([1, 1, 1, 1]).layers,
        {
          type: 'objectgroup',
          name: 'portals',
          objects: [
            {
              id: 1,
              name: 'door',
              type: 'portal',
              x: 0,
              y: 0,
              width: 32,
              height: 32,
              properties: [
                { name: 'toArea', type: 'string', value: 'elsewhere' },
                { name: 'toTileX', type: 'int', value: 3 },
                { name: 'toTileY', type: 'int', value: 4 },
              ],
            },
          ],
        },
      ],
    };

    const [portal] = parseTiledMap('doors', map, TINY_TILESET).portals;

    expect(portal.toX).toBe(3 * 32 + 16);
    expect(portal.toY).toBe(4 * 32 + 16);
    expect(portal.label).toBe('door');
  });
});
