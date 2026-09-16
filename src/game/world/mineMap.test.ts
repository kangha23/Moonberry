import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, generateFloor } from '../systems/mine';
import { mineArea } from './areas';
import { elevatorTile, mineBand, mineFixtureAt, mineFloorMap, mineTileTexture } from './mineMap';

const SEED = 0x6d6f6f6e;

describe('mineBand', () => {
  it('gives the shallow, middle and deep floors three different looks', () => {
    expect(mineBand(3)).toBe('shallow');
    expect(mineBand(9)).toBe('shallow');
    expect(mineBand(10)).toBe('middle');
    expect(mineBand(29)).toBe('middle');
    expect(mineBand(35)).toBe('deep');
    expect(mineBand(MAX_DEPTH)).toBe('deep');
    expect(mineTileTexture('floor', mineBand(35))).not.toBe(mineTileTexture('floor', mineBand(3)));
  });
});

describe('mineFloorMap', () => {
  it('draws the generated walls and floors, tile for tile, at the shell size', () => {
    const floor = generateFloor(SEED, 12);
    const map = mineFloorMap(floor);
    expect(map.width).toBe(floor.width);
    expect(map.height).toBe(floor.height);
    expect(map.tiles).toHaveLength(floor.width * floor.height);
    for (let y = 0; y < floor.height; y += 1) {
      for (let x = 0; x < floor.width; x += 1) {
        const tile = map.tiles[y * floor.width + x]!;
        expect(tile.kind).toBe(floor.tiles[y][x]);
        expect(tile.solid).toBe(floor.tiles[y][x] === 'wall');
      }
    }
    expect(map.tiles[0]!.texture).toBe('mine-wall-middle');
  });

  it('marks the ladder as a portal to the next floor and the entrance as the way up', () => {
    const floor = generateFloor(SEED, 7);
    const map = mineFloorMap(floor);
    const ladder = map.portals.find((portal) => portal.name === 'ladder');
    expect(ladder?.toArea).toBe(mineArea(8));
    // Up the ladder you came down: the mouth of the mine in the wood.
    expect(map.portals.find((portal) => portal.name === 'exit')?.toArea).toBe('forest');
    expect(map.props.map((prop) => prop.texture)).toEqual(expect.arrayContaining(['mine-ladder', 'mine-exit']));
  });

  it('has no ladder down on the bottom floor', () => {
    const map = mineFloorMap(generateFloor(SEED, MAX_DEPTH));
    expect(map.portals.some((portal) => portal.name === 'ladder')).toBe(false);
  });

  it('puts an elevator beside the entrance only on elevator floors', () => {
    const five = generateFloor(SEED, 5);
    const six = generateFloor(SEED, 6);
    expect(elevatorTile(six)).toBeNull();
    const elevator = elevatorTile(five)!;
    expect(five.tiles[elevator.y][elevator.x]).toBe('floor');
    expect(mineFloorMap(five).props.some((prop) => prop.texture === 'mine-elevator')).toBe(true);
  });

  it('names what the action key does on each fixture tile', () => {
    const floor = generateFloor(SEED, 5);
    expect(mineFixtureAt(floor, floor.ladder!)).toBe('ladder');
    expect(mineFixtureAt(floor, floor.entrance)).toBe('exit');
    expect(mineFixtureAt(floor, elevatorTile(floor)!)).toBe('elevator');
    expect(mineFixtureAt(floor, { x: 0, y: 0 })).toBeNull();
  });
});
